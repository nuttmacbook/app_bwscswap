/*
 * ENGINE (same in every project, do not edit).
 *
 * MOCK NODE: a stand-in for the BWSC node when the chain is not installed (npm run dev:mock, test:mock, test:app).
 * It runs YOUR program files as they are (the same .program.js source the real node gets) and answers the same
 * HTTP API the website, bwscbox and the dev scripts use, so every page, button and test works without the chain.
 *
 * What is the same as the real node
 *   - EIP-712 signatures are checked (recovered with ethers), nonce order, admin-only init / initUpgrade, upgrader
 *   - deploy → pending → admin init → initialization(params); upgrade → initUpgrade → migrate()
 *   - /sendtx simulates first and refuses a failing transaction (400) before it is queued; blocks every BLOCK_MS
 *   - every transaction is all-or-nothing; a failed runProgram that the caller catches rolls back only that branch
 *   - values are BigInt ("123n" in JSON), numbers written to storage are refused, readonly calls cannot write
 *   - native coin: value moves with calls, gas fee is charged, not enough coins → the node's own error text
 *   - error texts of the node are the real (Thai) ones, so bwscbox's translations are exercised too
 * What is NOT the same (use the real node for these: npm test / npm run dev without --mock)
 *   - no sandbox, no autoreview at deploy, no exact gas metering (gas here is a rough count, never compare it)
 *   - no explorer, no /evm JSON-RPC (only GET /evm for adding the chain), no history, no Merkle proofs
 *
 * Settings come from the same environment variables as the real server: PORT, HOST, GENESIS, CHAIN_ID, BLOCK_MS,
 * ADMINS, EVM_NAME, EVM_SYMBOL (deploy-kit/engine/node.mjs passes them).
 */

import http from "node:http";
import fs from "node:fs";
import { ethers } from "ethers";
import { typedData, utils } from "bwscbox";

const PORT = Number(process.env.PORT);
const HOST = process.env.HOST || "127.0.0.1";
const CHAIN_ID = Number(process.env.CHAIN_ID);
const BLOCK_MS = Number(process.env.BLOCK_MS);
const ADMINS = String(process.env.ADMINS ?? "").toLowerCase().split(",").filter(Boolean);
const BASE_FEE = 1_000_000_000n;
const GAS = { call: 100n, read: 20n, write: 500n, event: 200n, transfer: 21_000n, deploy: 100n, byte: 10n };
const ZERO = "0x0000000000000000000000000000000000000000";

const genesis = process.env.GENESIS && fs.existsSync(process.env.GENESIS) ? JSON.parse(fs.readFileSync(process.env.GENESIS, "utf8")) : { balances: {} };

/* ------------------------------------ state (committed) */

const chain = {
    storage: new Map(),        // `${program}|${key}` → value
    native: new Map(),         // address → bigint
    nonces: new Map(),         // address → number (confirmed)
    programs: new Map(),       // address → { code, metadata }
    pending: new Map(),        // address → { code, input, deployer, upgrader, value }
    upgrades: new Map(),       // address → { code, upgrader, input }
    names: new Map(),          // namespace → address
    txs: new Map(),            // hash → { record, receipt }
    queue: [],                 // [{ hash, tx, sender, sponsor }]
    events: [],                // every event, oldest first: { program, name, data, blockNumber, txIndex, index, txHash }
    latest: 0,
};
for (const [ address, amount ] of Object.entries(genesis.balances ?? {})) chain.native.set(address.toLowerCase(), BigInt(String(amount).replace(/n$/, "")));

const lower = (a) => String(a ?? "").toLowerCase();
const copy = (value) => (value === undefined ? undefined : structuredClone(value));
const nodeError = (message, code = "INVALID_REQUEST") => Object.assign(new Error(message), { nodeCode: code });

/* ------------------------------------ one transaction: layered writes, rolled back on error */

