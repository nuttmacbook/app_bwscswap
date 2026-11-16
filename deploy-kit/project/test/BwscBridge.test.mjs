/*
 * YOUR CODE (on-chain, tests). BwscBridge (the BWSC hub) on the real node: routes per (chain, coin), bridgeOut,
 * claimIn with signed running totals, several chains kept apart, fees, liquidity, pause, signer change.
 * Signatures are made here with the local signer key (test key #4), exactly like bridge-signer does.
 */

import { ethers } from "ethers";
import { utils } from "bwscbox";
import { devKey } from "../../engine/node.mjs";
import { deployToken } from "./tools.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const BPS = 10_000n;
const CLAIM_TYPES = { Claim: [ { name: "account", type: "address" }, { name: "sourceChainId", type: "uint256" }, { name: "token", type: "address" }, { name: "total", type: "uint256" } ] };
const units = (text) => utils.toUnits(String(text), 18);

export default async function (t) {
    const { deployed, settings } = t;
    const BRIDGE = deployed.addresses.BwscBridge;
    const USDT = deployed.addresses.USDT;
    const s = settings.BwscBridge;
    const BSC = BigInt(s.BSC_CHAIN_ID);
    const ETH = 1n;   // a second chain, to check that chains are kept apart
    const signerKey = new ethers.Wallet(devKey(4));
    const chainId = Number((await t.client.genesis()).chainId);
    const view = (account = "") => t.read("BwscBridge", "getView", { account, offset: 0n, limit: 100n });
    const routeOf = (v, chain, token) => v.routes.find((x) => x.chainId === chain && x.token === token);
    const coinOf = (v, token) => v.coins.find((x) => x.address === token);
    const usdtBalance = (who) => t.read("USDT", "balanceOf", { who });
    const sign = (account, source, token, total, { key = signerKey, chain = chainId, bridge = BRIDGE } = {}) =>
        key.signTypedData({ name: "BwscBridge", version: "2", chainId: chain, verifyingContract: bridge }, CLAIM_TYPES, { account, sourceChainId: source, token, total });
    const claim = (by, source, account, token, total, signature) => t.send(by, "BwscBridge", "claimIn", { chainId: source, account, token, total, signature });
    const bridgeOut = (who, chain, token, amount, value = token === ZERO ? amount : 0n) => t.send(who, "BwscBridge", "bridgeOut", { chainId: chain, token, amount }, { value });
    const approve = (who, amount) => t.send(who, "USDT", "approve", { spender: BRIDGE, amount });
    const fee = (amount, bps) => (amount * bps) / BPS;
    const outOf = (chain, account, token) => t.read("BwscBridge", "bridgedOutOf", { chainId: chain, account, token });

    /* ------------------------------------ settings */

    let v = await view();
    const native = routeOf(v, BSC, ZERO);
    const usdt = routeOf(v, BSC, USDT);
    t.check("owner and signer come from the init input", v.owner === t.owner.address && v.signer === s.SIGNER.toLowerCase());
    t.check("two routes to BSC: the native coin and USDT, each with its BSC coin", native?.remoteToken === s.PAIR_NATIVE.toLowerCase() && usdt?.remoteToken === s.PAIR_USDT.toLowerCase() && v.routeCount === 2n);
    t.check("fees and smallest transfers per route", native.feeBps === BigInt(s.FEE_BPS_NATIVE) && usdt.feeBps === BigInt(s.FEE_BPS_USDT) && native.min === units(s.MIN_NATIVE) && usdt.min === units(s.MIN_USDT));
    t.check("starts open and empty, and the view knows the chain", !v.paused && coinOf(v, ZERO).held === 0n && coinOf(v, USDT).held === 0n && v.chainId === BigInt(chainId));
    const info = await t.client.program(BRIDGE);
    t.check("ABI is published for the explorer", (info?.metadata?.abi?.functions ?? []).some((f) => f.name === "claimIn"));
    t.check("initialization cannot run again", await t.doesRevert(() => t.client.send({ action: "init", to: BRIDGE }, t.owner).then((x) => t.client.waitReceipt(x.hash))));
    t.check("claimDigest = the EIP-712 digest the signer signs",
        (await t.read("BwscBridge", "claimDigest", { chainId: BSC, account: t.stranger.address, token: USDT, total: 5n })) ===
        ethers.TypedDataEncoder.hash({ name: "BwscBridge", version: "2", chainId, verifyingContract: BRIDGE }, CLAIM_TYPES, { account: t.stranger.address, sourceChainId: BSC, token: USDT, total: 5n }));

    // A second chain for USDT (its own route, sharing USDT's liquidity here)
    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: ETH, token: USDT, remoteToken: "0xdac17f958d2ee523a2206206994597c13d831ec7", enabled: true, feeBps: 20n, min: units(10) });
    t.check("setRoute adds a route to another chain", (await view()).routeCount === 3n && routeOf(await view(), ETH, USDT)?.feeBps === 20n);
    t.check("a route to this chain itself is refused", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setRoute", { chainId: BigInt(chainId), token: USDT, remoteToken: USDT, enabled: true, feeBps: 0n, min: 0n }), "this chain"));
    t.check("a route for an address that is not a program is refused", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setRoute", { chainId: ETH, token: t.stranger.address, remoteToken: ZERO, enabled: true, feeBps: 0n, min: 0n }), "token program"));

    /* ------------------------------------ bridge out */

    const alice = t.newWallet();
    const bob = t.newWallet();
    const relayer = t.newWallet();
    const a0 = await t.balance(alice.address);
    let r = await bridgeOut(alice, BSC, ZERO, units(10));
    t.gas("bridgeOut (native)", r);
    const net10 = units(10) - fee(units(10), native.feeBps);
    t.check("bridgeOut native to BSC: running total = amount − fee", (await outOf(BSC, alice.address, ZERO)) === net10 && r.result === net10);
    v = await view(alice.address);
    t.check("the coins are locked here: held = 10, fees = fee", coinOf(v, ZERO).held === units(10) && coinOf(v, ZERO).fees === fee(units(10), native.feeBps));
    t.check("alice paid 10 coins plus gas", a0 - (await t.balance(alice.address)) >= units(10));
    t.check("value must equal the amount for the native coin", await t.doesRevert(() => bridgeOut(alice, BSC, ZERO, units(5), units(4)), "exactly the amount"));
    t.check("below the smallest transfer is refused", await t.doesRevert(() => bridgeOut(alice, BSC, ZERO, units(s.MIN_NATIVE) - 1n), "smallest"));
    t.check("a coin with no route to that chain is refused", await t.doesRevert(() => bridgeOut(alice, ETH, ZERO, units(5)), "cannot be bridged"));

    await t.send(t.owner, "USDT", "transfer", { to: alice.address, amount: units(1000) });
    await approve(alice, units(100));
    r = await bridgeOut(alice, BSC, USDT, units(100));
    t.gas("bridgeOut (token)", r);
    t.check("bridgeOut USDT to BSC: total = 100 − 0.1%", r.result === units(100) - fee(units(100), usdt.feeBps));
    await approve(alice, units(50));
    await bridgeOut(alice, ETH, USDT, units(50));
    t.check("the same coin to another chain has its own total (BSC 99.9, ETH 49.9)", (await outOf(ETH, alice.address, USDT)) === units(50) - fee(units(50), 20n) && (await outOf(BSC, alice.address, USDT)) === units(100) - fee(units(100), usdt.feeBps));
    t.check("native coin sent with a token is refused", await t.doesRevert(async () => { await approve(alice, units(10)); return bridgeOut(alice, BSC, USDT, units(10), 1n); }, "Do not send native"));

    /* ------------------------------------ claim in: running totals per chain */

    await t.send(t.owner, "USDT", "approve", { spender: BRIDGE, amount: units(1000) });
    await t.send(t.owner, "BwscBridge", "addLiquidity", { token: USDT, amount: units(1000) });
    await t.send(t.owner, "BwscBridge", "addLiquidity", { token: ZERO, amount: units(50) }, { value: units(50) });

    const bob0 = await usdtBalance(bob.address);
    const sig200 = await sign(bob.address, BSC, USDT, units(200));
    r = await claim(relayer, BSC, bob.address, USDT, units(200), sig200);
    t.gas("claimIn (token)", r);
    t.check("claim 200 from BSC: bob gets 200, even though the relayer sent it", (await usdtBalance(bob.address)) - bob0 === units(200));
    t.check("the same signature again pays nothing (refused)", await t.doesRevert(() => claim(relayer, BSC, bob.address, USDT, units(200), sig200), "already paid"));
    r = await claim(bob, BSC, bob.address, USDT, units(320), await sign(bob.address, BSC, USDT, units(320)));
    t.check("signed total 320 → pays 320 − 200 = 120", r.result === units(120));
    r = await claim(bob, ETH, bob.address, USDT, units(30), await sign(bob.address, ETH, USDT, units(30)));
    t.check("a claim from another chain counts on its own (ETH 30 after BSC 320)", r.result === units(30) && (await t.read("BwscBridge", "claimedInOf", { chainId: ETH, account: bob.address, token: USDT })) === units(30));
    t.check("a BSC signature cannot be used as an ETH claim", await t.doesRevert(async () => claim(bob, ETH, bob.address, USDT, units(400), await sign(bob.address, BSC, USDT, units(400))), "not from the bridge signer"));
    t.check("a claim from a chain with no route is refused", await t.doesRevert(async () => claim(bob, 5n, bob.address, USDT, units(1), await sign(bob.address, 5n, USDT, units(1))), "no route"));

    t.check("a signature for another account is refused", await t.doesRevert(async () => claim(alice, BSC, alice.address, USDT, units(400), await sign(bob.address, BSC, USDT, units(400))), "not from the bridge signer"));
    t.check("a bigger total than signed is refused", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(999), await sign(bob.address, BSC, USDT, units(330))), "not from the bridge signer"));
    t.check("a key that is not the signer is refused", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(500), await sign(bob.address, BSC, USDT, units(500), { key: new ethers.Wallet(devKey(5)) })), "not from the bridge signer"));
    t.check("a signature for another chain's bridge is refused", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(500), await sign(bob.address, BSC, USDT, units(500), { chain: 56 })), "not from the bridge signer"));
    t.check("a signature for another address is refused", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(500), await sign(bob.address, BSC, USDT, units(500), { bridge: USDT })), "not from the bridge signer"));
    t.check("native coin sent with a claim is refused", await t.doesRevert(async () => t.send(bob, "BwscBridge", "claimIn", { chainId: BSC, account: bob.address, token: USDT, total: units(330), signature: await sign(bob.address, BSC, USDT, units(330)) }, { value: 1n }), "Do not send native"));

    const b0 = await t.balance(bob.address);
    r = await claim(relayer, BSC, bob.address, ZERO, units(7), await sign(bob.address, BSC, ZERO, units(7)));
    t.gas("claimIn (native)", r);
    t.check("native claim: bob gets exactly 7 coins (the relayer paid the gas)", (await t.balance(bob.address)) - b0 === units(7));

    v = await view();
    const freeUsdt = coinOf(v, USDT).available;
    const sigTooMuch = await sign(alice.address, BSC, USDT, freeUsdt + 1n);
    t.check("a claim bigger than the free liquidity waits (refused)", await t.doesRevert(() => claim(alice, BSC, alice.address, USDT, freeUsdt + 1n, sigTooMuch), "enough liquidity"));
    await t.send(t.owner, "USDT", "approve", { spender: BRIDGE, amount: units(10) });
    await t.send(t.owner, "BwscBridge", "addLiquidity", { token: USDT, amount: units(10) });
    t.check("…and goes through once liquidity is added", (await claim(alice, BSC, alice.address, USDT, freeUsdt + 1n, sigTooMuch)).result === freeUsdt + 1n);

    /* ------------------------------------ money adds up */

    v = await view();
    const nv = coinOf(v, ZERO);
    const uv = coinOf(v, USDT);
    t.check("USDT: held = the program's USDT balance", uv.held === uv.actual);
    t.check("USDT: held = deposits + liquidity − claims paid", uv.held === units(150) + units(1010) - units(320) - units(30) - (freeUsdt + 1n));
    t.check("USDT: fees = 0.1% of 100 (BSC) + 0.2% of 50 (ETH)", uv.fees === fee(units(100), usdt.feeBps) + fee(units(50), 20n));
    t.check("native: held = 10 + 50 − 7 and the program holds that", nv.held === units(53) && nv.actual >= nv.held);
    t.check("route totals: BSC USDT out 99.9, in 320 + the big claim", routeOf(v, BSC, USDT).totalBridgedOut === units(100) - fee(units(100), usdt.feeBps) && routeOf(v, BSC, USDT).totalClaimedIn === units(320) + freeUsdt + 1n);

    /* ------------------------------------ owner */

    t.check("only the owner can withdraw fees", await t.doesRevert(() => t.send(t.stranger, "BwscBridge", "withdrawFees", { token: USDT, to: t.stranger.address }), "Only the owner"));
    const o0 = await usdtBalance(t.owner.address);
    await t.send(t.owner, "BwscBridge", "withdrawFees", { token: USDT, to: t.owner.address });
    t.check("withdrawFees pays exactly the fees and clears them", (await usdtBalance(t.owner.address)) - o0 === uv.fees && coinOf(await view(), USDT).fees === 0n);
    t.check("removeLiquidity cannot take more than held − fees", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "removeLiquidity", { token: ZERO, amount: nv.available + 1n, to: t.owner.address }), "More than the liquidity"));
    t.check("only the owner can remove liquidity", await t.doesRevert(() => t.send(t.stranger, "BwscBridge", "removeLiquidity", { token: USDT, amount: 1n, to: t.stranger.address }), "Only the owner"));

    await t.send(t.owner, "USDT", "approve", { spender: BRIDGE, amount: units(100) });
    await t.send(t.owner, "BwscBridge", "addLiquidity", { token: USDT, amount: units(100) });
    await t.send(t.owner, "BwscBridge", "setPaused", { paused: true });
    t.check("paused: no bridgeOut", await t.doesRevert(() => bridgeOut(alice, BSC, ZERO, units(2)), "paused"));
    t.check("paused: no claims", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(330), await sign(bob.address, BSC, USDT, units(330))), "paused"));
    await t.send(t.owner, "BwscBridge", "setPaused", { paused: false });

    const newSigner = new ethers.Wallet(devKey(5));
    await t.send(t.owner, "BwscBridge", "setSigner", { signer: newSigner.address });
    t.check("after setSigner the old key's signatures are refused", await t.doesRevert(async () => claim(bob, BSC, bob.address, USDT, units(330), await sign(bob.address, BSC, USDT, units(330))), "not from the bridge signer"));
    t.check("…and the new key's are paid", (await claim(bob, BSC, bob.address, USDT, units(330), await sign(bob.address, BSC, USDT, units(330), { key: newSigner }))).result === units(10));
    await t.send(t.owner, "BwscBridge", "setSigner", { signer: signerKey.address });

    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC, token: USDT, remoteToken: s.PAIR_USDT, enabled: false, feeBps: 20n, min: units(5) });
    await approve(alice, units(10));
    t.check("a turned-off route cannot be bridged out", await t.doesRevert(() => bridgeOut(alice, BSC, USDT, units(10)), "cannot be bridged"));
    t.check("…but its claims are still paid", (await claim(bob, BSC, bob.address, USDT, units(331), await sign(bob.address, BSC, USDT, units(331)))).result === units(1));
    t.check("the other side cannot change once coins moved (no double claims)", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC, token: USDT, remoteToken: s.PAIR_NATIVE, enabled: true, feeBps: 10n, min: units(5) }), "fixed"));
    const NEW = await deployToken(t, "NEW");
    t.check("…but a new coin can get its own route", !(await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC, token: NEW, remoteToken: s.PAIR_NATIVE, enabled: false, feeBps: 0n, min: 0n }))));
    t.check("fee above 5% is refused", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC, token: USDT, remoteToken: s.PAIR_USDT, enabled: true, feeBps: 501n, min: 0n }), "feeBps"));
    const page = await t.read("BwscBridge", "getView", { account: "", offset: 1n, limit: 2n });
    t.check("getView pages routes (offset 1, limit 2)", page.routes.length === 2 && page.routeCount === 4n);
    t.check("sendOutExtraNative: no stray coins → nothing to send (the liquidity is never counted)", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "sendOutExtraNative", { to: t.owner.address }), "Nothing to send out"));

    await t.send(t.owner, "BwscBridge", "transferOwnership", { owner: alice.address });
    t.check("transferOwnership: the old owner cannot pause any more", await t.doesRevert(() => t.send(t.owner, "BwscBridge", "setPaused", { paused: true }), "Only the owner"));
}
