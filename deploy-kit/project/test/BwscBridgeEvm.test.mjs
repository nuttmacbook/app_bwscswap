/*
 * YOUR CODE (contract tests). BwscBridgeEvm (the EVM side, BSC today) on the local BSC (anvil), behind BaseProxyUsed:
 * proxy rules, bridgeIn (tokens and the chain's own coin), claimOut with signed running totals, fees, liquidity,
 * pause, signer change, new routes, upgrade.
 * Skipped when anvil (Foundry) is not installed.
 */

import { ethers } from "ethers";
import { devKey } from "../../engine/node.mjs";

const ZERO = ethers.ZeroAddress;
const BPS = 10_000n;
const CLAIM_TYPES = { Claim: [ { name: "account", type: "address" }, { name: "sourceChainId", type: "uint256" }, { name: "token", type: "address" }, { name: "total", type: "uint256" } ] };
const HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0n;
const ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const units = (text) => ethers.parseUnits(String(text), 18);

/** True when the call reverts with a message containing `text` */
async function reverts(call, text) {
    try {
        const tx = await call();
        if (tx?.wait) await tx.wait();
        return false;
    } catch (error) {
        const message = `${error?.shortMessage ?? ""} ${error?.reason ?? ""} ${error?.message ?? ""}`;
        return text ? message.includes(text) : true;
    }
}

