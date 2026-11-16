/*
 * YOUR CODE (on-chain). The exchange (BwscDex): reading every pair, finding the best route, swapping, wrapping,
 * liquidity in and out, and new pairs. The pages import from here; they never talk to a program themselves.
 *
 * The native coin (BWSC, address 0x0…0 in this app) trades through the pairs that hold wBWSC: a route that starts or
 * ends with BWSC sends / receives native coins, the program wraps and unwraps on the way. BWSC ↔ wBWSC itself is a
 * plain wrap / unwrap (1 : 1, no fee) on the wBWSC program.
 */

import { box } from "../../engine/chain/connect";
import { cachedRead, invalidateReads } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { normalize } from "../../engine/chain/txError";
import { approveIfNeeded } from "../../engine/chain/token";
import { config, ZERO } from "../../engine/settings";
import { DexProgram, wrappedProgramAt } from "./programs";
import { HUB, coinOf, nativeCoin, byListOrder } from "./coins";
import { amountOut, amountIn as amountInFor, withSlippage, withSlippageUp } from "./pricing";

const PAGE = 100n;
const BPS = 10_000n;
const GAS_RESERVE = 10n ** 16n;   // 0.01 native coin kept for gas when the native coin goes in
const MAX_HOPS = Math.min(3, Math.max(1, Number(config.swap?.maxHops ?? 3)));

const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };
const lower = (a) => String(a ?? "").toLowerCase();
const dex = () => metered(box.createReader(DexProgram), "BwscDex");

/* ------------------------------------ reading */

/**
 * Everything the swap, pool and landing pages need: every pair (read a page of 100 at a time), every token in them
 * with your balance and allowance, your native balance and your shares.
 * @returns {{ wallet, isConnected, isReady, owner, isOwner, isPaused, openPairs, defaultFeeBps, maxFeeBps, minimumLiquidity,
 *            wrapped, native, tokens, coins, pairs }}
 */
async function getDexData(wallet, { fresh = false } = {}) {
    const base = { wallet, isConnected: Boolean(wallet?.address) };
    if (DexProgram.address === ZERO) return { ...base, isReady: false, pairs: [], tokens: [], coins: [] };
    const who = lower(wallet?.address);
    const views = [];
    for (let offset = 0n; ; offset += PAGE) {
        const v = await cachedRead(`dex:${who}:${offset}`, () => dex().methods.getView({ account: who, offset: `${offset}n`, limit: `${PAGE}n` }).call(), { fresh });
        views.push(v);
        if (offset + PAGE >= big(v.pairCount)) break;
    }
    const first = views[0];
    const wrapped = lower(first.wrapped);
    const byAddress = new Map();
    for (const v of views) {
        for (const t of v.tokens) {
            const a = lower(t.address);
            if (!byAddress.has(a)) byAddress.set(a, coinOf(HUB, { address: a, symbol: t.symbol, name: t.name, decimals: Number(t.decimals), balance: big(t.balance), allowance: big(t.allowance), held: big(t.held), isWrapped: a === wrapped }));
        }
    }
    const native = { ...nativeCoin(HUB), balance: big(first.nativeBalance), wrappedAddress: wrapped };
    const pairs = views.flatMap((v) => v.pairs).map((p) => ({
        id: String(p.id),
        tokenA: byAddress.get(lower(p.tokenA)),
        tokenB: byAddress.get(lower(p.tokenB)),
        reserveA: big(p.reserveA),
        reserveB: big(p.reserveB),
        totalShares: big(p.totalShares),
        myShares: big(p.myShares),
        feeBps: big(p.feeBps),
        hasNative: lower(p.tokenA) === wrapped || lower(p.tokenB) === wrapped,
    }));
    const tokens = [ ...byAddress.values() ].sort(byListOrder);
    // The native coin is in the swap list when it can go somewhere: wBWSC is in a pair (or at least listed as the wrapper)
    const coins = byAddress.has(wrapped) ? [ native, ...tokens ] : tokens;
    return {
        ...base,
        isReady: true,
        dexAddress: DexProgram.address,
        owner: lower(first.owner),
        isOwner: Boolean(who) && who === lower(first.owner),
        isPaused: first.paused === true,
        openPairs: first.openPairs === true,
        defaultFeeBps: big(first.defaultFeeBps),
        maxFeeBps: big(first.maxFeeBps),
        minimumLiquidity: big(first.minimumLiquidity),
        version: big(first.version ?? 1n),
        // The chain's clock at this read (unix seconds; 0 on a v1 exchange): deadlines are set from it
        blockTime: big(first.blockTime ?? 0n),
        readAt: Math.floor(Date.now() / 1000),
        wrapped,
        native,
        tokens,
        coins,
        pairs,
    };
}

