/*
 * ENGINE (same in every project, do not edit).
 *
 * Building blocks for deploy-kit/settings/deploy.config.mjs and the code that runs them on the LOCAL TEST CHAIN
 * (npm run dev, npm test). Your real chain is deployed by hand in the explorer (deploy-kit/README.md).
 *
 * On a BWSC chain a program goes live in two transactions:
 *   1. deploy  (the deployer sends the code + initialization input; upgrader = who may send new code later)
 *   2. init    (an admin of the chain approves it; initialization(params) runs once, then it can be called)
 * "upgradeable" replaces the Solidity proxy: the owner is the program's upgrader, and an upgrade is
 *   upgrade (upgrader sends new code + migrate input) → initUpgrade (an admin approves; migrate() runs once).
 */

import { ChainError, utils } from "bwscbox";

/**
 * A program of this project (deploy-kit/bwsc/<name>.js).
 * @param {object} step
 * @param {string} step.name                   program name = key in the address book
 * @param {string} [step.build=name]           which deploy-kit/bwsc/<build>.js (a second pool of the same program)
 * @param {(ctx) => { symbol, name, decimals, wrap }} [step.asToken]
 *                                             a program that is also a token (wBWSC): the test chain's owner wraps `wrap`
 *                                             native coins in it (deposit) and the test panel can hand it out
 * @param {(ctx) => object} step.init          initialization input (bigints allowed)
 * @param {boolean} [step.upgradeable=true]    owner can send new code later (needs admin approval)
 * @param {(read, ctx) => Promise<object>} [step.readBack]  reads state after init; read(method, input)
 * @param {(state, ctx) => true|string} [step.check]        true, or what is wrong
 * @param {(ctx) => true|string} [step.when]                 true = deploy it; a sentence = skip it on this network (why)
 *                                                           (ctx.isLocal is true on npm run dev / npm test)
 * @param {(ctx) => true|string} [step.preflight]            checked before anything is sent:
 *                                                           a sentence stops the whole deploy (e.g. an unsafe setting)
 */
const program = ({ name, build = name, init, upgradeable = true, readBack, check, when, preflight, asToken }) => ({ kind: "program", key: name, build, init, upgradeable, readBack, check, when, preflight, asToken });

/** Why a step is skipped on this network, or null when it is deployed */
const skipReason = (step, ctx) => {
    if (!step.when) return null;
    const answer = step.when(ctx);
    return answer === true ? null : String(answer || "skipped");
};

/**
 * A standard token (the chain's TOKEN_PROGRAM, ERC-20 style). Settings: deploy-kit/settings/programs/<name>.env with
 * NAME, TICKER, DECIMALS, SUPPLY (whole tokens; all of it goes to the deployer). Not upgradeable, like most tokens.
 */
const token = ({ name }) => ({
    kind: "token",
    key: name,
    build: "Token",
    upgradeable: false,
    init: (ctx) => {
        const s = ctx.settings?.[name];
        if (!s) throw new Error(`deploy-kit/settings/programs/${name}.env is missing (NAME, TICKER, DECIMALS, SUPPLY).`);
        const decimals = Number(s.DECIMALS);
        return { name: s.NAME, ticker: s.TICKER, decimals: BigInt(decimals), supply: utils.toUnits(s.SUPPLY, decimals), namespace: s.NAMESPACE || undefined };
    },
    readBack: async (read) => ({ name: await read("name"), ticker: await read("ticker"), decimals: await read("decimals"), totalSupply: await read("totalSupply") }),
    check: (state, ctx) => {
        const s = ctx.settings[name];
        if (state.ticker !== s.TICKER) return `${name} ticker is ${state.ticker}, expected ${s.TICKER}.`;
        if (state.decimals !== BigInt(s.DECIMALS)) return `${name} has ${state.decimals} decimals, expected ${s.DECIMALS}.`;
        if (state.totalSupply !== utils.toUnits(s.SUPPLY, Number(s.DECIMALS))) return `${name} supply differs from SUPPLY.`;
        return true;
    },
});

/** Steps of a config, checked once */
function normalizeSteps(config) {
    const steps = config?.programs ?? [];
    const seen = new Set();
    for (const step of steps) {
        if (!step?.key || !step?.build) throw new Error("deploy.config.mjs: every entry needs program({ name, init }) or token({ name }).");
        if (seen.has(step.key)) throw new Error(`deploy.config.mjs: ${step.key} is listed twice.`);
        seen.add(step.key);
    }
    return steps;
}

/** { label: address } that must already be programs on the target chain */
const requiredProgramsOf = (config, settings) => (config?.requiredPrograms ? config.requiredPrograms(settings) : {});

/** Gas for a deploy: the node charges call + 10 per byte of code; leave room for the initialization input */
// Bluewolfchain gas (15,000 a transaction, code 33 a byte, …): a deploy pays for every byte of the code
const deployGas = (size) => Math.min(4_800_000, Math.max(1_000_000, 200_000 + size * 60));

/** Sends one transaction and waits until it worked (throws the program's message otherwise) */
async function sendAndWait(client, signer, fields) {
    const sent = await client.send(fields, signer);
    return client.waitReceipt(sent.hash, { timeoutMs: 120_000 });
}

/** address → true when the program is approved and running (has code), false when it is waiting for an admin */
async function isLive(client, address) {
    try {
        const info = await client.program(address);
        return Boolean(info?.code);
    } catch (error) {
        if (error instanceof ChainError && error.status === 404) return false;
        throw error;
    }
}

/**
 * Deploys one step: deploy → init (when an admin signer is given) → readBack → check.
 * @returns {Promise<{ address, deployTx, initTx, isLive, gas }>}
 */
async function runStep(step, { client, deployer, admin, ctx, build }) {
    const input = utils.toChainValue(await step.init(ctx));
    const deployed = await sendAndWait(client, deployer, {
        action: "deploy",
        code: build.code,
        input,
        ...(step.upgradeable ? { upgrader: ctx.owner } : {}),
        gasLimit: deployGas(build.size),
    });
    const address = String(deployed.result?.programUuid ?? deployed.result ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`${step.key}: the deploy receipt has no program address.`);
    const out = { address, deployTx: deployed.transactionHash, initTx: null, isLive: false, gas: { deploy: deployed.gasUsed } };
    if (!admin) return out;

    const inited = await sendAndWait(client, admin, { action: "init", to: address, gasLimit: 3_000_000 });
    Object.assign(out, { initTx: inited.transactionHash, isLive: true });
    out.gas.init = inited.gasUsed;
    await verifyStep(step, { client, ctx, address });
    return out;
}

/** readBack + check of a live program; throws what is wrong */
async function verifyStep(step, { client, ctx, address }) {
    if (!step.readBack) return;
    const read = (method, input = {}) => client.query({ program: address, method, input });
    const state = await step.readBack(read, ctx);
    const verdict = step.check ? step.check(state, ctx) : true;
    if (verdict !== true) throw new Error(`${step.key}: ${verdict}`);
}

export { skipReason, program, token, normalizeSteps, requiredProgramsOf, runStep, verifyStep, sendAndWait, isLive, deployGas };