class Layer {
    constructor(parent = null, readonly = false) { this.parent = parent; this.readonly = readonly || parent?.readonly || false; this.writes = new Map(); }
    get(map, key) {
        for (let layer = this; layer; layer = layer.parent) if (layer.writes.has(`${map}\u0000${key}`)) return layer.writes.get(`${map}\u0000${key}`);
        return chain[map].get(key);
    }
    set(map, key, value) {
        if (this.readonly) throw nodeError(`writeDB() \u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27 (runProgram readonly)`, "FORBIDDEN");
        this.writes.set(`${map}\u0000${key}`, value);
    }
    child(readonly = false) { return new Layer(this, readonly); }
    mergeUp() { for (const [ k, v ] of this.writes) this.parent.writes.set(k, v); }
    commit() {
        for (const [ k, v ] of this.writes) {
            const [ map, key ] = k.split("\u0000");
            if (v === undefined) chain[map].delete(key); else chain[map].set(key, v);
        }
    }
}

const hasNumber = (value) => {
    if (typeof value === "number") return true;
    if (Array.isArray(value)) return value.some(hasNumber);
    if (value && typeof value === "object") return Object.values(value).some(hasNumber);
    return false;
};

/** Source → { exports, init, migrate } (initialization / migrate are reached the way the VM reaches them) */
const compiled = new Map();
function load(code) {
    if (compiled.has(code)) return compiled.get(code);
    const at = code.lastIndexOf("return {");
    if (at < 0) throw nodeError("\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E23\u0E39\u0E1B 'function program() { ... }' \u0E17\u0E31\u0E49\u0E07\u0E44\u0E1F\u0E25\u0E4C");
    const source = `${code.slice(0, at)}return { __init: typeof initialization === "function" ? initialization : undefined, __migrate: typeof migrate === "function" ? migrate : undefined, ${code.slice(at + "return {".length)}`;
    const names = [ "readDB", "writeDB", "deleteDB", "map", "runProgram", "transferNative", "setMetadata", "emit", "keccak256", "keccak256Bytes",
        "ecrecoverDigest", "eip712Digest", "eip712DomainSeparator", "ThisAddress", "ThisBalance", "BalanceOf", "IsProgram", "MetadataOf", "BlockNumber", "ChainId" ];
    // eslint-disable-next-line no-new-func
    const factory = new Function("api", `"use strict"; const { ${names.join(", ")} } = api; return (${source})();`);
    compiled.set(code, factory);
    return factory;
}