/** A coin of the page data by address (0x0…0 = the native coin) */
const coinIn = (data, address) => (lower(address) === ZERO ? data.native : data.tokens.find((t) => t.address === lower(address))) ?? null;

/** The pair of two tokens (native counts as wBWSC), or null */
function pairFor(data, a, b) {
    const x = lower(a) === ZERO ? data.wrapped : lower(a);
    const y = lower(b) === ZERO ? data.wrapped : lower(b);
    return data.pairs.find((p) => (p.tokenA.address === x && p.tokenB.address === y) || (p.tokenA.address === y && p.tokenB.address === x)) ?? null;
}

/* ------------------------------------ routes */

/** Every path from `start` to `goal` over pairs with liquidity (at most MAX_HOPS pairs, no token twice) */
function pathsBetween(data, start, goal) {
    const edges = new Map();
    for (const p of data.pairs) {
        if (!(p.reserveA > 0n && p.reserveB > 0n)) continue;
        for (const [ x, y ] of [ [ p.tokenA.address, p.tokenB.address ], [ p.tokenB.address, p.tokenA.address ] ]) {
            if (!edges.has(x)) edges.set(x, []);
            edges.get(x).push({ to: y, pair: p });
        }
    }
    const found = [];
    const walk = (at, path, pairs) => {
        if (found.length >= 5_000) return;
        if (at === goal) { found.push({ path: [ ...path ], pairs: [ ...pairs ] }); return; }
        if (pairs.length >= MAX_HOPS) return;
        for (const e of edges.get(at) ?? []) {
            if (path.includes(e.to)) continue;
            path.push(e.to);
            pairs.push(e.pair);
            walk(e.to, path, pairs);
            path.pop();
            pairs.pop();
        }
    };
    walk(start, [ start ], []);
    return found;
}

// One step of a path, in the swap's direction
const stepOf = (p, from) => {
    const forward = p.tokenA.address === from;
    return { rIn: forward ? p.reserveA : p.reserveB, rOut: forward ? p.reserveB : p.reserveA, feeBps: p.feeBps };
};

/** What the route looks like to the page (native at the ends as 0x0…0, symbols, impact, first-pair fee) */
function describe(data, a, b, found, amountIn, out) {
    const path = found.path.map((t, n) => ((n === 0 && a === ZERO) || (n === found.path.length - 1 && b === ZERO) ? ZERO : t));
    // Price impact against the current prices (before fees)
    let ideal = amountIn;
    found.path.slice(0, -1).forEach((t, n) => { const s = stepOf(found.pairs[n], t); ideal = s.rIn > 0n ? (ideal * s.rOut) / s.rIn : 0n; });
    const totalFeeBps = found.pairs.reduce((sum, p) => sum + Number(p.feeBps), 0);
    const impactBps = amountIn > 0n && ideal > 0n && out > 0n ? Math.max(0, Number(((ideal - out) * BPS) / ideal) - totalFeeBps) : 0;
    const fee = (amountIn * found.pairs[0].feeBps) / BPS;
    // mid: what amountIn is worth at the pools' current prices (no fee, no impact): prices.js uses it
    return { kind: "swap", path, pairs: found.pairs, in: amountIn, out, mid: ideal, fee, impactBps, hops: found.pairs.length, symbols: path.map((t) => coinIn(data, t)?.symbol ?? "?") };
}

/** Wrap / unwrap (1 : 1), a missing route, or null when it is a real swap */
function special(data, a, b, amount) {
    const none = { kind: "none", path: [], pairs: [], in: 0n, out: 0n, fee: 0n, impactBps: 0, hops: 0, symbols: [] };
    if (!data?.isReady || !a || !b || a === b) return none;
    if (a === ZERO && b === data.wrapped) return { ...none, kind: "wrap", in: amount, out: amount, symbols: [ data.native.symbol, coinIn(data, b)?.symbol ] };
    if (a === data.wrapped && b === ZERO) return { ...none, kind: "unwrap", in: amount, out: amount, symbols: [ coinIn(data, a)?.symbol, data.native.symbol ] };
    if ((a === ZERO ? data.wrapped : a) === (b === ZERO ? data.wrapped : b)) return none;
    return null;
}