export default async function (t) {
    if (!t.bsc) return t.skip("BwscBridgeEvm", "anvil is not installed (Foundry): no local BSC");
    const { anvil, contracts, addresses, tokens, settings } = t.bsc;
    const s = settings.BwscBridgeEvm;
    const REMOTE = BigInt(s.REMOTE_CHAIN_ID);
    const chainId = Number((await anvil.provider.getNetwork()).chainId);
    const owner = anvil.wallet(0);
    const alice = anvil.wallet(20);
    const bob = anvil.wallet(21);
    const relayer = anvil.wallet(22);
    const stranger = anvil.wallet(23);
    const signerKey = new ethers.Wallet(devKey(4));
    const BRIDGE = addresses.BwscBridgeEvm;
    const bridge = (who = owner) => new ethers.Contract(BRIDGE, contracts.BwscBridgeEvm.abi, who);
    const proxy = (who = owner) => new ethers.Contract(BRIDGE, contracts.BaseProxyUsed.abi, who);
    const erc20 = (address, who = owner) => new ethers.Contract(address, contracts.MockToken.abi, who);
    const USDT = tokens.USDT.address;
    const NATIVE = tokens.tBWSC.address;
    const usdt = (who) => erc20(USDT, who);
    const sign = (account, token, total, { key = signerKey, chain = chainId, verifying = BRIDGE, source = REMOTE } = {}) =>
        key.signTypedData({ name: "BwscBridge", version: "2", chainId: chain, verifyingContract: verifying }, CLAIM_TYPES, { account, sourceChainId: source, token, total });
    const fee = (amount, bps) => (amount * bps) / BPS;
    const tokenView = async (token, who = ZERO) => (await bridge().getBridgeView(who, 0n, 100n)).routes.find((x) => x.token.toLowerCase() === token.toLowerCase());
    const gas = async (name, tx) => t.gas(name, { gasUsed: (await tx.wait()).gasUsed });
    const [ aliceAddress, bobAddress ] = [ await alice.getAddress(), await bob.getAddress() ];

    /* ------------------------------------ proxy and settings */

    const ownerAddress = await owner.getAddress();
    t.check("proxy admin = owner", (await proxy().admin()).toLowerCase() === ownerAddress.toLowerCase());
    t.check("owner, signer and BWSC's chain id come from the initialize call", (await bridge().owner()) === ownerAddress && (await bridge().signer()).toLowerCase() === s.SIGNER.toLowerCase() && (await bridge().remoteChainId()) === REMOTE);
    const list = (await bridge().tokenList()).map((a) => a.toLowerCase());
    t.check("two tokens: the BWSC coin (BEP-20) and USDT", list.length === 2 && list[0] === NATIVE && list[1] === USDT);
    const nativeCfg = await bridge().getRoute(NATIVE);
    const usdtCfg = await bridge().getRoute(USDT);
    t.check("routes point at the BWSC side (native coin = 0x0, USDT program)", nativeCfg.remoteToken === ZERO && usdtCfg.remoteToken.toLowerCase() === t.deployed.addresses.USDT);
    t.check("fees and minimums come from the settings", nativeCfg.feeBps === BigInt(s.FEE_BPS_NATIVE) && usdtCfg.feeBps === BigInt(s.FEE_BPS_USDT) && usdtCfg.min === units(s.MIN_USDT));
    t.check("initialize cannot run again", await reverts(() => bridge().initialize(ownerAddress, ownerAddress, REMOTE, [ USDT ], [ ZERO ], [ 0n ], [ 0n ]), "Already Initialized"));
    const proxySelectors = new ethers.Interface(contracts.BaseProxyUsed.abi).fragments.filter((f) => f.type === "function").map((f) => f.selector);
    const logicSelectors = new ethers.Interface(contracts.BwscBridgeEvm.abi).fragments.filter((f) => f.type === "function").map((f) => f.selector);
    t.check("no function selector of the logic collides with the proxy's", !logicSelectors.some((x) => proxySelectors.includes(x)));
    t.check("a stranger cannot upgrade the proxy", await reverts(() => proxy(stranger).upgradeTo(USDT), "Not admin"));
    t.check("claimDigest = the EIP-712 digest the signer signs",
        (await bridge().claimDigest(aliceAddress, USDT, 7n)) === ethers.TypedDataEncoder.hash({ name: "BwscBridge", version: "2", chainId, verifyingContract: BRIDGE }, CLAIM_TYPES, { account: aliceAddress, sourceChainId: REMOTE, token: USDT, total: 7n }));

    /* ------------------------------------ bridge in */

    await (await usdt(owner).mint(aliceAddress, units(1000))).wait();
    await (await usdt(alice).approve(BRIDGE, units(100))).wait();
    let tx = await bridge(alice).bridgeIn(USDT, units(100));
    await gas("bridgeIn", tx);
    const net100 = units(100) - fee(units(100), usdtCfg.feeBps);
    t.check("bridgeIn: running total = amount − fee", (await bridge().bridgedInOf(aliceAddress, USDT)) === net100, ethers.formatUnits(net100, 18));
    let v = await tokenView(USDT, aliceAddress);
    t.check("held = 100, fees = 0.1, allowance used up", v.held === units(100) && v.fees === fee(units(100), usdtCfg.feeBps) && v.allowance === 0n);
    const receipt = await tx.wait();
    const event = receipt.logs.map((l) => { try { return bridge().interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "BridgeIn");
    t.check("BridgeIn event: account, token, amount, fee, total", event && event.args.account === aliceAddress && event.args.amount === units(100) && event.args.total === net100);
    await (await usdt(alice).approve(BRIDGE, units(120))).wait();
    await (await bridge(alice).bridgeIn(USDT, units(120))).wait();
    t.check("bridging 120 more adds to the total", (await bridge().bridgedInOf(aliceAddress, USDT)) === net100 + units(120) - fee(units(120), usdtCfg.feeBps));
    t.check("below the smallest transfer is refused", await reverts(() => bridge(alice).bridgeIn(USDT, units(s.MIN_USDT) - 1n), "Below The Smallest Transfer"));
    t.check("a token that is not in the bridge is refused", await reverts(() => bridge(alice).bridgeIn(ownerAddress, 1n), "Token Cannot Be Bridged"));
    t.check("this chain's coin has no route yet: refused", await reverts(() => bridge(alice).bridgeIn(ZERO, units(1), { value: units(1) }), "Token Cannot Be Bridged"));
    t.check("without approve it is refused", await reverts(() => bridge(alice).bridgeIn(USDT, units(10)), "Transfer Failed"));

    /* ------------------------------------ claim out: running totals */

    await (await erc20(NATIVE, owner).approve(BRIDGE, units(500))).wait();
    await (await bridge(owner).addLiquidity(NATIVE, units(500))).wait();
    const b0 = await erc20(NATIVE).balanceOf(bobAddress);
    const sig200 = await sign(bobAddress, NATIVE, units(200));
    tx = await bridge(relayer).claimOut(bobAddress, NATIVE, units(200), sig200);
    await gas("claimOut", tx);
    t.check("claim 200 (sent by a relayer): bob gets 200 of the BWSC coin", (await erc20(NATIVE).balanceOf(bobAddress)) - b0 === units(200));
    t.check("the same signature again is refused", await reverts(() => bridge(relayer).claimOut(bobAddress, NATIVE, units(200), sig200), "Nothing To Claim"));
    const sig320 = await sign(bobAddress, NATIVE, units(320));
    await (await bridge(bob).claimOut(bobAddress, NATIVE, units(320), sig320)).wait();
    t.check("signed total 320 → pays 120 more", (await erc20(NATIVE).balanceOf(bobAddress)) - b0 === units(320) && (await bridge().claimedOutOf(bobAddress, NATIVE)) === units(320));
    t.check("the older 200 signature is refused after 320", await reverts(() => bridge(bob).claimOut(bobAddress, NATIVE, units(200), sig200), "Nothing To Claim"));
    t.check("another account with bob's signature is refused", await reverts(() => bridge(alice).claimOut(aliceAddress, NATIVE, units(320), sig320), "Not Signed By The Bridge Signer"));
    t.check("a key that is not the signer is refused", await reverts(async () => bridge(bob).claimOut(bobAddress, NATIVE, units(400), await sign(bobAddress, NATIVE, units(400), { key: new ethers.Wallet(devKey(5)) })), "Not Signed By The Bridge Signer"));
    t.check("a signature for the BWSC chain is refused here", await reverts(async () => bridge(bob).claimOut(bobAddress, NATIVE, units(400), await sign(bobAddress, NATIVE, units(400), { chain: Number(t.local.LOCAL_CHAIN_ID) })), "Not Signed By The Bridge Signer"));
    t.check("a signature naming another source chain is refused", await reverts(async () => bridge(bob).claimOut(bobAddress, NATIVE, units(400), await sign(bobAddress, NATIVE, units(400), { source: 1n })), "Not Signed By The Bridge Signer"));
    // The same signature in its other form (s → n − s, v flipped) must not work
    const good = ethers.Signature.from(await sign(bobAddress, NATIVE, units(330)));
    const flipped = ethers.concat([ good.r, ethers.toBeHex(ORDER - BigInt(good.s), 32), good.v === 27 ? "0x1c" : "0x1b" ]);
    t.check("the high-s twin of a signature is refused", BigInt(good.s) <= HALF_ORDER && await reverts(() => bridge(bob).claimOut(bobAddress, NATIVE, units(330), flipped), "Bad Signature"));
    t.check("a signature of the wrong length is refused", await reverts(() => bridge(bob).claimOut(bobAddress, NATIVE, units(330), "0x1234"), "Bad Signature Length"));
    v = await tokenView(USDT);
    t.check("a claim bigger than held − fees waits", await reverts(async () => bridge(bob).claimOut(bobAddress, USDT, v.available + 1n, await sign(bobAddress, USDT, v.available + 1n)), "Not Enough Liquidity Yet"));

    /* ------------------------------------ money adds up */

    for (const [ name, token ] of [ [ "USDT", USDT ], [ "BWSC coin", NATIVE ] ]) {
        v = await tokenView(token);
        t.check(`${name}: held = the contract's token balance`, v.held === v.actual, ethers.formatUnits(v.held, 18));
    }
    v = await tokenView(USDT);
    t.check("USDT: fees = 0.1% of 100 + 0.1% of 120", v.fees === fee(units(100), usdtCfg.feeBps) + fee(units(120), usdtCfg.feeBps));

    /* ------------------------------------ owner */

    t.check("only the owner can withdraw fees", await reverts(() => bridge(stranger).withdrawFees(USDT, ownerAddress), "Only Owner"));
    const o0 = await usdt().balanceOf(ownerAddress);
    await (await bridge(owner).withdrawFees(USDT, ownerAddress)).wait();
    t.check("withdrawFees pays exactly the fees", (await usdt().balanceOf(ownerAddress)) - o0 === v.fees && (await tokenView(USDT)).fees === 0n);
    v = await tokenView(NATIVE);
    t.check("removeLiquidity cannot take more than held − fees", await reverts(() => bridge(owner).removeLiquidity(NATIVE, v.available + 1n, ownerAddress), "More Than The Liquidity"));
    await (await bridge(owner).setPaused(true)).wait();
    t.check("paused: no bridgeIn", await reverts(() => bridge(alice).bridgeIn(USDT, units(10)), "Bridge Is Paused"));
    t.check("paused: no claims", await reverts(async () => bridge(bob).claimOut(bobAddress, NATIVE, units(330), await sign(bobAddress, NATIVE, units(330))), "Bridge Is Paused"));
    await (await bridge(owner).setPaused(false)).wait();
    t.check("fee above 5% is refused", await reverts(() => bridge(owner).setRoute(USDT, ZERO, true, 501n, 0n), "Fee Too High"));
    t.check("the other side cannot change once coins have moved", await reverts(() => bridge(owner).setRoute(USDT, ZERO, true, 10n, 0n), "Route Is Fixed After Use"));
    const logicAddress = await proxy().implementation();
    t.check("the logic contract itself cannot be initialized", await reverts(() => new ethers.Contract(logicAddress, contracts.BwscBridgeEvm.abi, stranger).initialize(ownerAddress, ownerAddress, REMOTE, [ USDT ], [ ZERO ], [ 0n ], [ 0n ]), "Already Initialized"));
    t.check("a stranger cannot change the signer", await reverts(() => bridge(stranger).setSigner(ownerAddress), "Only Owner"));
    const next = new ethers.Wallet(devKey(5));
    await (await bridge(owner).setSigner(next.address)).wait();
    t.check("after setSigner the old key is refused", await reverts(async () => bridge(bob).claimOut(bobAddress, NATIVE, units(330), await sign(bobAddress, NATIVE, units(330))), "Not Signed By The Bridge Signer"));
    await (await bridge(bob).claimOut(bobAddress, NATIVE, units(330), await sign(bobAddress, NATIVE, units(330), { key: next }))).wait();
    t.check("…and the new key is paid", (await bridge().claimedOutOf(bobAddress, NATIVE)) === units(330));
    await (await bridge(owner).setSigner(signerKey.address)).wait();

    /* ------------------------------------ this chain's own coin (BNB on BSC) as a route */

    // e.g. BNB ↔ a wrapped-BNB token on BWSC (here: any BWSC address stands for it)
    const WBNB_ON_BWSC = t.deployed.addresses.WBWSC;
    await (await bridge(owner).setRoute(ZERO, WBNB_ON_BWSC, true, 10n, units("0.01"))).wait();
    t.check("setRoute adds this chain's coin (0x0)", (await bridge().getRoute(ZERO)).listed && (await bridge().tokenList()).length === 3);
    t.check("BNB must come as value, exactly", await reverts(() => bridge(alice).bridgeIn(ZERO, units(1), { value: units("0.5") }), "Send Exactly The Amount As Value"));
    tx = await bridge(alice).bridgeIn(ZERO, units(1), { value: units(1) });
    await gas("bridgeIn (BNB)", tx);
    t.check("bridgeIn BNB: running total = 1 − 0.1%", (await bridge().bridgedInOf(aliceAddress, ZERO)) === units(1) - fee(units(1), 10n));
    t.check("a token with value attached is refused", await reverts(async () => { await (await usdt(alice).approve(BRIDGE, units(10))).wait(); return bridge(alice).bridgeIn(USDT, units(10), { value: 1n }); }, "No Value With A Token"));
    const bb0 = await anvil.provider.getBalance(bobAddress);
    await (await bridge(relayer).claimOut(bobAddress, ZERO, units("0.4"), await sign(bobAddress, ZERO, units("0.4")))).wait();
    t.check("claimOut pays BNB (sent by a relayer)", (await anvil.provider.getBalance(bobAddress)) - bb0 === units("0.4"));
    v = await tokenView(ZERO, aliceAddress);
    t.check("BNB: held = 1 − 0.4 and the view knows it is the chain's coin", v.isNative && v.held === units("0.6") && v.actual === units("0.6") && v.decimals === 18n);

    // BNB sent straight to the contract (no function) is refused, so nobody loses coins that way
    t.check("plain BNB sent to the bridge is refused", await reverts(() => stranger.sendTransaction({ to: BRIDGE, value: units(1) })));
    t.check("sendOutExtraNative never touches the route's money (nothing extra → refused)", await reverts(() => bridge(owner).sendOutExtraNative(ownerAddress), "Nothing To Send") && (await anvil.provider.getBalance(BRIDGE)) === units("0.6"));
    const page = await bridge().getBridgeView(ZERO, 1n, 5n);
    t.check("getBridgeView pages routes (offset 1 → 2 of 3)", page.routes.length === 2 && page.routeCount === 3n);

    /* ------------------------------------ upgrade keeps everything */

    const before = { total: await bridge().bridgedInOf(aliceAddress, USDT), claimed: await bridge().claimedOutOf(bobAddress, NATIVE), held: (await tokenView(NATIVE)).held };
    const logic = await new ethers.ContractFactory(contracts.BwscBridgeEvm.abi, contracts.BwscBridgeEvm.bytecode, owner).deploy();
    await logic.waitForDeployment();
    await (await proxy(owner).upgradeTo(await logic.getAddress())).wait();
    const after = { total: await bridge().bridgedInOf(aliceAddress, USDT), claimed: await bridge().claimedOutOf(bobAddress, NATIVE), held: (await tokenView(NATIVE)).held };
    t.check("upgradeTo a new logic: totals, claims and money are the same", JSON.stringify(before, (k, x) => (typeof x === "bigint" ? `${x}` : x)) === JSON.stringify(after, (k, x) => (typeof x === "bigint" ? `${x}` : x)));
    t.check("…and the old signatures are still refused after the upgrade", await reverts(() => bridge(bob).claimOut(bobAddress, NATIVE, units(320), sig320), "Nothing To Claim"));
    await (await bridge(owner).transferOwnership(await alice.getAddress())).wait();
    t.check("transferOwnership: the old owner cannot pause", await reverts(() => bridge(owner).setPaused(true), "Only Owner"));
}
