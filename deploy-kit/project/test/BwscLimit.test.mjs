/*
 * YOUR CODE (on-chain, tests). BwscLimit: listed coins with their own fees (owner only), placing orders (token and
 * native), the best rate of every market, partial and whole fills (the price straight to the maker, the coin to the
 * taker less its fee), cancel (always), ended orders, coins turned off, pause, fees, pages, and the counters per coin.
 */

import { utils } from "bwscbox";
import { deployToken } from "./tools.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text) => utils.toUnits(String(text), 18);
const feeOf = (receipt) => BigInt(String(receipt?.fee ?? 0).replace(/n$/, ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
    const { deployed } = t;
    const LIMIT = deployed.addresses.BwscLimit;
    const USDT = deployed.addresses.USDT;
    const view = () => t.read("BwscLimit", "getView", { account: "", offset: 0n, limit: 200n });
    const market = (give, want, account = "") => t.read("BwscLimit", "getMarket", { give, want, account, offset: 0n, limit: 200n });
    const order = (id) => t.read("BwscLimit", "getOrder", { order: id });
    const bal = (token, who) => (token === ZERO ? t.balance(who) : t.read(token, "balanceOf", { who }));
    const approve = (who, token, amount) => t.send(who, token, "approve", { spender: LIMIT, amount });
    const place = async (who, give, giveAmount, want, wantAmount, { partial = true, expiresAt = 0n } = {}) => {
        if (give !== ZERO) await approve(who, give, giveAmount);
        const r = await t.send(who, "BwscLimit", "placeOrder", { give, giveAmount, want, wantAmount, partial, expiresAt }, { value: give === ZERO ? giveAmount : 0n });
        return r.result;
    };
    const fill = async (who, id, amount, { approveWant = true } = {}) => {
        const o = await order(id);
        const price = await t.read("BwscLimit", "priceOf", { order: id, amount });
        if (o.want !== ZERO && approveWant) await approve(who, o.want, price.cost);
        return t.send(who, "BwscLimit", "fill", { order: id, amount }, { value: o.want === ZERO ? price.cost : 0n });
    };
    const countersOk = async () => {
        const v = await view();
        for (const c of v.coins) {
            const held = c.token === ZERO ? v.native.balance : await t.read(c.token, "balanceOf", { who: LIMIT });
            if (c.token === ZERO ? held < c.held + c.fees : held !== c.held + c.fees) return false;
        }
        return true;
    };

    /* ------------------------------------ coins */

    let v = await view();
    t.check("starts with the native coin, USDT and wBWSC listed, not paused", v.coins.length === 3 && v.coins.at(0).token === ZERO && v.coins.at(1).token === USDT && v.coins.at(1).symbol === "USDT" && v.coins.at(1).decimals === 18n && !v.paused && v.owner === t.owner.address);
    const GOLD = await deployToken(t, "GOLD");
    const SIX = await deployToken(t, "SIX", { decimals: 6 });
    const stranger = t.newWallet();
    t.check("only the owner lists coins", await t.doesRevert(() => t.send(stranger, "BwscLimit", "addCoin", { token: GOLD, feeBps: 10n }), "Only the owner"));
    t.check("a fee above 5% is refused", await t.doesRevert(() => t.send(t.owner, "BwscLimit", "addCoin", { token: GOLD, feeBps: 501n }), "feeBps"));
    t.check("an address that is not a token is refused", await t.doesRevert(() => t.send(t.owner, "BwscLimit", "addCoin", { token: stranger.address, feeBps: 10n }), "not a token"));
    await t.send(t.owner, "BwscLimit", "addCoin", { token: GOLD, feeBps: 50n });
    await t.send(t.owner, "BwscLimit", "addCoin", { token: SIX, feeBps: 0n });
    t.check("listing the same coin twice is refused", await t.doesRevert(() => t.send(t.owner, "BwscLimit", "addCoin", { token: GOLD, feeBps: 10n }), "already listed"));
    v = await view();
    const gold = v.coins.find((c) => c.token === GOLD);
    t.check("owner listed GOLD (0.5% fee) and a 6-decimal coin: name and decimals read once", gold.symbol === "GOLD" && gold.feeBps === 50n && v.coins.find((c) => c.token === SIX).decimals === 6n && v.coins.length === 5);

    /* ------------------------------------ placing */

    const maker = t.newWallet();
    const maker2 = t.newWallet();
    const taker = t.newWallet();
    await t.send(t.owner, GOLD, "transfer", { to: maker.address, amount: units(1000) });
    await t.send(t.owner, GOLD, "transfer", { to: maker2.address, amount: units(1000) });
    await t.send(t.owner, "USDT", "transfer", { to: taker.address, amount: units(10000) });
    await t.send(t.owner, "USDT", "transfer", { to: maker.address, amount: units(1000) });

    t.check("give and want must differ", await t.doesRevert(() => place(maker, GOLD, units(1), GOLD, units(1)), "different"));
    t.check("an unlisted coin is refused", await t.doesRevert(() => place(maker, GOLD, units(1), stranger.address, units(1)), "not a listed coin"));
    t.check("an end time in the past is refused", await t.doesRevert(() => place(maker, GOLD, units(1), USDT, units(1), { expiresAt: 1n }), "expiresAt"));
    t.check("native coin needs exactly the amount as value", await t.doesRevert(() => t.send(maker, "BwscLimit", "placeOrder", { give: ZERO, giveAmount: units(1), want: USDT, wantAmount: units(1), partial: true, expiresAt: 0n }, { value: units("0.5") }), "exactly"));

    const g0 = await bal(GOLD, maker.address);
    const a = await place(maker, GOLD, units(100), USDT, units(230));                      // 2.30 USDT per GOLD
    const b = await place(maker2, GOLD, units(50), USDT, units("112.5"));                  // 2.25: better
    const c = await place(maker2, GOLD, units(10), USDT, units(26), { partial: false });  // 2.60: worse, all at once
    t.check("orders are numbered 1, 2, 3; the coins wait in the program", a === 1n && b === 2n && c === 3n && g0 - (await bal(GOLD, maker.address)) === units(100));
    let m = await market(GOLD, USDT, taker.address);
    t.check("the market lists 3 open orders, its best rate is order 2 (2.25), the taker's balances come along", m.open === 3n && m.best === b && m.balances.want === units(10000) && m.orders.length === 3);
    v = await view();
    t.check("markets page: GOLD → USDT with 3 open, best order 2", v.marketCount === 1n && v.markets.at(0).give === GOLD && v.markets.at(0).open === 3n && v.markets.at(0).best.order === b);
    t.check("counters: held per coin = what the program holds", await countersOk());

    /* ------------------------------------ filling */

    t.check("the maker cannot fill their own order", await t.doesRevert(() => fill(maker2, b, units(1)), "own order"));
    t.check("more than is left is refused", await t.doesRevert(() => fill(taker, b, units(51)), "left"));
    t.check("an all-at-once order cannot be filled in part", await t.doesRevert(() => fill(taker, c, units(5)), "all at once"));

    const tu0 = await bal(USDT, taker.address);
    const mu0 = await bal(USDT, maker2.address);
    let r = await fill(taker, b, units(20));
    // 20 GOLD at 2.25 = 45 USDT to the maker; the taker gets 20 GOLD less 0.5% = 19.9
    t.check("partial fill: 45 USDT straight to the maker, the taker gets 19.9 GOLD (0.5% fee)", r.result.paid === units(45) && (await bal(USDT, maker2.address)) - mu0 === units(45) && tu0 - (await bal(USDT, taker.address)) === units(45) && (await bal(GOLD, taker.address)) === units("19.9"));
    let ob = await order(b);
    t.check("the order shows 30 left, 45 received, still open", ob.left === units(30) && ob.received === units(45) && ob.status === "open" && ob.fills === 1n);
    // A price that does not divide evenly is rounded up for the maker
    const p = await t.read("BwscLimit", "priceOf", { order: a, amount: 1n });
    t.check("1 smallest unit at 2.30 costs 3 units (rounded up for the maker)", p.cost === 3n);

    await fill(taker, b, units(30));
    ob = await order(b);
    m = await market(GOLD, USDT);
    t.check("filled to the end: order 2 is filled and leaves the market; the best rate moves to order 1 (2.30)", ob.status === "filled" && ob.left === 0n && m.open === 2n && m.best === a);
    t.check("filling a filled order is refused", await t.doesRevert(() => fill(taker, b, units(1)), "filled"));
    await fill(taker, c, units(10));
    t.check("the all-at-once order filled whole", (await order(c)).status === "filled" && (await market(GOLD, USDT)).open === 1n);

    /* ------------------------------------ native coin on either side */

    const n = await place(maker, ZERO, units(10), USDT, units(25));
    await approve(taker, USDT, units(10));
    const nn0 = await t.balance(taker.address);
    r = await fill(taker, n, units(4), { approveWant: false });
    t.check("native given: the taker gets 4 native less 0.1% (gas apart), the maker 10 USDT", (await t.balance(taker.address)) - nn0 + feeOf(r) === units("3.996") && r.result.paid === units(10));
    const w = await place(maker, USDT, units(20), ZERO, units(8));
    const mn0 = await t.balance(maker.address);
    t.check("native asked: wrong value refused", await t.doesRevert(() => t.send(taker, "BwscLimit", "fill", { order: w, amount: units(10) }, { value: units(1) }), "exactly"));
    await fill(taker, w, units(10));
    t.check("native asked: the maker receives the 4 native price", (await t.balance(maker.address)) - mn0 === units(4));

    /* ------------------------------------ cancel, ended orders */

    t.check("only the maker cancels", await t.doesRevert(() => t.send(taker, "BwscLimit", "cancel", { order: a }), "Only the maker"));
    const ga = await bal(GOLD, maker.address);
    r = await t.send(maker, "BwscLimit", "cancel", { order: a });
    t.check("cancel returns the 100 GOLD not filled; the market is empty", r.result === units(100) && (await bal(GOLD, maker.address)) - ga === units(100) && (await market(GOLD, USDT)).open === 0n && (await market(GOLD, USDT)).best === 0n);
    t.check("cancelling twice is refused", await t.doesRevert(() => t.send(maker, "BwscLimit", "cancel", { order: a }), "cancelled"));

    const now = (await view()).now;
    const e = await place(maker, GOLD, units(5), USDT, units(10), { expiresAt: now + 3n });
    t.check("returnExpired before the end is refused", await t.doesRevert(() => t.send(taker, "BwscLimit", "returnExpired", { order: e }), "not ended"));
    await wait(4500);
    await t.send(t.owner, "USDT", "transfer", { to: t.owner.address, amount: 1n });   // a new block (time moves on)
    t.check("an ended order cannot be filled", await t.doesRevert(() => fill(taker, e, units(1)), "ended"));
    const ge = await bal(GOLD, maker.address);
    await t.send(taker, "BwscLimit", "returnExpired", { order: e });
    t.check("anyone sends an ended order's coins back to its maker", (await bal(GOLD, maker.address)) - ge === units(5) && (await order(e)).status === "expired");

    /* ------------------------------------ coin off, pause */

    const f = await place(maker, GOLD, units(5), USDT, units(10));
    await t.send(t.owner, "BwscLimit", "setCoin", { token: GOLD, enabled: false, feeBps: 50n });
    t.check("coin turned off: no new orders", await t.doesRevert(() => place(maker, GOLD, units(1), USDT, units(1)), "turned off"));
    t.check("coin turned off: no fills", await t.doesRevert(() => fill(taker, f, units(1)), "turned off"));
    await t.send(t.owner, "BwscLimit", "setCoin", { token: GOLD, enabled: true, feeBps: 100n });
    t.check("on again, with a new fee of 1%", (await view()).coins.find((x) => x.token === GOLD).feeBps === 100n);
    await t.send(t.owner, "BwscLimit", "setPaused", { paused: true });
    t.check("paused: no new orders, no fills", (await t.doesRevert(() => place(maker, GOLD, units(1), USDT, units(1)), "paused")) && (await t.doesRevert(() => fill(taker, f, units(1)), "paused")));
    await t.send(maker, "BwscLimit", "cancel", { order: f });
    t.check("paused: cancel still works", (await order(f)).status === "cancelled");
    await t.send(t.owner, "BwscLimit", "setPaused", { paused: false });

    /* ------------------------------------ fees, pages, counters */

    v = await view();
    const goldFees = v.coins.find((x) => x.token === GOLD).fees;
    t.check("fees collected: 0.5% of the 60 GOLD filled = 0.3", goldFees === units("0.3"));
    t.check("only the owner withdraws fees", await t.doesRevert(() => t.send(taker, "BwscLimit", "withdrawFees", { token: GOLD, to: taker.address }), "Only the owner"));
    const og = await bal(GOLD, stranger.address);
    await t.send(t.owner, "BwscLimit", "withdrawFees", { token: GOLD, to: stranger.address });
    t.check("owner withdraws the fees to any wallet; never the orders' coins", (await bal(GOLD, stranger.address)) - og === units("0.3") && (await view()).coins.find((x) => x.token === GOLD).fees === 0n);

    const mine = await t.read("BwscLimit", "getOrdersOf", { account: maker.address, offset: 0n, limit: 2n });
    t.check("my orders: newest first, a page at a time", mine.count === 5n && mine.orders.length === 2 && mine.orders.at(0).id === f && mine.orders.at(1).id === e);
    v = await view();
    t.check("markets: GOLD→USDT, native→USDT, USDT→native", v.marketCount === 3n);
    t.check("counters still match what the program holds", await countersOk());

    // Many orders in one market: the best rate is found again when the best one leaves
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await place(maker2, GOLD, units(1), USDT, units(3 + i)));
    m = await market(GOLD, USDT);
    t.check("6 orders: best is the cheapest", m.open === 6n && m.best === ids.at(0));
    await t.send(maker2, "BwscLimit", "cancel", { order: ids.at(0) });
    await t.send(maker2, "BwscLimit", "cancel", { order: ids.at(3) });
    m = await market(GOLD, USDT);
    t.check("best leaves → the next cheapest becomes best; the open list stays whole", m.open === 4n && m.best === ids.at(1) && m.orders.map((o) => o.id).sort().join() === [ ids.at(1), ids.at(2), ids.at(4), ids.at(5) ].sort().join());
    const page = await t.read("BwscLimit", "getMarket", { give: GOLD, want: USDT, account: "", offset: 2n, limit: 2n });
    t.check("market pages: offset 2, limit 2", page.orders.length === 2 && page.offset === 2n);
}
