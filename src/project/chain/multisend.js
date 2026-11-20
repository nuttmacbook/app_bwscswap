/*
 * YOUR CODE (on-chain). Multi transfer (BwscMultiSend): one coin to many wallets, on Bluewolfchain.
 *
 *   getSendData(wallet, token)    one read: the limit per transaction, the wallet's balance and allowance of the coin,
 *                                 its decimals, and the base fee (for the fee estimate)
 *   parseList(text, decimals)     "address, amount" lines → rows, the lines with a problem, duplicates, the total
 *   batchesOf(rows, max)          the rows in transactions of at most `max` wallets
 *   multiSend(wallet, { token, rows, done }, { onStep, onBatch })
 *                                 approves the total once (tokens), then sends each batch not yet in `done`;
 *                                 onBatch(index, receipt) after each one, so a stop half way can carry on later
 */

import { box } from "../../engine/chain/connect";
import { cachedRead, invalidateReads } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { normalize } from "../../engine/chain/txError";
import { approveIfNeeded } from "../../engine/chain/token";
import { ZERO, isAddress } from "../../engine/settings";
import { toUnits } from "../../engine/ui/helpers";
import { MultiSendProgram } from "./programs";
import { HUB, coinOf, nativeCoin, listedCoin } from "./coins";

const lower = (a) => String(a ?? "").toLowerCase();
const isReady = () => MultiSendProgram.address !== ZERO;
const reader = () => metered(box.createReader(MultiSendProgram), "BwscMultiSend");

// Gas measured on a node with the Bluewolfchain gas table (deploy-kit/project/test/BwscMultiSend.test.mjs):
// about 23,000 + 860 a wallet for the native coin and 25,000 + 10,700 a wallet for a token (200 token wallets ≈ 2.2M).
// Limits are a third higher plus 20,000; you pay only the gas really used.
const gasUsedOf = (count, isNative) => (isNative ? 23_000n + 860n * BigInt(count) : 25_000n + 10_700n * BigInt(count));
const gasLimitOf = (count, isNative) => 20_000n + (gasUsedOf(count, isNative) * 4n) / 3n;

/** One read: the coin's numbers for this wallet (and the program's limit, the base fee) */
async function getSendData(wallet, token = ZERO, { fresh = false } = {}) {
    const base = { wallet, isConnected: Boolean(wallet?.address), isReady: isReady() };
    if (!isReady()) return base;
    const address = isAddress(token) ? lower(token) : ZERO;
    const account = wallet?.address ? lower(wallet.address) : "";
    const view = await cachedRead(`multi:${account}:${address}`, () => reader().methods.getView({ account, token: address }).call(), { fresh });
    if (address !== ZERO && typeof view.decimals !== "bigint") return { ...base, coin: null, problem: "That address is not a token on this chain." };
    const known = listedCoin(HUB, address);
    const coin = address === ZERO ? nativeCoin(HUB)
        : coinOf(HUB, { address, symbol: known?.symbol ?? (view.symbol || "TOKEN"), name: known?.name ?? view.symbol, decimals: Number(view.decimals) });
    return {
        ...base,
        coin: { ...coin, balance: view.balance ?? 0n, allowance: view.allowance ?? 0n },
        gasBalance: view.gasBalance ?? 0n,
        maxTransfers: Number(view.maxTransfers ?? 200n),
        baseFee: view.baseFee ?? 0n,
    };
}

/*
 * A list someone pasted or uploaded: one wallet per line, "address amount" with a comma, semicolon, tab, space or =
 * between. Empty lines and lines starting with # or // are skipped, and so is a first line that is a heading
 * (e.g. "address,amount"). With `sameAmount` every line needs only the address.
 */
const SPLIT = /[\s,;=]+/;
function parseList(text, decimals, { sameAmount = null } = {}) {
    const rows = [];
    const problems = [];
    const seen = new Map();
    const lines = String(text ?? "").split(/\r?\n/);
    lines.forEach((raw, i) => {
        const line = raw.trim();
        const n = i + 1;
        if (!line || line.startsWith("#") || line.startsWith("//")) return;
        const [ to, amountText = "", ...rest ] = line.split(SPLIT).filter(Boolean);
        if (!rows.length && !problems.length && !/^0x/i.test(to)) return;   // a heading
        if (!isAddress(to) || lower(to) === ZERO) return problems.push({ line: n, text: line, reason: "not a wallet address" });
        if (rest.length) return problems.push({ line: n, text: line, reason: "more than an address and an amount" });
        let amount;
        if (sameAmount !== null) {
            if (amountText) return problems.push({ line: n, text: line, reason: "only the address: everyone gets the same amount" });
            amount = sameAmount;
        } else {
            if (!amountText) return problems.push({ line: n, text: line, reason: "no amount" });
            try { amount = toUnits(amountText, decimals); } catch { return problems.push({ line: n, text: line, reason: `"${amountText}" is not an amount` }); }
            if (!(amount > 0n)) return problems.push({ line: n, text: line, reason: "the amount must be more than 0" });
        }
        const key = lower(to);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        rows.push({ line: n, to: key, amount });
    });
    const total = rows.reduce((s, r) => s + r.amount, 0n);
    const duplicates = [ ...seen.entries() ].filter(([ , count ]) => count > 1).map(([ to, count ]) => ({ to, count }));
    return { rows, problems, total, duplicates };
}