/** Runs one function of a program inside layer `layer`; returns the result. Throws on error (layer untouched then). */
function run({ layer, tx, program, method, input, context, value = 0n, isInit = false, isMigrate = false, readonly = false, depth = 0 }) {
    if (depth > 8) throw nodeError("\u0E40\u0E23\u0E35\u0E22\u0E01\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E0B\u0E49\u0E2D\u0E19\u0E44\u0E14\u0E49\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 8 \u0E0A\u0E31\u0E49\u0E19", "LIMIT_EXCEEDED");
    const frame = layer.child(readonly);
    const info = frame.get("programs", program);
    if (!info?.code) throw nodeError(`\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21 '${program}'`, "NOT_FOUND");
    if (value > 0n) moveNative(frame, context.sender, program, value);
    tx.gas += GAS.call;

    const key = (k) => {
        const text = typeof k === "string" ? k : k?.__map ? k.__map.join(":") : null;
        if (!text) throw nodeError("key \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 string \u0E2B\u0E23\u0E37\u0E2D map(...)");
        return `${program}|${text}`;
    };
    const api = {
        readDB: (k) => { tx.gas += GAS.read; return copy(frame.get("storage", key(k))); },
        writeDB: (k, v) => {
            if (v === undefined) throw nodeError("writeDB \u0E2B\u0E49\u0E32\u0E21\u0E43\u0E0A\u0E49 undefined (\u0E43\u0E0A\u0E49 deleteDB)");
            if (hasNumber(v)) throw nodeError("\u0E04\u0E48\u0E32: \u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E43\u0E19\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 BigInt \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19 (\u0E40\u0E0A\u0E48\u0E19 10n)");
            tx.gas += GAS.write;
            frame.set("storage", key(k), copy(v));
        },
        deleteDB: (k) => { tx.gas += GAS.write; frame.set("storage", key(k), undefined); },
        map: (...parts) => ({ __map: parts.map(String) }),
        runProgram: (target, fn, nested = {}, options = {}) => {
            const callValue = BigInt(options?.value ?? 0n);
            if (options?.readonly && callValue > 0n) throw nodeError("\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27 (readonly) \u0E41\u0E19\u0E1A value \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
            const result = run({ layer: frame, tx, program: lower(target), method: fn, input: copy(nested), context: { sender: program, origin: context.origin },
                value: callValue, readonly: readonly || Boolean(options?.readonly), depth: depth + 1 });
            return copy(result);
        },
        transferNative: (to, amount) => {
            if (frame.readonly) throw nodeError("transferNative() \u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27", "FORBIDDEN");
            moveNative(frame, program, lower(to), BigInt(amount));
        },
        setMetadata: (field, v) => {
            if (frame.readonly) throw nodeError("setMetadata() \u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27", "FORBIDDEN");
            if ([ "type", "creator", "createdAt", "upgrader", "version", "template" ].includes(field)) throw nodeError(`'${field}' \u0E40\u0E1B\u0E47\u0E19\u0E1F\u0E34\u0E25\u0E14\u0E4C\u0E02\u0E2D\u0E07\u0E23\u0E30\u0E1A\u0E1A \u0E41\u0E01\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49`, "FORBIDDEN");
            if (field === "namespace") {
                const owner = frame.get("names", v);
                if (owner && owner !== program) throw nodeError(`namespace '${v}' \u0E16\u0E39\u0E01\u0E43\u0E0A\u0E49\u0E42\u0E14\u0E22 ${owner} \u0E41\u0E25\u0E49\u0E27`, "FORBIDDEN");
                frame.set("names", v, program);
            }
            tx.metadata[program] = { ...(tx.metadata[program] ?? {}), [field]: copy(v) };
        },
        emit: (name, data) => {
            if (frame.readonly) throw nodeError("emit() \u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27", "FORBIDDEN");
            tx.gas += GAS.event;
            frame.events.push({ program, name, data: copy(data), depth });
        },
        keccak256: (v) => ethers.keccak256(ethers.toUtf8Bytes(typeof v === "string" ? v : JSON.stringify(utils.toChainValue(v)))),
        keccak256Bytes: (hex) => ethers.keccak256(hex),
        ecrecoverDigest: (digest, signature) => { try { return lower(ethers.recoverAddress(digest, signature)); } catch { return null; } },
        eip712Digest: (domain, types, primary, message) => {
            const { EIP712Domain, ...rest } = types;
            void EIP712Domain;
            return ethers.TypedDataEncoder.hash(domain, rest, message);
        },
        eip712DomainSeparator: (domain) => ethers.TypedDataEncoder.hashDomain(domain),
        ThisAddress: () => program,
        ThisBalance: () => frame.get("native", program) ?? 0n,
        BalanceOf: (a) => frame.get("native", lower(a)) ?? 0n,
        IsProgram: (a) => Boolean(frame.get("programs", lower(a))),
        MetadataOf: (a, field) => copy(frame.get("programs", lower(a))?.metadata?.[field] ?? null),
        BlockNumber: () => BigInt(tx.blockNumber),
        ChainId: () => BigInt(CHAIN_ID),
    };
    frame.events = [];
    const exported = load(info.code)(api);
    const fn = isInit ? exported.__init : isMigrate ? exported.__migrate : (method.startsWith("__") ? undefined : exported[method]);
    if (typeof fn !== "function") {
        if (isInit || isMigrate) { frame.mergeUpWithEvents(layer); return undefined; }
        throw nodeError(`\u0E40\u0E23\u0E35\u0E22\u0E01 '${method}' \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 export)`, "FORBIDDEN");
    }
    const params = { input: input ?? {}, context, value, block: { timestamp: BigInt(tx.timestamp) } };
    const result = fn(params);
    if (result && typeof result.then === "function") throw nodeError("\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A async", "PROGRAM_ERROR");
    if (hasNumber(result)) throw nodeError("\u0E04\u0E48\u0E32\u0E17\u0E35\u0E48 return: \u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E43\u0E19\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 BigInt \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19 (\u0E40\u0E0A\u0E48\u0E19 10n)");
    frame.mergeUpWithEvents(layer);
    return result;
}
Layer.prototype.mergeUpWithEvents = function (parent) {
    this.mergeUp();
    (parent.events ??= []).push(...(this.events ?? []));
};

function moveNative(layer, from, to, amount) {
    if (amount < 0n) throw nodeError("amount \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E08\u0E33\u0E19\u0E27\u0E19\u0E40\u0E15\u0E47\u0E21\u0E44\u0E21\u0E48\u0E15\u0E34\u0E14\u0E25\u0E1A");
    const balance = layer.get("native", from) ?? 0n;
    if (balance < amount) throw nodeError(`\u0E22\u0E2D\u0E14 native \u0E02\u0E2D\u0E07 '${from}' \u0E44\u0E21\u0E48\u0E1E\u0E2D`, "PROGRAM_ERROR");
    layer.set("native", from, balance - amount);
    layer.set("native", to, (layer.get("native", to) ?? 0n) + amount);
}

/* ------------------------------------ transactions */

const parseUint = (v) => BigInt(String(v ?? 0).replace(/n$/, "") || "0");

/** Checks the signatures → { hash, sender, sponsor } (throws the node's messages) */
function verify({ tx, signature, sponsorSignature }) {
    const typed = typedData.walletTypedData(tx);
    const { EIP712Domain, ...types } = typed.types;
    void EIP712Domain;
    const hash = ethers.TypedDataEncoder.hash(typed.domain, types, typed.message);
    let sender;
    try { sender = lower(ethers.verifyTypedData(typed.domain, types, typed.message, signature)); } catch { throw nodeError("signature \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 hex 65 byte (r + s + v)"); }
    if (tx.from && lower(tx.from) !== sender) throw nodeError(`\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A from: \u0E40\u0E0B\u0E47\u0E19\u0E42\u0E14\u0E22 ${sender}`);
    if (Number(tx.chainId) !== CHAIN_ID) throw nodeError(`chainId \u0E44\u0E21\u0E48\u0E15\u0E23\u0E07: \u0E40\u0E0A\u0E19\u0E19\u0E35\u0E49\u0E04\u0E37\u0E2D ${CHAIN_ID}`);
    let sponsor = null;
    if (tx.sponsor) {
        sponsor = lower(ethers.verifyTypedData(typed.domain, types, typed.message, sponsorSignature ?? "0x"));
        if (sponsor !== lower(tx.sponsor)) throw nodeError(`sponsorSignature \u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A sponsor: \u0E40\u0E0B\u0E47\u0E19\u0E42\u0E14\u0E22 ${sponsor}`);
    }
    return { hash, sender, sponsor };
}

const expectedNonce = (address) => (chain.nonces.get(address) ?? 0) + chain.queue.filter((q) => q.sender === address).length;

/** Executes a transaction against a layer → { status, result, error, gasUsed, events } (layer holds the writes) */
function execute(layer, { tx, sender, sponsor }, { blockNumber, timestamp }) {
    const action = tx.action ?? "call";
    const ctx = { gas: 0n, metadata: {}, blockNumber, timestamp };
    const input = utils.fromChainValue(typedData.normalizeHexDeep(tx.input ?? {}));
    const value = parseUint(tx.value);
    const context = { sender, origin: sender };
    let result;
    const work = layer.child();
    work.events = [];
    if (action === "transfer") {
        ctx.gas += GAS.transfer;
        moveNative(work, sender, lower(tx.to), value);
    } else if (action === "deploy") {
        ctx.gas += GAS.deploy + GAS.byte * BigInt(Buffer.byteLength(tx.code ?? ""));
        load(tx.code);
        // Program address from deployer + nonce (the real node hashes these two as well; the exact formula differs)
        const address = lower(ethers.getCreateAddress({ from: sender, nonce: Number(tx.nonce) }));
        if (work.get("pending", address) || work.get("programs", address)) throw nodeError(`programUuid '${address}' \u0E16\u0E39\u0E01\u0E43\u0E0A\u0E49\u0E41\u0E25\u0E49\u0E27`);
        if (value > 0n) moveNative(work, sender, address, value);
        work.set("pending", address, { code: tx.code, input, deployer: sender, upgrader: tx.upgrader ? lower(tx.upgrader) : null });
        result = { programUuid: address, state: "pending" };
    } else if (action === "init") {
        if (ADMINS.length && !ADMINS.includes(sender)) throw nodeError(`'${sender}' \u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C init / reject`, "FORBIDDEN");
        const address = lower(tx.to);
        const pending = work.get("pending", address);
        if (!pending) throw nodeError("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E17\u0E35\u0E48\u0E23\u0E2D\u0E23\u0E35\u0E27\u0E34\u0E27", "NOT_FOUND");
        work.set("programs", address, { code: pending.code, metadata: { type: "program", creator: pending.deployer, createdAt: timestamp, ...(pending.upgrader ? { upgrader: pending.upgrader } : {}) } });
        work.set("pending", address, undefined);
        run({ layer: work, tx: ctx, program: address, input: pending.input, context: { sender: pending.deployer, origin: pending.deployer }, isInit: true });
        result = { programUuid: address, state: "active" };
    } else if (action === "upgrade") {
        const address = lower(tx.to);
        const program = work.get("programs", address);
        if (!program) throw nodeError(`\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21 '${address}'`, "NOT_FOUND");
        if (!program.metadata.upgrader) throw nodeError(`\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21 '${address}' \u0E2D\u0E31\u0E1B\u0E40\u0E01\u0E23\u0E14\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 (\u0E44\u0E21\u0E48\u0E21\u0E35 upgrader)`, "FORBIDDEN");
        if (program.metadata.upgrader !== sender) throw nodeError(`'${sender}' \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 upgrader \u0E02\u0E2D\u0E07\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E19\u0E35\u0E49`, "FORBIDDEN");
        if (work.get("upgrades", address)) throw nodeError(`\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21 '${address}' \u0E21\u0E35\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E40\u0E01\u0E23\u0E14\u0E17\u0E35\u0E48\u0E23\u0E2D\u0E2D\u0E22\u0E39\u0E48\u0E41\u0E25\u0E49\u0E27`);
        load(tx.code);
        work.set("upgrades", address, { code: tx.code, upgrader: sender, input });
        result = { programUuid: address, state: "pending" };
    } else if (action === "initUpgrade") {
        if (ADMINS.length && !ADMINS.includes(sender)) throw nodeError(`'${sender}' \u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C init / reject`, "FORBIDDEN");
        const address = lower(tx.to);
        const upgrade = work.get("upgrades", address);
        if (!upgrade) throw nodeError("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E40\u0E01\u0E23\u0E14\u0E17\u0E35\u0E48\u0E23\u0E2D\u0E23\u0E35\u0E27\u0E34\u0E27", "NOT_FOUND");
        const program = work.get("programs", address);
        work.set("programs", address, { code: upgrade.code, metadata: { ...program.metadata, version: (program.metadata.version ?? 1) + 1 } });
        work.set("upgrades", address, undefined);
        run({ layer: work, tx: ctx, program: address, input: upgrade.input, context: { sender: upgrade.upgrader, origin: upgrade.upgrader }, isMigrate: true });
        result = { programUuid: address, state: "active" };
    } else if (action === "call") {
        result = run({ layer: work, tx: ctx, program: lower(tx.to), method: tx.method, input, context, value });
    } else {
        throw nodeError(`action \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: ${action}`);
    }
    // metadata set by the program (setMetadata) lands on its record
    for (const [ address, fields ] of Object.entries(ctx.metadata)) {
        const program = work.get("programs", address);
        if (program) work.set("programs", address, { ...program, metadata: { ...program.metadata, ...fields } });
    }
    const gasUsed = ctx.gas + 1000n;
    const payer = sponsor ?? sender;
    moveNative(work, payer, ZERO, gasUsed * BASE_FEE);     // fee: burned like the real node's base fee
    work.mergeUpWithEvents(layer);
    return { result, gasUsed: Number(gasUsed), events: work.events ?? [] };
}

/** Runs `fn` on a throwaway layer → { ok, value | error } */
function tryOn(fn) {
    const layer = new Layer();
    layer.events = [];
    try {
        return { ok: true, value: fn(layer), layer };
    } catch (error) {
        return { ok: false, error };
    }
}

const errorBody = (error) => ({ message: String(error?.message ?? error), code: error?.nodeCode ?? "PROGRAM_ERROR" });

function sendtx(body) {
    const tx = body?.tx ?? {};
    const verified = verify(body);
    if (chain.txs.has(verified.hash) || chain.queue.some((q) => q.hash === verified.hash)) return { status: 400, body: { queued: false, reason: "tx \u0E0B\u0E49\u0E33" } };
    const expected = expectedNonce(verified.sender);
    if (Number(tx.nonce) !== expected) return { status: 400, body: { queued: false, hash: verified.hash, reason: `nonce \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 ${expected}`, expectedNonce: expected } };
    if (chain.queue.filter((q) => q.sender === verified.sender).length >= 16) return { status: 400, body: { queued: false, reason: "\u0E04\u0E34\u0E27\u0E02\u0E2D\u0E07 address \u0E19\u0E35\u0E49\u0E40\u0E15\u0E47\u0E21" } };
    // Like the real node: simulate on the current state, refuse a failing transaction before it is queued
    const simulation = tryOn((layer) => execute(layer, { tx, ...verified }, { blockNumber: chain.latest + 1, timestamp: Date.now() }));
    if (!simulation.ok) return { status: 400, body: { queued: false, hash: verified.hash, simulation: { ok: false, status: "throw", error: errorBody(simulation.error).message, errorCode: errorBody(simulation.error).code } } };
    chain.queue.push({ hash: verified.hash, tx, sender: verified.sender, sponsor: verified.sponsor });
    return { status: 200, body: { queued: true, hash: verified.hash, sender: verified.sender, simulation: { ok: true, status: "success", gasUsed: simulation.value.gasUsed } } };
}

/** Closes a block with everything queued (in order). A transaction that fails here still uses its nonce and pays gas. */
function mine() {
    if (!chain.queue.length) return;
    const blockNumber = chain.latest + 1;
    const timestamp = Date.now();
    const items = chain.queue.splice(0);
    items.forEach((item, index) => {
        const base = { hash: item.hash, blockNumber, index, action: item.tx.action ?? "call", from: item.sender, to: lower(item.tx.to), method: item.tx.method ?? "", timestamp };
        const outcome = tryOn((layer) => execute(layer, item, { blockNumber, timestamp }));
        chain.nonces.set(item.sender, (chain.nonces.get(item.sender) ?? 0) + 1);
        if (outcome.ok) {
            outcome.layer.commit();
            // Event list like the real node's GET /program/:a/events (newest first, cursor)
            (outcome.layer.events ?? []).forEach((e, i) => chain.events.push({ ...e, blockNumber, txIndex: index, index: i, txHash: item.hash, timestamp }));
            chain.txs.set(item.hash, { ...base, status: "success", result: outcome.value.result, error: null, gasUsed: outcome.value.gasUsed, events: outcome.layer.events,
                // Like the real node's receipt: what the transaction paid (all burned here)
                effectiveGasPrice: BASE_FEE, baseFeePerGas: BASE_FEE, fee: BigInt(outcome.value.gasUsed) * BASE_FEE, burnedFee: BigInt(outcome.value.gasUsed) * BASE_FEE, producerFee: 0n });
        } else {
            // Failed in the block: nonce is used and a minimum fee is paid, like the real node
            const fee = 1000n * BASE_FEE;
            const payer = item.sponsor ?? item.sender;
            chain.native.set(payer, (chain.native.get(payer) ?? 0n) - ((chain.native.get(payer) ?? 0n) >= fee ? fee : 0n));
            chain.txs.set(item.hash, { ...base, status: "throw", result: null, error: errorBody(outcome.error), gasUsed: 1000, events: [],
                effectiveGasPrice: BASE_FEE, baseFeePerGas: BASE_FEE, fee, burnedFee: fee, producerFee: 0n });
        }
    });
    chain.latest = blockNumber;
}
setInterval(mine, BLOCK_MS);

/* ------------------------------------ HTTP (same paths and shapes as server.js) */

const json = (value) => JSON.stringify(value, (k, v) => (typeof v === "bigint" ? `${v}n` : v));
const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(json(body));
};