/**
 * Exact in: the route that gives the most for `amountIn`, from the page's read (no node call).
 * @returns {{ kind: "wrap" | "unwrap" | "swap" | "none", path: string[], pairs: object[], in: bigint, out: bigint, fee: bigint,
 *            impactBps: number, hops: number, symbols: string[] }}
 */
function bestRoute(data, from, to, amountIn) {
    const a = lower(from);
    const b = lower(to);
    const early = special(data, a, b, amountIn);
    if (early) return early;
    const found = pathsBetween(data, a === ZERO ? data.wrapped : a, b === ZERO ? data.wrapped : b);
    if (!found.length) return special(data, a, a, 0n);
    // Even for an empty amount, find the route (with 1 whole coin) so the page can show the rate
    const probe = amountIn > 0n ? amountIn : 10n ** BigInt(coinIn(data, a)?.decimals ?? 18);
    let best = null;
    for (const f of found) {
        let amount = probe;
        f.path.slice(0, -1).forEach((t, n) => { const s = stepOf(f.pairs[n], t); amount = amountOut(amount, s.rIn, s.rOut, s.feeBps); });
        if (!best || amount > best.out) best = { f, out: amount };
    }
    if (!(best.out > 0n)) return special(data, a, a, 0n);
    return describe(data, a, b, best.f, amountIn, amountIn > 0n ? best.out : 0n);
}

/** Exact out: the route that costs the least to get exactly `amountOut` (the swap page's "You get" field) */
function bestRouteOut(data, from, to, amountWanted) {
    const a = lower(from);
    const b = lower(to);
    const early = special(data, a, b, amountWanted);
    if (early) return early;
    const found = pathsBetween(data, a === ZERO ? data.wrapped : a, b === ZERO ? data.wrapped : b);
    if (!found.length) return special(data, a, a, 0n);
    if (!(amountWanted > 0n)) return { ...bestRoute(data, from, to, 0n), in: 0n, out: 0n };
    let best = null;
    for (const f of found) {
        let need = amountWanted;
        for (let n = f.path.length - 1; n > 0 && need !== null; n--) { const s = stepOf(f.pairs[n - 1], f.path[n - 1]); need = amountInFor(need, s.rIn, s.rOut, s.feeBps); }
        if (need !== null && (!best || need < best.need)) best = { f, need };
    }
    // No route can give that much: say so with the best route's shape and nothing to pay
    if (!best) return { ...bestRoute(data, from, to, 0n), in: 0n, out: amountWanted, tooMuch: true };
    return describe(data, a, b, best.f, best.need, amountWanted);
}

/* ------------------------------------ sending */

const fail = (error, fallback) => normalize(error, box.handleTxError(DexProgram, error), fallback);

// Toast stages: [ "swap", "swapping" ] = before the wallet confirms, then while the chain confirms
const STAGE = { wrap: [ "wrap", "wrapping" ], unwrap: [ "unwrap", "unwrapping" ], swap: [ "swap", "swapping" ], deposit: [ "add", "adding" ], withdraw: [ "remove", "removing" ], create: [ "create", "creating" ] };

async function sendTx(onStep, kind, index, total, call, fallback) {
    const [ stage, sent ] = STAGE[kind];
    onStep({ stage, index, total });
    try {
        const tx = await call();
        onStep({ stage: sent, index, total });
        const receipt = await tx.wait();
        invalidateReads();
        return receipt;
    } catch (error) {
        throw fail(error, fallback);
    }
}

/** Unix seconds a transaction must be in a block by: the chain's clock (from the fresh read) + the visitor's minutes */
function deadlineOf(data, minutes) {
    const chainNow = data.blockTime > 0n ? Number(data.blockTime) + Math.max(0, Math.floor(Date.now() / 1000) - data.readAt) : Math.floor(Date.now() / 1000);
    return BigInt(chainNow + Math.round(Number(minutes) * 60));
}

