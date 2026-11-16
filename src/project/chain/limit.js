/*
 * YOUR CODE (on-chain). Limit orders (BwscLimit): coin for coin at the maker's price, on Bluewolfchain.
 *
 * Reads, built for hundreds of coins and orders:
 *   getLimitData(wallet, { give, want })  the listed coins and every market (pages of 200, read in parallel), the
 *                                         chosen market's open orders (all of them, ≤ 500, sorted best rate first),
 *                                         the wallet's balances of its two coins, and the Swap price to compare with
 *   getMyOrders(wallet, { offset, limit }) a wallet's orders (yours, or a seller's), newest first, 50 a page
 * Actions: placeLimitOrder, fillLimitOrder, cancelLimitOrder; owner: addLimitCoin, setLimitCoin, withdrawLimitFees.
 *
 * Rate everywhere = how much of the want coin one whole give coin costs (wantAmount / giveAmount, in want's smallest
 * units per 1 whole give). For the taker lower is better; lists are sorted best first.
 */

import { box } from "../../engine/chain/connect";
import { cachedRead, invalidateReads } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { normalize } from "../../engine/chain/txError";
import { approveIfNeeded } from "../../engine/chain/token";
import { ZERO } from "../../engine/settings";
import { LimitProgram } from "./programs";
import { HUB, coinOf, nativeCoin } from "./coins";
import { getDexData, bestRoute } from "./dex";

const PAGE = 200n;
const MY_PAGE = 50n;
const GAS_RESERVE = 10n ** 16n;   // 0.01 native coin kept for gas when giving or paying the native coin
const lower = (a) => String(a ?? "").toLowerCase();
const limit = () => metered(box.createReader(LimitProgram), "BwscLimit");
const isReady = () => LimitProgram.address !== ZERO;

/** A listed coin as pages show it (settings names first, then what the coin says about itself) */
const coinFrom = (c) => {
    const base = lower(c.token) === ZERO ? nativeCoin(HUB) : null;
    const coin = coinOf(HUB, { address: c.token, symbol: base?.symbol ?? c.symbol, name: base?.name ?? c.name, decimals: Number(c.decimals) });
    return { ...coin, feeBps: Number(c.feeBps), enabled: c.enabled, held: c.held, fees: c.fees };
};

/** Rate of an order: want smallest units per 1 whole give coin */
const rateOf = (o, giveDecimals) => (o.wantAmount * 10n ** BigInt(giveDecimals)) / o.giveAmount;

/** What filling `amount` costs and pays (same math as the program: cost rounded up for the maker) */
function priceFor(o, amount, feeBps) {
    const cost = (amount * o.wantAmount + o.giveAmount - 1n) / o.giveAmount;
    const fee = (amount * BigInt(feeBps)) / 10_000n;
    return { amount, cost, fee, receive: amount - fee };
}

/** The most of an order's coin that `budget` of its want coin buys */
const amountForBudget = (o, budget) => (budget * o.giveAmount) / o.wantAmount;

/** Every listed coin and every market, each page of 200 read in parallel after the first */
async function readAll(fresh) {
    const first = await cachedRead(`limit:view:0`, () => limit().methods.getView({ account: "", offset: "0n", limit: `${PAGE}n` }).call(), { fresh });
    const count = BigInt(first.marketCount ?? 0);
    const rest = [];
    for (let offset = PAGE; offset < count; offset += PAGE) {
        rest.push(cachedRead(`limit:view:${offset}`, () => limit().methods.getView({ account: "", offset: `${offset}n`, limit: `${PAGE}n` }).call(), { fresh }));
    }
    const pages = [ first, ...(await Promise.all(rest)) ];
    return { view: first, markets: pages.flatMap((p) => p.markets) };
}

/**
 * The limit page's data.
 * @param {object} wallet
 * @param {{ give?: string, want?: string, fresh?: boolean }} pick  the market to open (addresses; empty = none yet)
 */