function get(path, req) {
    let m;
    if (path === "/genesis") return { chainId: CHAIN_ID, latest: chain.latest, pending: chain.queue.length, baseFee: BASE_FEE, gasPrice: BASE_FEE, mock: true };
    if (path === "/health") return { ok: true, latest: chain.latest, role: "producer", mock: true };
    if (path === "/evm") {
        const origin = `http://${req.headers.host}`;
        return { chainId: `0x${CHAIN_ID.toString(16)}`, chainName: process.env.EVM_NAME, nativeCurrency: { name: process.env.EVM_NAME, symbol: process.env.EVM_SYMBOL, decimals: 18 }, rpcUrls: [ `${origin}/evm` ], blockExplorerUrls: [ `${origin}/evm/explorer` ] };
    }
    if ((m = /^\/nonce\/([^/]+)$/.exec(path))) return { nonce: expectedNonce(lower(m[1])) };
    if ((m = /^\/address\/([^/]+)$/.exec(path))) {
        const a = lower(m[1]);
        return { address: a, native: { balance: chain.native.get(a) ?? 0n }, nonce: chain.nonces.get(a) ?? 0, isProgram: chain.programs.has(a), metadata: chain.programs.get(a)?.metadata ?? {} };
    }
    if ((m = /^\/program\/([^/]+)$/.exec(path))) {
        const a = lower(m[1]);
        const program = chain.programs.get(a);
        if (!program) return { status: 404, body: { error: "Program not found (it may not be initialized yet)" } };
        const up = chain.upgrades.get(a);
        return { address: a, code: program.code, metadata: program.metadata, native: { balance: chain.native.get(a) ?? 0n }, pendingUpgrade: up ? { upgrader: up.upgrader } : null };
    }
    if ((m = /^\/name\/([^/]+)$/.exec(path))) return { namespace: decodeURIComponent(m[1]), address: chain.names.get(decodeURIComponent(m[1])) ?? null };
    if ((m = /^\/tx\/([^/]+)\/receipt$/.exec(path))) {
        const record = chain.txs.get(lower(m[1]));
        return record ?? { status: 404, body: { error: "Transaction not found" } };
    }
    if ((m = /^\/tx\/([^/]+)$/.exec(path))) {
        const hash = lower(m[1]);
        if (chain.queue.some((q) => q.hash === hash)) return { status: "pending", hash };
        const record = chain.txs.get(hash);
        return record ? { hash, blockNumber: record.blockNumber, index: record.index, status: record.status } : { status: 404, body: { error: "Transaction not found" } };
    }
    if ((m = /^\/program\/([^/]+)\/events$/.exec(path))) {
        const q = new URL(req.url, "http://x").searchParams;
        const a = lower(m[1]);
        const name = q.get("name") ?? "";
        const limit = Math.min(Math.max(Number(q.get("limit")) || 20, 1), 100);
        const list = chain.events.filter((e) => e.program === a && (!name || e.name === name)).reverse();
        const start = q.get("cursor") ? Math.max(0, list.findIndex((e) => `${e.blockNumber}:${e.txIndex}:${e.index}` === q.get("cursor"))) : 0;
        const items = list.slice(start, start + limit);
        const next = list[start + limit];
        return { items, next: next ? `${next.blockNumber}:${next.txIndex}:${next.index}` : null, limit };
    }
    if (path === "/" || path === "/explorer") return { status: 200, body: { mock: true, note: "Mock node: no explorer. Use the real node for the explorer." } };
    return { status: 404, body: { error: "Endpoint not found" } };
}