/**
 * Swap (or wrap / unwrap), with the route found again from a fresh read.
 * mode "in": pay exactly amountIn, get at least out − slippage. mode "out": get exactly amountOut, pay at most in + slippage.
 * @param {object} order  { from, to, mode, amountIn, amountOut, slippageBps, deadlineMinutes }
 */
async function swapCoins(wallet, { from, to, mode = "in", amountIn = 0n, amountOut: wanted = 0n, slippageBps, deadlineMinutes = 20 }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    if (!((mode === "out" ? wanted : amountIn) > 0n)) throw new Error("Enter an amount.");
    onStep({ stage: "checking" });
    const data = await getDexData(wallet, { fresh: true });
    const coin = coinIn(data, from);
    if (!coin) throw new Error("That coin is not in any pair.");
    const route = mode === "out" ? bestRouteOut(data, from, to, wanted) : bestRoute(data, from, to, amountIn);
    const pay = route.kind === "swap" ? route.in : (mode === "out" ? wanted : amountIn);
    const spendable = coin.isNative ? coin.balance - GAS_RESERVE : coin.balance;
    const wrappedProgram = () => box.createProgram(wrappedProgramAt(data.wrapped), wallet.signer);
    if (route.kind === "wrap" || route.kind === "unwrap") {
        if (pay > coin.balance) throw new Error(`Not enough ${coin.symbol} in your wallet.`);
        if (coin.isNative && pay > spendable) throw new Error(`Keep some ${coin.symbol} for gas.`);
        if (route.kind === "wrap") return sendTx(onStep, "wrap", 1, 1, () => wrappedProgram().deposit({}, { value: String(pay) }), "Wrapping did not go through.");
        return sendTx(onStep, "unwrap", 1, 1, () => wrappedProgram().withdraw({ amount: `${pay}n` }), "Unwrapping did not go through.");
    }
    if (route.kind !== "swap") throw new Error("There is no route between these two coins yet.");
    if (data.isPaused) throw new Error("Swaps are paused by the owner. Taking liquidity out still works.");
    if (route.tooMuch) throw new Error("The pools do not hold that much. Ask for less.");
    if (route.out === 0n) throw new Error("The amount is too small to swap.");
    const deadline = deadlineOf(data, deadlineMinutes);
    const dexProgram = () => box.createProgram(DexProgram, wallet.signer);
    if (mode === "out") {
        // Pay at most the quote + slippage, but never more than the wallet can spend
        const maxIn = withSlippageUp(route.in, slippageBps) < spendable ? withSlippageUp(route.in, slippageBps) : spendable;
        if (maxIn < route.in) throw new Error(`Not enough ${coin.symbol} in your wallet${coin.isNative ? " (keep some for gas)" : ""}.`);
        const needsApprove = !coin.isNative && coin.allowance < maxIn;
        const total = needsApprove ? 2 : 1;
        if (needsApprove) await approveIfNeeded({ wallet, token: coin.address, spender: DexProgram.address, amount: maxIn, allowance: coin.allowance, onStep, index: 1, total });
        return sendTx(onStep, "swap", total, total, () => dexProgram().swapExactOut(
            { path: route.path, amountOut: `${wanted}n`, maxIn: `${maxIn}n`, deadline: `${deadline}n` }, coin.isNative ? { value: String(maxIn) } : {}), "The swap did not go through.");
    }
    if (amountIn > coin.balance) throw new Error(`Not enough ${coin.symbol} in your wallet.`);
    if (coin.isNative && amountIn > spendable) throw new Error(`Keep some ${coin.symbol} for gas.`);
    const minOut = withSlippage(route.out, slippageBps);
    const needsApprove = !coin.isNative && coin.allowance < amountIn;
    const total = needsApprove ? 2 : 1;
    if (needsApprove) await approveIfNeeded({ wallet, token: coin.address, spender: DexProgram.address, amount: amountIn, allowance: coin.allowance, onStep, index: 1, total });
    return sendTx(onStep, "swap", total, total, () => dexProgram().swap(
        { path: route.path, amountIn: `${amountIn}n`, minOut: `${minOut}n`, deadline: `${deadline}n` }, coin.isNative ? { value: String(amountIn) } : {}), "The swap did not go through.");
}