async function getLimitData(wallet, { give = "", want = "", fresh = false } = {}) {
    const base = { wallet, isConnected: Boolean(wallet?.address) };
    if (!isReady()) return { ...base, isReady: false, coins: [], markets: [] };
    const who = lower(wallet?.address);
    const [ all, dexData ] = await Promise.all([ readAll(fresh), getDexData(wallet, { fresh }).catch(() => null) ]);
    const { view } = all;
    const coins = view.coins.map(coinFrom);
    const coinBy = (address) => coins.find((c) => c.address === lower(address)) ?? null;
    const now = Number(view.now);

    // Markets with their best rate (expired best orders still count until they are cleared; the list says so)
    const markets = all.markets.map((m) => {
        const g = coinBy(m.give);
        const w = coinBy(m.want);
        return {
            give: g, want: w, open: Number(m.open), orders: Number(m.orders),
            best: m.best ? { order: m.best.order, rate: g ? rateOf(m.best, g.decimals) : 0n, left: m.best.left, ended: m.best.expiresAt > 0n && Number(m.best.expiresAt) <= now } : null,
        };
    }).filter((m) => m.give && m.want);

    // The chosen market: every open order (≤ 500, so at most 3 reads), sorted best rate first
    let market = null;
    const g = coinBy(give);
    const w = coinBy(want);
    if (g && w && g.address !== w.address) {
        const read = (offset) => cachedRead(`limit:market:${g.address}:${w.address}:${who}:${offset}`, () => limit().methods.getMarket({ give: g.address, want: w.address, account: who, offset: `${offset}n`, limit: `${PAGE}n` }).call(), { fresh });
        const first = await read(0n);
        const more = [];
        for (let offset = PAGE; offset < BigInt(first.open ?? 0); offset += PAGE) more.push(read(offset));
        const raw = [ first, ...(await Promise.all(more)) ].flatMap((p) => p.orders);
        const orders = raw.map((o) => ({
            id: o.id, maker: o.maker, giveAmount: o.giveAmount, wantAmount: o.wantAmount, left: o.left, received: o.received,
            partial: o.partial, expiresAt: Number(o.expiresAt), createdAt: Number(o.createdAt), fills: Number(o.fills),
            ended: o.expiresAt > 0n && Number(o.expiresAt) <= now, mine: Boolean(who) && o.maker === who,
            rate: rateOf(o, g.decimals), costLeft: priceFor(o, o.left, g.feeBps).cost,
        }));
        // What one whole give coin costs on Swap now (null when there is no route)
        let swapRate = null;
        if (dexData?.isReady) {
            const route = bestRoute(dexData, g.address, w.address, 10n ** BigInt(g.decimals));
            if (route.kind === "swap" && route.mid > 0n) swapRate = route.mid;
            else if (route.kind === "wrap" || route.kind === "unwrap") swapRate = 10n ** BigInt(w.decimals);
        }
        market = {
            give: { ...g, balance: first.balances.give, allowance: first.allowances.give },
            want: { ...w, balance: first.balances.want, allowance: first.allowances.want },
            orders, open: orders.length, swapRate,
        };
    }

    return {
        ...base, isReady: true, isOwner: Boolean(who) && who === view.owner, owner: view.owner, paused: view.paused, now,
        maxFeeBps: Number(view.maxFeeBps), maxOpenPerMarket: Number(view.maxOpenPerMarket), orderCount: Number(view.orderCount),
        coins, markets, market, native: view.native, gasReserve: GAS_RESERVE,
    };
}

/** The wallet's orders, newest first (a page of 50) */
async function getMyOrders(wallet, { offset = 0, limit: size = Number(MY_PAGE), fresh = false } = {}) {
    const who = lower(wallet?.address);
    if (!isReady() || !who) return { count: 0, orders: [] };
    const page = await cachedRead(`limit:mine:${who}:${offset}:${size}`, () => limit().methods.getOrdersOf({ account: who, offset: `${offset}n`, limit: `${size}n` }).call(), { fresh });
    return { count: Number(page.count), offset: Number(page.offset), now: Number(page.now), orders: page.orders };
}

/* ------------------------------------ actions */

const needWallet = (wallet) => { if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected."); };

/** Sends one call; `sentStage` is shown while the block confirms it */
async function send(onStep, sentStage, total, call, fallback) {
    try {
        const tx = await call();
        onStep({ stage: sentStage, index: total, total });
        const receipt = await tx.wait();
        invalidateReads();
        return receipt;
    } catch (error) {
        throw normalize(error, box.handleTxError(LimitProgram, error), fallback);
    }
}

/**
 * Places an order: give `giveAmount` of `give`, ask `wantAmount` of `want`.
 * @param {{ give, want, giveAmount, wantAmount, partial, endsInSeconds }} order  endsInSeconds 0 = no end
 */
async function placeLimitOrder(wallet, { give, want, giveAmount, wantAmount, partial = true, endsInSeconds = 0 }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    onStep({ stage: "checking" });
    const data = await getLimitData(wallet, { give, want, fresh: true });
    if (data.paused) throw new Error("Limit orders are paused by the owner. Cancelling still works.");
    const m = data.market;
    if (!m) throw new Error("Pick two different listed coins.");
    if (!m.give.enabled || !m.want.enabled) throw new Error("One of these coins is turned off for now.");
    if (!(giveAmount > 0n) || !(wantAmount > 0n)) throw new Error("Enter both amounts.");
    if (giveAmount > m.give.balance) throw new Error(`Not enough ${m.give.symbol} in your wallet.`);
    if (m.give.isNative && giveAmount > m.give.balance - GAS_RESERVE) throw new Error(`Keep some ${m.give.symbol} for gas.`);
    if (m.open >= data.maxOpenPerMarket) throw new Error("This market is full for now. Try again later.");
    const expiresAt = endsInSeconds > 0 ? BigInt(data.now + Math.round(endsInSeconds)) : 0n;
    const needsApprove = !m.give.isNative && m.give.allowance < giveAmount;
    const total = needsApprove ? 2 : 1;
    if (needsApprove) await approveIfNeeded({ wallet, token: m.give.address, spender: LimitProgram.address, amount: giveAmount, allowance: m.give.allowance, onStep, index: 1, total });
    onStep({ stage: "place", index: total, total });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "placing", total, () => program.placeOrder({ give: m.give.address, giveAmount: `${giveAmount}n`, want: m.want.address, wantAmount: `${wantAmount}n`, partial: Boolean(partial), expiresAt: `${expiresAt}n` }, m.give.isNative ? { value: String(giveAmount) } : {}), "The order was not placed.");
}

