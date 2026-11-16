/*
 * YOUR CODE (on-chain, tests). What BwscDex v2 adds, on the real node: deadlines, a receiver (to), exact-out swaps,
 * movable shares, time-weighted prices, skim, and an upgrade from v1 that keeps every pair and share.
 * Expected numbers are worked out here from the reserves, so the program's math is checked, not trusted.
 */

import fs from "node:fs";
import { utils } from "bwscbox";
import { deployProgram, deployToken } from "./tools.mjs";
import { sendAndWait } from "../../engine/deploy-steps.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const BPS = 10_000n;
const units = (text, d = 18) => utils.toUnits(String(text), d);
const outFor = (amountIn, rIn, rOut, fee) => { const x = amountIn * (BPS - fee); return (x * rOut) / (rIn * BPS + x); };
const inFor = (amountOut, rIn, rOut, fee) => (rIn * amountOut * BPS) / ((rOut - amountOut) * (BPS - fee)) + 1n;
const feeOf = (receipt) => BigInt(String(receipt?.fee ?? 0).replace(/n$/, ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
    const W = t.deployed.addresses.WBWSC;
    const owner = t.owner;
    const alice = t.newWallet();
    const bob = t.newWallet();
    const carol = t.newWallet();

    // A fresh exchange for this file (the shared one belongs to the other tests)
    const DEX = await deployProgram(t, "BwscDex", { owner: owner.address, wrapped: W, defaultFeeBps: 30n, openPairs: false }, { upgrader: owner.address });
    const A = await deployToken(t, "AAA");
    const B = await deployToken(t, "BBB");
    for (const tk of [ A, B ]) {
        await t.send(owner, tk, "transfer", { to: alice.address, amount: units(100_000) });
        await t.send(owner, tk, "transfer", { to: bob.address, amount: units(100_000) });
        await t.send(alice, tk, "approve", { spender: DEX, amount: units(1_000_000_000) });
        await t.send(bob, tk, "approve", { spender: DEX, amount: units(1_000_000_000) });
    }
    const pairOf = (x, y) => t.read(DEX, "getPair", { tokenA: x, tokenB: y });
    const view = () => t.read(DEX, "getView", { account: "", offset: 0n, limit: 10n });

    let v = await view();
    t.check("v2: getView says version 2 and gives the chain's clock (unix seconds)", v.version === 2n && v.blockTime > 1_700_000_000n && v.blockTime < 100_000_000_000n, `${v.blockTime}`);
    const now = async () => (await view()).blockTime;

    await t.send(owner, DEX, "createPair", { tokenA: A, tokenB: B });
    await t.send(owner, DEX, "createPair", { tokenA: ZERO, tokenB: A });
    await t.send(alice, DEX, "addLiquidity", { tokenA: A, tokenB: B, amountA: units(10_000), amountB: units(20_000), minShares: 0n, deadline: (await now()) + 600n });
    await t.send(alice, DEX, "addLiquidity", { tokenA: ZERO, tokenB: A, amountA: units(50), amountB: units(5_000), minShares: 0n }, { value: units(50) });

    /* ------------------------------------ deadline */

    const past = (await now()) - 1n;
    t.check("deadline passed → swap refused (Expired)", await t.doesRevert(() => t.send(bob, DEX, "swap", { path: [ A, B ], amountIn: units(1), minOut: 0n, deadline: past }), "Expired"));
    t.check("deadline passed → addLiquidity refused", await t.doesRevert(() => t.send(bob, DEX, "addLiquidity", { tokenA: A, tokenB: B, amountA: units(1), amountB: units(2), minShares: 0n, deadline: past }), "Expired"));
    t.check("deadline passed → removeLiquidity refused", await t.doesRevert(() => t.send(alice, DEX, "removeLiquidity", { tokenA: A, tokenB: B, shares: 1n, minA: 0n, minB: 0n, deadline: past }), "Expired"));
    t.check("deadline passed → swapExactOut refused", await t.doesRevert(() => t.send(bob, DEX, "swapExactOut", { path: [ A, B ], amountOut: units(1), maxIn: units(10), deadline: past }), "Expired"));
    t.check("a deadline in milliseconds is refused with a clear message", await t.doesRevert(() => t.send(bob, DEX, "swap", { path: [ A, B ], amountIn: units(1), minOut: 0n, deadline: BigInt(Date.now() + 600_000) }), "milliseconds"));
    let p = await pairOf(A, B);
    const aIsA = p.tokenA === A;
    let r = await t.send(bob, DEX, "swap", { path: [ A, B ], amountIn: units(10), minOut: 0n, deadline: (await now()) + 60n });
    const want1 = outFor(units(10), aIsA ? p.reserveA : p.reserveB, aIsA ? p.reserveB : p.reserveA, p.feeBps);
    t.check("deadline in the future → the swap goes through", r.result === want1);

    /* ------------------------------------ to (receiver) */

    p = await pairOf(A, B);
    const c0 = await t.read(B, "balanceOf", { who: carol.address });
    const b0 = await t.read(B, "balanceOf", { who: bob.address });
    r = await t.send(bob, DEX, "swap", { path: [ A, B ], amountIn: units(5), minOut: 0n, to: carol.address });
    t.check("swap with to: the coins go to carol, bob pays", (await t.read(B, "balanceOf", { who: carol.address })) - c0 === r.result && (await t.read(B, "balanceOf", { who: bob.address })) === b0);
    const n0 = await t.balance(carol.address);
    r = await t.send(bob, DEX, "swap", { path: [ A, ZERO ], amountIn: units(10), minOut: 0n, to: carol.address });
    t.check("native out with to: carol gets the BWSC", (await t.balance(carol.address)) - n0 === r.result && r.result > 0n);
    const sharesBefore = await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: carol.address });
    await t.send(bob, DEX, "addLiquidity", { tokenA: A, tokenB: B, amountA: units(100), amountB: units(1000), minShares: 0n, to: carol.address });
    t.check("addLiquidity with to: the shares are carol's", (await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: carol.address })) > sharesBefore && sharesBefore === 0n);

    /* ------------------------------------ exact out */

    p = await pairOf(A, B);
    const wantOut = units(25);
    const need = inFor(wantOut, aIsA ? p.reserveA : p.reserveB, aIsA ? p.reserveB : p.reserveA, p.feeBps);
    const q = await t.read(DEX, "quoteIn", { path: [ A, B ], amountOut: wantOut });
    t.check("quoteIn: what you pay for exactly 25 B (worked out here too)", q.at(0) === need && q.at(1) === wantOut, `${q.at(0)} vs ${need}`);
    const a0 = await t.read(A, "balanceOf", { who: bob.address });
    const bb0 = await t.read(B, "balanceOf", { who: bob.address });
    r = await t.send(bob, DEX, "swapExactOut", { path: [ A, B ], amountOut: wantOut, maxIn: need + units(1), deadline: (await now()) + 60n });
    const gotB = (await t.read(B, "balanceOf", { who: bob.address })) - bb0;
    t.check("swapExactOut: bob pays exactly the quote and gets at least 25 B", r.result === need && a0 - (await t.read(A, "balanceOf", { who: bob.address })) === need && gotB >= wantOut && gotB - wantOut < 10n, `${gotB}`);
    t.check("swapExactOut: maxIn below what it costs → refused (nothing taken)", await t.doesRevert(() => t.send(bob, DEX, "swapExactOut", { path: [ A, B ], amountOut: wantOut, maxIn: units(1) }), "more than your maximum"));
    t.check("swapExactOut: more than the pair holds → refused", await t.doesRevert(() => t.send(bob, DEX, "swapExactOut", { path: [ A, B ], amountOut: units(10_000_000), maxIn: units(10_000_000) }), "liquidity"));
    // Native in, exact out: send maxIn as value, the rest comes back
    p = await pairOf(ZERO, A);
    const wIsA = p.tokenA === W;
    const wantA = units(100);
    const needN = inFor(wantA, wIsA ? p.reserveA : p.reserveB, wIsA ? p.reserveB : p.reserveA, p.feeBps);
    const nb0 = await t.balance(bob.address);
    const ab0 = await t.read(A, "balanceOf", { who: bob.address });
    r = await t.send(bob, DEX, "swapExactOut", { path: [ ZERO, A ], amountOut: wantA, maxIn: needN * 2n }, { value: needN * 2n });
    t.check("native in, exact out: pays only what it costs, the rest of the value comes back", nb0 - (await t.balance(bob.address)) === needN + feeOf(r) && (await t.read(A, "balanceOf", { who: bob.address })) - ab0 >= wantA);
    // Exact out over two pairs: B → A → native
    const route = await t.read(DEX, "quoteIn", { path: [ B, A, ZERO ], amountOut: units(1) });
    const nb1 = await t.balance(bob.address);
    r = await t.send(bob, DEX, "swapExactOut", { path: [ B, A, ZERO ], amountOut: units(1), maxIn: route.at(0) });
    t.check("exact out over two pairs (B → A → BWSC): pays the quote, gets ≥ 1 BWSC", r.result === route.at(0) && (await t.balance(bob.address)) - nb1 + feeOf(r) >= units(1));

    /* ------------------------------------ shares that move */

    const mine = await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: alice.address });
    await t.send(alice, DEX, "transferShares", { tokenA: A, tokenB: B, to: bob.address, shares: mine / 4n });
    t.check("transferShares: a quarter of alice's position is now bob's", (await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: bob.address })) === mine / 4n);
    t.check("transferShares: more than you have → refused", await t.doesRevert(() => t.send(carol, DEX, "transferShares", { tokenA: A, tokenB: B, to: bob.address, shares: units(1_000_000) }), "Not that many"));
    await t.send(alice, DEX, "approveShares", { tokenA: A, tokenB: B, spender: carol.address, shares: 1000n });
    t.check("approveShares: the allowance is readable", (await t.read(DEX, "sharesAllowance", { tokenA: A, tokenB: B, owner: alice.address, spender: carol.address })) === 1000n);
    t.check("transferSharesFrom above the allowance → refused", await t.doesRevert(() => t.send(carol, DEX, "transferSharesFrom", { tokenA: A, tokenB: B, from: alice.address, to: carol.address, shares: 1001n }), "approved"));
    const cs0 = await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: carol.address });
    await t.send(carol, DEX, "transferSharesFrom", { tokenA: A, tokenB: B, from: alice.address, to: carol.address, shares: 600n });
    t.check("transferSharesFrom: carol moves 600 of alice's shares, 400 allowed left",
        (await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: carol.address })) - cs0 === 600n && (await t.read(DEX, "sharesAllowance", { tokenA: A, tokenB: B, owner: alice.address, spender: carol.address })) === 400n);
    // Bob can take out the shares he was given
    const bobShares = await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: bob.address });
    r = await t.send(bob, DEX, "removeLiquidity", { tokenA: A, tokenB: B, shares: bobShares, minA: 0n, minB: 0n, to: carol.address, deadline: (await now()) + 60n });
    t.check("removeLiquidity with to: moved shares come out, paid to carol", r.result.amountA > 0n && r.result.amountB > 0n && (await t.read(DEX, "sharesOf", { tokenA: A, tokenB: B, who: bob.address })) === 0n);

    /* ------------------------------------ time-weighted price */

    const t1 = await pairOf(A, B);
    await wait(3200);
    const t2 = await pairOf(A, B);
    const dt = t2.cumulativeAt - t1.cumulativeAt;
    const priceA = (t1.reserveB * 10n ** 18n) / t1.reserveA;
    t.check("TWAP: with no trades, (sum₂ − sum₁) / seconds = the price", dt >= 2n && (t2.priceACumulative - t1.priceACumulative) / dt === priceA, `${dt}s`);
    t.check("TWAP: both directions are kept", t2.priceBCumulative > t1.priceBCumulative);

    /* ------------------------------------ skim */

    await t.send(alice, A, "transfer", { to: DEX, amount: units(7) });   // by mistake
    t.check("skim: only the owner", await t.doesRevert(() => t.send(alice, DEX, "skim", { token: A, to: alice.address }), "owner"));
    const s0 = await t.read(A, "balanceOf", { who: alice.address });
    r = await t.send(owner, DEX, "skim", { token: A, to: alice.address });
    t.check("skim: exactly the 7 sent by mistake go back, no pair loses anything", r.result === units(7) && (await t.read(A, "balanceOf", { who: alice.address })) - s0 === units(7));
    t.check("skim with nothing extra → refused", await t.doesRevert(() => t.send(owner, DEX, "skim", { token: A, to: alice.address }), "Nothing extra"));
    const pA = await pairOf(A, B);
    const pN = await pairOf(ZERO, A);
    const heldA = (pA.tokenA === A ? pA.reserveA : pA.reserveB) + (pN.tokenA === A ? pN.reserveA : pN.reserveB);
    t.check("the exchange holds exactly the reserves of A (every pair counted)", (await t.read(A, "balanceOf", { who: DEX })) === heldA);

    /* ------------------------------------ upgrade from v1 (as on the live chain) */

    const v1Code = fs.readFileSync(new URL("./fixtures/BwscDex-v1.js", import.meta.url), "utf8");
    const old = await sendAndWait(t.client, owner, { action: "deploy", code: v1Code, input: utils.toChainValue({ owner: owner.address, wrapped: W, defaultFeeBps: 30n, openPairs: false }), upgrader: owner.address, gasLimit: 1_500_000 });
    const V1 = String(old.result?.programUuid ?? "").toLowerCase();
    await sendAndWait(t.client, owner, { action: "init", to: V1, gasLimit: 1_000_000 });
    await t.send(alice, A, "approve", { spender: V1, amount: units(1_000_000) });
    await t.send(alice, B, "approve", { spender: V1, amount: units(1_000_000) });
    await t.send(owner, V1, "createPair", { tokenA: A, tokenB: B });
    await t.send(alice, V1, "addLiquidity", { tokenA: A, tokenB: B, amountA: units(1000), amountB: units(3000), minShares: 0n });
    await t.send(alice, V1, "swap", { path: [ A, B ], amountIn: units(10), minOut: 0n });
    const before = await t.read(V1, "getPair", { tokenA: A, tokenB: B });
    const aliceV1 = (await t.read(V1, "getView", { account: alice.address, offset: 0n, limit: 10n })).pairs.at(0).myShares;
    // Upgrade: the upgrader sends the new code, an admin approves, migrate() runs once
    await sendAndWait(t.client, owner, { action: "upgrade", to: V1, code: t.programs.BwscDex.code, input: {}, gasLimit: 3_000_000 });
    await sendAndWait(t.client, owner, { action: "initUpgrade", to: V1, gasLimit: 3_000_000 });
    const after = await t.read(V1, "getPair", { tokenA: A, tokenB: B });
    const vv = await t.read(V1, "getView", { account: alice.address, offset: 0n, limit: 10n });
    t.check("upgrade v1 → v2: same reserves, same shares, version 2", vv.version === 2n && after.reserveA === before.reserveA && after.reserveB === before.reserveB && after.totalShares === before.totalShares && vv.pairs.at(0).myShares === aliceV1);
    r = await t.send(alice, V1, "swapExactOut", { path: [ A, B ], amountOut: units(5), maxIn: units(10), deadline: (await t.read(V1, "getView", { account: "", offset: 0n, limit: 1n })).blockTime + 60n });
    t.check("after the upgrade: v2 functions work on the old pairs", r.result > 0n);
    await t.send(alice, A, "transfer", { to: V1, amount: units(3) });
    r = await t.send(owner, V1, "skim", { token: A, to: alice.address });
    t.check("after the upgrade: migrate counted v1's reserves, so skim gives back only the 3 extra", r.result === units(3), String(r.result));
    r = await t.send(alice, V1, "removeLiquidity", { tokenA: A, tokenB: B, shares: aliceV1, minA: 0n, minB: 0n });
    t.check("after the upgrade: alice takes out everything she put in v1", r.result.amountA > 0n && r.result.amountB > 0n);
}