/** Wallets listed more than once become one row with the amounts added up (first line's place kept) */
function mergeDuplicates(rows) {
    const out = new Map();
    for (const r of rows) {
        const had = out.get(r.to);
        out.set(r.to, had ? { ...had, amount: had.amount + r.amount } : { ...r });
    }
    return [ ...out.values() ];
}

/** The rows in transactions of at most `max` wallets */
function batchesOf(rows, max) {
    const size = Math.max(1, Number(max) || 200);
    const out = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
}

/** About what the network fee will be (gas really used × the base fee now) */
const feeEstimate = (batches, isNative, baseFee) => batches.reduce((s, b) => s + gasUsedOf(b.length, isNative), 0n) * BigInt(baseFee ?? 0);

/**
 * The native coin the wallet must hold for fees: each transaction needs its gas limit × the most it offers to pay
 * (2 × base fee) at the moment it is sent, and all of them together use about a quarter more than the estimate.
 */
function feeCeiling(batches, isNative, baseFee) {
    const fee = BigInt(baseFee ?? 0);
    const biggest = batches.reduce((m, b) => { const x = gasLimitOf(b.length, isNative) * fee * 2n; return x > m ? x : m; }, 0n);
    const all = (feeEstimate(batches, isNative, fee) * 5n) / 4n;
    return biggest > all ? biggest : all;
}

const needWallet = (wallet) => { if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected."); };

/**
 * Sends every batch not in `done`. Tokens: approves what is still to be sent, once, first.
 * Stops at the first batch that fails; the ones before it are sent and reported through onBatch.
 */
async function multiSend(wallet, { token, rows, done = new Set() }, { onStep = () => {}, onBatch = () => {} } = {}) {
    needWallet(wallet);
    onStep({ stage: "checking" });
    const data = await getSendData(wallet, token, { fresh: true });
    if (!data.isReady) throw new Error("Multi transfer is not set up yet.");
    if (!data.coin) throw new Error(data.problem ?? "Pick a coin.");
    const coin = data.coin;
    const batches = batchesOf(rows, data.maxTransfers);
    const todo = batches.map((b, i) => ({ index: i, rows: b })).filter((b) => !done.has(b.index));
    if (!todo.length) throw new Error("Every batch has been sent already.");
    const total = todo.reduce((s, b) => s + b.rows.reduce((x, r) => x + r.amount, 0n), 0n);
    const fee = feeCeiling(todo.map((b) => b.rows), coin.isNative, data.baseFee);
    if (total > coin.balance) throw new Error(`Not enough ${coin.symbol}: this needs ${total} and the wallet has ${coin.balance} (smallest units).`);
    if (coin.isNative && total + fee > coin.balance) throw new Error(`Keep enough ${coin.symbol} for the network fee as well.`);
    if (!coin.isNative && fee > data.gasBalance) throw new Error(`Not enough ${nativeCoin(HUB).symbol} for the network fee: send fewer wallets at a time or add ${nativeCoin(HUB).symbol}.`);
    const needsApprove = !coin.isNative && coin.allowance < total;
    const prompts = todo.length + (needsApprove ? 1 : 0);
    if (needsApprove) await approveIfNeeded({ wallet, token: coin.address, spender: MultiSendProgram.address, amount: total, allowance: coin.allowance, onStep, index: 1, total: prompts });
    const program = box.createProgram(MultiSendProgram, wallet.signer);
    let last = null;
    for (const [ k, b ] of todo.entries()) {
        const step = k + 1 + (needsApprove ? 1 : 0);
        const sum = b.rows.reduce((x, r) => x + r.amount, 0n);
        onStep({ stage: "send", index: step, total: prompts, batch: b.index + 1, batches: batches.length, count: b.rows.length });
        try {
            const tx = await program.send(
                { token: coin.address, transfers: b.rows.map((r) => ({ to: r.to, amount: `${r.amount}n` })) },
                { value: coin.isNative ? String(sum) : "0", gasLimit: Number(gasLimitOf(b.rows.length, coin.isNative)) },
            );
            onStep({ stage: "sending", index: step, total: prompts, batch: b.index + 1, batches: batches.length, count: b.rows.length });
            last = await tx.wait();
            invalidateReads();
            onBatch(b.index, last);
        } catch (error) {
            const sent = done.size + k;
            const lead = batches.length > 1 ? `Batch ${b.index + 1} of ${batches.length} was not sent${sent ? ` (${sent} sent before it)` : ""}. ` : "";
            const err = normalize(error, box.handleTxError(MultiSendProgram, error), "The transfer was not sent.");
            if (lead && err && typeof err.message === "string" && !err.message.startsWith("Batch")) err.message = lead + err.message;
            throw err;
        }
    }
    return last;
}

export { getSendData, parseList, mergeDuplicates, batchesOf, feeEstimate, feeCeiling, multiSend };