/** Fills `amount` of order `id` (the market's give coin), paying its rate in the want coin */
async function fillLimitOrder(wallet, { give, want, id, amount }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    onStep({ stage: "checking" });
    const data = await getLimitData(wallet, { give, want, fresh: true });
    if (data.paused) throw new Error("Limit orders are paused by the owner.");
    const m = data.market;
    const o = m?.orders.find((x) => x.id === BigInt(id));
    if (!o) throw new Error("This order is no longer open: someone filled it or it was cancelled.");
    if (o.mine) throw new Error("This is your own order.");
    if (o.ended) throw new Error("This order has ended.");
    if (!(amount > 0n)) throw new Error("Enter how much you want.");
    if (amount > o.left) throw new Error(`Only ${o.left} left in this order.`);
    if (!o.partial && amount !== o.left) throw new Error("This order is sold all at once.");
    const p = priceFor(o, amount, m.give.feeBps);
    if (p.cost > m.want.balance) throw new Error(`Not enough ${m.want.symbol} in your wallet.`);
    if (m.want.isNative && p.cost > m.want.balance - GAS_RESERVE) throw new Error(`Keep some ${m.want.symbol} for gas.`);
    const needsApprove = !m.want.isNative && m.want.allowance < p.cost;
    const total = needsApprove ? 2 : 1;
    if (needsApprove) await approveIfNeeded({ wallet, token: m.want.address, spender: LimitProgram.address, amount: p.cost, allowance: m.want.allowance, onStep, index: 1, total });
    onStep({ stage: "fill", index: total, total });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "filling", total, () => program.fill({ order: `${o.id}n`, amount: `${amount}n` }, m.want.isNative ? { value: String(p.cost) } : {}), "The order was not filled.");
}

/** Maker: ends an order and takes back what was not filled (works paused, ended or not) */
async function cancelLimitOrder(wallet, { id }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    onStep({ stage: "cancel", index: 1, total: 1 });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "cancelling", 1, () => program.cancel({ order: `${BigInt(id)}n` }), "The order was not cancelled.");
}

/** Owner: allow a coin (a token address, or 0x0…0 for the native coin) with its fee in basis points */
async function addLimitCoin(wallet, { token, feeBps }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(token))) throw new Error("Paste the coin's address (0x + 40 characters).");
    const fee = BigInt(Math.round(Number(feeBps)));
    if (!(fee >= 0n && fee <= 500n)) throw new Error("The fee is 0 to 500 basis points (0% to 5%).");
    onStep({ stage: "coin", index: 1, total: 1 });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "saving", 1, () => program.addCoin({ token: lower(token), feeBps: `${fee}n` }), "The coin was not added.");
}

/** Owner: turn a coin on or off and set its fee */
async function setLimitCoin(wallet, { token, enabled, feeBps }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    const fee = BigInt(Math.round(Number(feeBps)));
    if (!(fee >= 0n && fee <= 500n)) throw new Error("The fee is 0 to 500 basis points (0% to 5%).");
    onStep({ stage: "coin", index: 1, total: 1 });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "saving", 1, () => program.setCoin({ token: lower(token), enabled: Boolean(enabled), feeBps: `${fee}n` }), "The coin was not changed.");
}

/** Owner: the fees collected in one coin, to the owner's wallet */
async function withdrawLimitFees(wallet, { token }, { onStep = () => {} } = {}) {
    needWallet(wallet);
    onStep({ stage: "coin", index: 1, total: 1 });
    const program = box.createProgram(LimitProgram, wallet.signer);
    return send(onStep, "saving", 1, () => program.withdrawFees({ token: lower(token), to: lower(wallet.address) }), "The fees were not withdrawn.");
}

export { getLimitData, getMyOrders, placeLimitOrder, fillLimitOrder, cancelLimitOrder, addLimitCoin, setLimitCoin, withdrawLimitFees, priceFor, amountForBudget, rateOf };