/**
 * Adds liquidity to a pair. `amountA` / `amountB` are in the pair's order; `useNative` pays the wBWSC side in BWSC.
 * @param {object} order  { pairId, amountA, amountB, useNative, slippageBps, minShares }
 */
async function addLiquidity(wallet, { pairId, amountA, amountB, useNative = false, minShares = 0n, deadlineMinutes = 20 }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getDexData(wallet, { fresh: true });
    const p = data.pairs.find((x) => x.id === pairId);
    if (!p) throw new Error("That pair does not exist.");
    if (data.isPaused) throw new Error("The exchange is paused: no new deposits. Taking liquidity out still works.");
    if (!(amountA > 0n && amountB > 0n)) throw new Error("Enter both amounts.");
    const sides = [ [ p.tokenA, amountA ], [ p.tokenB, amountB ] ].map(([ t, amount ]) => ({ t, amount, native: useNative && t.address === data.wrapped }));
    for (const s of sides) {
        const coin = s.native ? data.native : s.t;
        if (s.amount > coin.balance - (s.native ? GAS_RESERVE : 0n)) throw new Error(`Not enough ${coin.symbol} in your wallet${s.native ? " (keep some for gas)" : ""}.`);
    }
    const approvals = sides.filter((s) => !s.native && s.t.allowance < s.amount);
    const total = approvals.length + 1;
    let index = 0;
    for (const s of approvals) {
        index += 1;
        await approveIfNeeded({ wallet, token: s.t.address, spender: DexProgram.address, amount: s.amount, allowance: s.t.allowance, onStep, index, total });
    }
    const nativeSide = sides.find((s) => s.native);
    return sendTx(onStep, "deposit", total, total, () => box.createProgram(DexProgram, wallet.signer).addLiquidity({
        tokenA: sides[0].native ? ZERO : p.tokenA.address,
        tokenB: sides[1].native ? ZERO : p.tokenB.address,
        amountA: `${amountA}n`, amountB: `${amountB}n`, minShares: `${minShares}n`, deadline: `${deadlineOf(data, deadlineMinutes)}n`,
    }, nativeSide ? { value: String(nativeSide.amount) } : {}), "The deposit did not go through.");
}

/** Takes `shares` out of a pair; `useNative` pays the wBWSC side as BWSC. minA / minB in the pair's order */
async function removeLiquidity(wallet, { pairId, shares, useNative = false, minA = 0n, minB = 0n, deadlineMinutes = 20 }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getDexData(wallet, { fresh: true });
    const p = data.pairs.find((x) => x.id === pairId);
    if (!p) throw new Error("That pair does not exist.");
    if (!(shares > 0n)) throw new Error("Choose how much to take out.");
    if (shares > p.myShares) throw new Error("That is more than your shares.");
    return sendTx(onStep, "withdraw", 1, 1, () => box.createProgram(DexProgram, wallet.signer).removeLiquidity({
        tokenA: useNative && p.tokenA.address === data.wrapped ? ZERO : p.tokenA.address,
        tokenB: useNative && p.tokenB.address === data.wrapped ? ZERO : p.tokenB.address,
        shares: `${shares}n`, minA: `${minA}n`, minB: `${minB}n`, deadline: `${deadlineOf(data, deadlineMinutes)}n`,
    }), "Taking liquidity out did not go through.");
}

/** A new pair of two tokens (0x0…0 = the native coin). The owner may pick the fee; others get the default */
async function createPair(wallet, { tokenA, tokenB, feeBps }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getDexData(wallet, { fresh: true });
    if (!data.isOwner && !data.openPairs) throw new Error("Only the owner can add pairs.");
    if (pairFor(data, tokenA, tokenB)) throw new Error("This pair already exists.");
    if (lower(tokenA) === lower(tokenB)) throw new Error("Pick two different coins.");
    return sendTx(onStep, "create", 1, 1, () => box.createProgram(DexProgram, wallet.signer).createPair({
        tokenA: lower(tokenA), tokenB: lower(tokenB), feeBps: `${BigInt(feeBps ?? data.defaultFeeBps)}n`,
    }), "The pair was not created.");
}

export { getDexData, coinIn, pairFor, bestRoute, bestRouteOut, swapCoins, addLiquidity, removeLiquidity, createPair, GAS_RESERVE };