function query(body) {
    const sender = lower(body?.context?.sender ?? ZERO);
    const outcome = tryOn((layer) => run({ layer, tx: { gas: 0n, metadata: {}, blockNumber: chain.latest + 1, timestamp: Date.now() }, program: lower(body?.programUuid),
        method: body?.functionName, input: utils.fromChainValue(typedData.normalizeHexDeep(body?.input ?? {})), context: { sender, origin: lower(body?.context?.origin ?? sender) }, value: 0n }));
    if (!outcome.ok) return { status: 400, body: { status: "throw", error: errorBody(outcome.error) } };
    return { status: "success", result: outcome.value, readOnly: true };
}

http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
        if (req.method === "OPTIONS") return send(res, 204, {});   // the real node answers OPTIONS like this too (no allow-headers)
        if (req.method === "GET") {
            const out = get(path, req);
            if (out && out.status && out.body && Object.keys(out).length === 2 && typeof out.status === "number") return send(res, out.status, out.body);
            return send(res, 200, out);
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        const out = path === "/sendtx" ? sendtx(body) : path === "/query" ? query(body) : { status: 404, body: { error: "Endpoint not found" } };
        if (typeof out.status === "number" && out.body) return send(res, out.status, out.body);
        return send(res, 200, out);
    } catch (error) {
        return send(res, 400, { queued: false, error: String(error?.message ?? error) });
    }
}).listen(PORT, HOST, () => console.log(`mock BWSC node on http://${HOST}:${PORT} (chain id ${CHAIN_ID})`));
