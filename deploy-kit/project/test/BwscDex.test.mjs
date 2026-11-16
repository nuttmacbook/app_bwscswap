/*
 * YOUR CODE (on-chain, tests). BwscDex on the real node: pairs of every kind (token / token, token / native),
 * liquidity with fees to providers, routes over several pairs, native in and out, owner rules, paused rules.
 * Every expected number is worked out here from the reserves, so the program's math is checked, not trusted.
 */

import { utils } from "bwscbox";
import { deployToken } from "./tools.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const BPS = 10_000n;
const units = (text, d = 18) => utils.toUnits(String(text), d);
const out = (amountIn, rIn, rOut, fee) => { const x = amountIn * (BPS - fee); return (x * rOut) / (rIn * BPS + x); };

// What a transaction paid for gas (the receipt's fee), so balance checks are exact whatever the node's base fee is
const feeOf = (receipt) => BigInt(String(receipt?.fee ?? 0).replace(/n$/, ""));

export default async function (t) {
    const DEX = t.deployed.addresses.BwscDex;
    const USDT = t.deployed.addresses.USDT;
    const W = t.deployed.addresses.WBWSC;
    const pairOf = (a, b) => t.read("BwscDex", "getPair", { tokenA: a, tokenB: b });
    const approve = (who, token, amount) => t.send(who, token, "approve", { spender: DEX, amount });
    const bal = (token, who) => t.read(token, "balanceOf", { who });

    // Two more tokens for token / token pairs and long routes (6 decimals on one, like many stablecoins)
    const X = await deployToken(t, "XTK");
    const Y = await deployToken(t, "YTK", { decimals: 6 });
    const alice = t.newWallet();
    const bob = t.newWallet();
    for (const [ token, d ] of [ [ X, 18 ], [ Y, 6 ], [ USDT, 18 ] ]) {
        await t.send(t.owner, token, "transfer", { to: alice.address, amount: units(100_000, d) });
        await t.send(t.owner, token, "transfer", { to: bob.address, amount: units(100_000, d) });
    }

    let v = await t.read("BwscDex", "getView", { account: "", offset: 0n, limit: 10n });
    t.check("starts with no pairs, owned by the deployer, wBWSC as the wrapper", v.pairCount === 0n && v.owner === t.owner.address && v.wrapped === W && !v.paused && !v.openPairs);

    /* ------------------------------------ pairs */

    t.check("only the owner adds pairs (openPairs off)", await t.doesRevert(() => t.send(alice, "BwscDex", "createPair", { tokenA: X, tokenB: USDT }), "Only the owner"));
    let r = await t.send(t.owner, "BwscDex", "createPair", { tokenA: X, tokenB: USDT, feeBps: 30n });
    t.gas("createPair", r);
    t.check("token / token pair: tokens sorted, 0.30% fee", r.result.tokenA === (X < USDT ? X : USDT) && r.result.feeBps === 30n);
    await t.send(t.owner, "BwscDex", "createPair", { tokenA: ZERO, tokenB: USDT });
    const native = await pairOf(ZERO, USDT);
    t.check("native / token pair: 0x0…0 means BWSC, held as wBWSC", native && (native.tokenA === W || native.tokenB === W) && native.feeBps === 30n);
    t.check("the same pair (either order, or wBWSC for 0x0…0) is refused", await t.doesRevert(() => t.send(t.owner, "BwscDex", "createPair", { tokenA: USDT, tokenB: W }), "already exists"));
    t.check("a pair of one token with itself is refused", await t.doesRevert(() => t.send(t.owner, "BwscDex", "createPair", { tokenA: X, tokenB: X }), "different"));
    t.check("a fee above 1% is refused", await t.doesRevert(() => t.send(t.owner, "BwscDex", "createPair", { tokenA: X, tokenB: Y, feeBps: 101n }), "feeBps"));
    t.check("an address that is not a program is refused", await t.doesRevert(() => t.send(t.owner, "BwscDex", "createPair", { tokenA: X, tokenB: alice.address }), "not a token program"));

    await t.send(t.owner, "BwscDex", "setOpenPairs", { open: true });
    await t.send(alice, "BwscDex", "createPair", { tokenA: X, tokenB: Y, feeBps: 5n });
    t.check("openPairs on: anyone adds a pair, with the default fee (not their own)", (await pairOf(X, Y)).feeBps === 30n);
    await t.send(t.owner, "BwscDex", "setOpenPairs", { open: false });

    /* ------------------------------------ liquidity: token / token */

    await approve(alice, X, units(1000));
    await approve(alice, USDT, units(2000));
    r = await t.send(alice, "BwscDex", "addLiquidity", { tokenA: X, tokenB: USDT, amountA: units(1000), amountB: units(2000), minShares: 0n });
    t.gas("addLiquidity", r);
    let p = await pairOf(X, USDT);
    const xIsA = p.tokenA === X;
    const [ rX, rU ] = xIsA ? [ p.reserveA, p.reserveB ] : [ p.reserveB, p.reserveA ];
    t.check("first deposit sets the price: 1000 XTK + 2000 USDT, 1000 shares locked", rX === units(1000) && rU === units(2000) && p.totalShares === r.result.shares + 1000n);
    await approve(bob, X, units(100));
    await approve(bob, USDT, units(500));
    r = await t.send(bob, "BwscDex", "addLiquidity", { tokenA: X, tokenB: USDT, amountA: units(100), amountB: units(500), minShares: 0n });
    t.check("a later deposit takes only what keeps the price (100 XTK + 200 USDT)", r.result.amountA === units(100) && r.result.amountB === units(200));
    t.check("minShares protects against price moves", await t.doesRevert(async () => { await approve(bob, X, units(1)); await approve(bob, USDT, units(2)); return t.send(bob, "BwscDex", "addLiquidity", { tokenA: X, tokenB: USDT, amountA: units(1), amountB: units(2), minShares: units(1_000_000) }); }, "fewer shares"));

    /* ------------------------------------ swaps: token / token, fees to providers */

    p = await pairOf(X, USDT);
    const before = xIsA ? [ p.reserveA, p.reserveB ] : [ p.reserveB, p.reserveA ];
    const want = out(units(10), before[0], before[1], 30n);
    const quoted = await t.read("BwscDex", "quote", { path: [ X, USDT ], amountIn: units(10) });
    t.check("quote = the x·y=k formula with the fee", quoted.at(-1) === want);
    const u0 = await bal(USDT, bob.address);
    await approve(bob, X, units(10));
    r = await t.send(bob, "BwscDex", "swap", { path: [ X, USDT ], amountIn: units(10), minOut: want });
    t.gas("swap (1 pair)", r);
    t.check("swap pays exactly the quote", r.result === want && (await bal(USDT, bob.address)) - u0 === want);
    p = await pairOf(X, USDT);
    const kBefore = before[0] * before[1];
    const kAfter = p.reserveA * p.reserveB;
    t.check("the fee stays in the pair (k grows), so every share is worth more", kAfter > kBefore);
    t.check("minOut above the quote is refused", await t.doesRevert(async () => { await approve(bob, X, units(1)); return t.send(bob, "BwscDex", "swap", { path: [ X, USDT ], amountIn: units(1), minOut: units(100) }); }, "less than your minimum"));

    /* ------------------------------------ native pair: liquidity with value, refund, native in / out */

    const n0 = await t.balance(alice.address);
    await approve(alice, USDT, units(850));
    r = await t.send(alice, "BwscDex", "addLiquidity", { tokenA: ZERO, tokenB: USDT, amountA: units(1000), amountB: units(850), minShares: 0n }, { value: units(1000) });
    t.check("native liquidity: 1000 BWSC as value + 850 USDT", r.result.shares > 0n && n0 - (await t.balance(alice.address)) >= units(1000));
    t.check("value must equal the native amount", await t.doesRevert(() => t.send(alice, "BwscDex", "addLiquidity", { tokenA: ZERO, tokenB: USDT, amountA: units(10), amountB: units(10), minShares: 0n }, { value: units(9) }), "exactly"));
    // A second deposit with too much BWSC: only what the price needs is used, the rest comes back
    await approve(bob, USDT, units(85));
    const b0 = await t.balance(bob.address);
    r = await t.send(bob, "BwscDex", "addLiquidity", { tokenA: ZERO, tokenB: USDT, amountA: units(500), amountB: units(85), minShares: 0n }, { value: units(500) });
    const usedNative = r.result.amountA;   // amounts come back in the order the tokens were named (tokenA = 0x0…0)
    t.check("…extra native coins come back (100 used, 400 returned)", usedNative === units(100) && b0 - (await t.balance(bob.address)) === units(100) + feeOf(r));
    t.check("wBWSC in the program = the native pair's reserve (all wrapped)", (await bal(W, DEX)) === ((await pairOf(ZERO, USDT)).tokenA === W ? (await pairOf(ZERO, USDT)).reserveA : (await pairOf(ZERO, USDT)).reserveB));

    // Native in
    let np = await pairOf(ZERO, USDT);
    const wIsA = np.tokenA === W;
    let wantU = out(units(50), wIsA ? np.reserveA : np.reserveB, wIsA ? np.reserveB : np.reserveA, np.feeBps);
    const bu = await bal(USDT, bob.address);
    r = await t.send(bob, "BwscDex", "swap", { path: [ ZERO, USDT ], amountIn: units(50), minOut: 0n }, { value: units(50) });
    t.gas("swap native in", r);
    t.check("BWSC → USDT: send coins as value, get USDT", r.result === wantU && (await bal(USDT, bob.address)) - bu === wantU);
    t.check("native in without the value is refused", await t.doesRevert(() => t.send(bob, "BwscDex", "swap", { path: [ ZERO, USDT ], amountIn: units(1), minOut: 0n }), "exactly"));
    // Native out
    np = await pairOf(ZERO, USDT);
    const wantN = out(units(20), wIsA ? np.reserveB : np.reserveA, wIsA ? np.reserveA : np.reserveB, np.feeBps);
    await approve(bob, USDT, units(20));
    const bn = await t.balance(bob.address);
    r = await t.send(bob, "BwscDex", "swap", { path: [ USDT, ZERO ], amountIn: units(20), minOut: wantN });
    t.gas("swap native out", r);
    t.check("USDT → BWSC: coins arrive as native coins", r.result === wantN && (await t.balance(bob.address)) - bn === wantN - feeOf(r));
    t.check("the exchange keeps no loose native coins", (await t.balance(DEX)) === 0n);

    /* ------------------------------------ routes over several pairs */

    // X → USDT → BWSC (2 pairs), native out at the end
    const q = await t.read("BwscDex", "quote", { path: [ X, USDT, ZERO ], amountIn: units(5) });
    const xp = await pairOf(X, USDT);
    const step1 = out(units(5), xIsA ? xp.reserveA : xp.reserveB, xIsA ? xp.reserveB : xp.reserveA, xp.feeBps);
    np = await pairOf(ZERO, USDT);
    const step2 = out(step1, wIsA ? np.reserveB : np.reserveA, wIsA ? np.reserveA : np.reserveB, np.feeBps);
    t.check("a 2-pair route quotes step by step", q.length === 3 && q.at(1) === step1 && q.at(2) === step2);
    await approve(bob, X, units(5));
    r = await t.send(bob, "BwscDex", "swap", { path: [ X, USDT, ZERO ], amountIn: units(5), minOut: step2 });
    t.gas("swap (2 pairs)", r);
    t.check("…and the swap pays the last step's amount in native coins", r.result === step2);
    t.check("a path through a missing pair is refused", await t.doesRevert(() => t.read("BwscDex", "quote", { path: [ Y, ZERO ], amountIn: 1n }), "no pair"));
    t.check("native in the middle of a path is refused", await t.doesRevert(() => t.read("BwscDex", "quote", { path: [ X, ZERO, USDT ], amountIn: 1n }), "start or end"));
    t.check("more than 3 pairs is refused", await t.doesRevert(() => t.read("BwscDex", "quote", { path: [ X, Y, USDT, W, ZERO ], amountIn: 1n }), "2 to 4"));

    /* ------------------------------------ taking liquidity out */

    const nativeId = (await pairOf(ZERO, USDT)).id;
    const xId = (await pairOf(X, USDT)).id;
    const mine = (await t.read("BwscDex", "getView", { account: bob.address, offset: 0n, limit: 10n })).pairs.find((x) => x.id === nativeId).myShares;
    np = await pairOf(ZERO, USDT);
    const expectW = (mine * (wIsA ? np.reserveA : np.reserveB)) / np.totalShares;
    const bn2 = await t.balance(bob.address);
    r = await t.send(bob, "BwscDex", "removeLiquidity", { tokenA: ZERO, tokenB: USDT, shares: mine, minA: 0n, minB: 0n });
    t.gas("removeLiquidity", r);
    t.check("remove with 0x0…0: the wBWSC side comes back as native coins", r.result.amountA === expectW && (await t.balance(bob.address)) - bn2 === expectW - feeOf(r));
    t.check("removing more shares than you have is refused", await t.doesRevert(() => t.send(bob, "BwscDex", "removeLiquidity", { tokenA: ZERO, tokenB: USDT, shares: 1n, minA: 0n, minB: 0n }), "that many shares"));

    /* ------------------------------------ owner, pause */

    t.check("only the owner sets a pair's fee", await t.doesRevert(() => t.send(alice, "BwscDex", "setPairFee", { tokenA: X, tokenB: USDT, feeBps: 10n }), "Only the owner"));
    await t.send(t.owner, "BwscDex", "setPairFee", { tokenA: X, tokenB: USDT, feeBps: 10n });
    t.check("the owner changes one pair's fee", (await pairOf(X, USDT)).feeBps === 10n);
    await t.send(t.owner, "BwscDex", "setPaused", { paused: true });
    t.check("paused: no swaps", await t.doesRevert(async () => { await approve(bob, X, units(1)); return t.send(bob, "BwscDex", "swap", { path: [ X, USDT ], amountIn: units(1), minOut: 0n }); }, "paused"));
    const aliceShares = (await t.read("BwscDex", "getView", { account: alice.address, offset: 0n, limit: 10n })).pairs.find((x) => x.id === xId).myShares;
    t.check("paused: taking liquidity out still works", !(await t.doesRevert(() => t.send(alice, "BwscDex", "removeLiquidity", { tokenA: X, tokenB: USDT, shares: aliceShares / 2n, minA: 0n, minB: 0n }))));
    await t.send(t.owner, "BwscDex", "setPaused", { paused: false });

    /* ------------------------------------ accounting */

    v = await t.read("BwscDex", "getView", { account: alice.address, offset: 0n, limit: 100n });
    const reserveOf = (token) => v.pairs.reduce((s, x) => s + (x.tokenA === token ? x.reserveA : 0n) + (x.tokenB === token ? x.reserveB : 0n), 0n);
    t.check("every token: reserves of all pairs = what the exchange holds", v.tokens.every((tk) => reserveOf(tk.address) === tk.held), v.tokens.map((tk) => `${tk.symbol} ${reserveOf(tk.address)} / ${tk.held}`).join(", "));
    t.check("getView lists each token once with your balance and allowance", v.tokens.length === new Set(v.tokens.map((x) => x.address)).size && v.tokens.every((x) => typeof x.balance === "bigint"));
    const page = await t.read("BwscDex", "getView", { account: "", offset: 1n, limit: 1n });
    t.check("getView pages: offset 1, limit 1 → the second pair", page.pairs.length === 1 && page.pairs[0].index === 1n && page.pairCount === 3n);
}
