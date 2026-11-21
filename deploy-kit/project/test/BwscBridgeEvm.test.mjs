/*
 * YOUR CODE (contract tests). BwscBridgeEvm (the EVM side, BSC today) on the local BSC (anvil), no proxy:
 * constructor, bridgeIn (tokens and the chain's own coin), claimOut with signed running totals, fees, liquidity,
 * pause, signer change, new routes, coins sent by mistake, and moving to a new bridge (importAccounts: nobody can
 * claim twice).
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

    /* ------------------------------------ constructor and settings */

    const ownerAddress = await owner.getAddress();
    t.check("no proxy: no initialize, upgradeTo or adminCall, and the bytecode is the contract itself", [ "initialize", "upgradeTo", "adminCall" ].every((f) => bridge().interface.getFunction(f) === null)
        && (await anvil.provider.getCode(BRIDGE)) === contracts.BwscBridgeEvm.deployedBytecode);
    t.check("a new bridge: no previous bridge, not migrating, open", (await bridge().previousBridge()) === ZERO && !(await bridge().migrating()) && !(await bridge().paused()) && (await bridge().version()) === 3000n);
    t.check("owner, signer and BWSC's chain id come from the constructor", (await bridge().owner()) === ownerAddress && (await bridge().signer()).toLowerCase() === s.SIGNER.toLowerCase() && (await bridge().remoteChainId()) === REMOTE);
    const list = (await bridge().tokenList()).map((a) => a.toLowerCase());
    t.check("two tokens: the BWSC coin (BEP-20) and USDT", list.length === 2 && list[0] === NATIVE && list[1] === USDT);
    const nativeCfg = await bridge().getRoute(NATIVE);
    const usdtCfg = await bridge().getRoute(USDT);
    t.check("routes point at the BWSC side (native coin = 0x0, USDT program)", nativeCfg.remoteToken === ZERO && usdtCfg.remoteToken.toLowerCase() === t.deployed.addresses.USDT);
    t.check("fees and minimums come from the settings", nativeCfg.feeBps === BigInt(s.FEE_BPS_NATIVE) && usdtCfg.feeBps === BigInt(s.FEE_BPS_USDT) && usdtCfg.min === units(s.MIN_USDT));
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

    /* ------------------------------------ coins sent without addLiquidity */

    const held0 = (await tokenView(USDT)).held;
    await (await usdt(owner).mint(ownerAddress, units(7))).wait();
    await (await usdt(owner).transfer(BRIDGE, units(7))).wait();
    t.check("a plain transfer is not liquidity (held unchanged)", (await tokenView(USDT)).held === held0 && (await tokenView(USDT)).actual === held0 + units(7));
    t.check("sendOutExtraToken: only the owner", await reverts(() => bridge(stranger).sendOutExtraToken(USDT, stranger.address), "Only Owner"));
    t.check("sendOutExtraToken: the native coin goes through sendOutExtraNative", await reverts(() => bridge(owner).sendOutExtraToken(ZERO, ownerAddress), "Use sendOutExtraNative"));
    const x0 = await usdt().balanceOf(bobAddress);
    await (await bridge(owner).sendOutExtraToken(USDT, bobAddress)).wait();
    t.check("sendOutExtraToken sends back exactly the 7 sent by mistake, held untouched", (await usdt().balanceOf(bobAddress)) - x0 === units(7) && (await tokenView(USDT)).held === held0 && (await tokenView(USDT)).actual === held0);
    t.check("…and nothing more (the bridge's own money is never extra)", await reverts(() => bridge(owner).sendOutExtraToken(USDT, ownerAddress), "Nothing To Send"));

    /* ------------------------------------ fee-free wallets */

    t.check("setFeeExempt: only the owner", await reverts(() => bridge(stranger).setFeeExempt(stranger.address, true), "Only Owner"));
    t.check("setFeeExempt: the zero address is refused", await reverts(() => bridge(owner).setFeeExempt(ZERO, true), "Zero Account"));
    const fxReceipt = await (await bridge(owner).setFeeExempt(bobAddress, true)).wait();
    t.check("setFeeExempt: FeeExemptSet event", fxReceipt.logs.some((l) => { try { const e = bridge().interface.parseLog(l); return e?.name === "FeeExemptSet" && e.args.account === bobAddress && e.args.exempt === true; } catch { return false; } }));
    t.check("isFeeExempt and getBridgeView say bob is fee-free, alice is not", (await bridge().isFeeExempt(bobAddress)) && !(await bridge().isFeeExempt(aliceAddress))
        && (await bridge().getBridgeView(bobAddress, 0n, 1n)).feeExempt === true && (await bridge().getBridgeView(aliceAddress, 0n, 1n)).feeExempt === false);
    await (await usdt(owner).mint(bobAddress, units(50))).wait();
    await (await usdt(bob).approve(BRIDGE, units(50))).wait();
    const fees0 = (await tokenView(USDT)).fees;
    const bobIn0 = await bridge().bridgedInOf(bobAddress, USDT);
    await (await bridge(bob).bridgeIn(USDT, units(50))).wait();
    t.check("a fee-free wallet: the whole 50 is added to its total, no fee kept", (await bridge().bridgedInOf(bobAddress, USDT)) - bobIn0 === units(50) && (await tokenView(USDT)).fees === fees0);
    await (await usdt(alice).approve(BRIDGE, units(50))).wait();
    const aliceIn0 = await bridge().bridgedInOf(aliceAddress, USDT);
    await (await bridge(alice).bridgeIn(USDT, units(50))).wait();
    t.check("…other wallets still pay the fee", (await bridge().bridgedInOf(aliceAddress, USDT)) - aliceIn0 === units(50) - fee(units(50), usdtCfg.feeBps) && (await tokenView(USDT)).fees === fees0 + fee(units(50), usdtCfg.feeBps));
    await (await bridge(owner).setFeeExempt(bobAddress, false)).wait();
    await (await usdt(owner).mint(bobAddress, units(50))).wait();
    await (await usdt(bob).approve(BRIDGE, units(50))).wait();
    const bobIn1 = await bridge().bridgedInOf(bobAddress, USDT);
    await (await bridge(bob).bridgeIn(USDT, units(50))).wait();
    t.check("setFeeExempt false: bob pays the fee again", !(await bridge().isFeeExempt(bobAddress)) && (await bridge().bridgedInOf(bobAddress, USDT)) - bobIn1 === units(50) - fee(units(50), usdtCfg.feeBps));

    /* ------------------------------------ moving to a new bridge: totals come along, nobody claims twice */

    const OLD = BRIDGE;
    const old = bridge;
    const before = {
        aliceUsdt: await old().bridgedInOf(aliceAddress, USDT), aliceBnb: await old().bridgedInOf(aliceAddress, ZERO),
        bobCoin: await old().claimedOutOf(bobAddress, NATIVE), bobBnb: await old().claimedOutOf(bobAddress, ZERO),
    };
    const routes = [ NATIVE, USDT, ZERO ];
    const remotes = await Promise.all(routes.map(async (r) => (await old().getRoute(r)).remoteToken));
    const deployNew = (previous, remote = REMOTE) => new ethers.ContractFactory(contracts.BwscBridgeEvm.abi, contracts.BwscBridgeEvm.bytecode, owner)
        .deploy(ownerAddress, signerKey.address, remote, previous, routes, remotes, [ 10n, 10n, 10n ], [ 0n, 0n, 0n ]);
    t.check("previous must be a contract", await reverts(() => deployNew(stranger.address), "Previous Is Not A Contract"));
    t.check("previous must bridge with the same chain", await reverts(() => deployNew(OLD, 999n), "Previous Bridge Has Another Remote Chain"));
    const fresh = await (await deployNew(OLD)).waitForDeployment();
    const NEW = await fresh.getAddress();
    const next2 = (who = owner) => new ethers.Contract(NEW, contracts.BwscBridgeEvm.abi, who);
    t.check("new bridge: knows the old one, starts paused and migrating", (await next2().previousBridge()).toLowerCase() === OLD.toLowerCase() && (await next2().paused()) && (await next2().migrating()));
    t.check("new bridge: cannot be unpaused before the migration is closed", await reverts(() => next2(owner).setPaused(false), "Close The Migration First"));
    t.check("import is refused while the old bridge still moves", await reverts(() => next2(stranger).importAccounts([ aliceAddress ]), "Pause The Previous Bridge First"));
    await (await old(owner).setPaused(true)).wait();
    tx = await next2(stranger).importAccounts([ aliceAddress, bobAddress, ownerAddress ]);
    await gas("importAccounts (3 accounts × 3 tokens)", tx);
    const after = {
        aliceUsdt: await next2().bridgedInOf(aliceAddress, USDT), aliceBnb: await next2().bridgedInOf(aliceAddress, ZERO),
        bobCoin: await next2().claimedOutOf(bobAddress, NATIVE), bobBnb: await next2().claimedOutOf(bobAddress, ZERO),
    };
    const same = (a, b) => JSON.stringify(a, (k, x) => (typeof x === "bigint" ? `${x}` : x)) === JSON.stringify(b, (k, x) => (typeof x === "bigint" ? `${x}` : x));
    t.check("anyone may import; every total is copied from the old contract", same(before, after) && before.bobCoin > 0n, JSON.stringify(after, (k, x) => (typeof x === "bigint" ? `${x}` : x)));
    const usdtIn = before.aliceUsdt + (await old().bridgedInOf(bobAddress, USDT));   // bob bridged USDT in as a fee-free wallet
    t.check("route totals include the imported ones (so routes stay fixed)", (await next2().getRoute(USDT)).totalBridgedIn === usdtIn && (await next2().getRoute(NATIVE)).totalClaimedOut === before.bobCoin);
    await (await next2(stranger).importAccounts([ aliceAddress, bobAddress ])).wait();
    t.check("importing again changes nothing", (await next2().getRoute(USDT)).totalBridgedIn === usdtIn && (await next2().claimedOutOf(bobAddress, NATIVE)) === before.bobCoin);
    t.check("only the owner closes the migration", await reverts(() => next2(stranger).closeMigration(), "Only Owner"));
    await (await next2(owner).closeMigration()).wait();
    t.check("after closing: no more imports", await reverts(() => next2(stranger).importAccounts([ stranger.address ]), "No Migration Open"));
    await (await next2(owner).setPaused(false)).wait();
    await (await erc20(NATIVE, owner).approve(NEW, units(100))).wait();
    await (await next2(owner).addLiquidity(NATIVE, units(100))).wait();
    const signNew = (account, token, total) => sign(account, token, total, { verifying: NEW });
    t.check("bob's coins already paid by the old bridge cannot be paid again", await reverts(async () => next2(bob).claimOut(bobAddress, NATIVE, before.bobCoin, await signNew(bobAddress, NATIVE, before.bobCoin)), "Nothing To Claim"));
    t.check("a signature for the old bridge does not work on the new one", await reverts(async () => next2(bob).claimOut(bobAddress, NATIVE, before.bobCoin + units(20), await sign(bobAddress, NATIVE, before.bobCoin + units(20))), "Not Signed By The Bridge Signer"));
    const nb0 = await erc20(NATIVE).balanceOf(bobAddress);
    await (await next2(relayer).claimOut(bobAddress, NATIVE, before.bobCoin + units(20), await signNew(bobAddress, NATIVE, before.bobCoin + units(20)))).wait();
    t.check("a newer total pays only the difference (20)", (await erc20(NATIVE).balanceOf(bobAddress)) - nb0 === units(20));
    await (await usdt(alice).approve(NEW, units(10))).wait();
    await (await next2(alice).bridgeIn(USDT, units(10))).wait();
    t.check("alice's next bridgeIn adds to her imported total (BWSC sees one running total)", (await next2().bridgedInOf(aliceAddress, USDT)) === before.aliceUsdt + units(10) - fee(units(10), 10n));
    await (await old(owner).setPaused(false)).wait();

    await (await bridge(owner).transferOwnership(await alice.getAddress())).wait();
    t.check("transferOwnership: the old owner cannot pause", await reverts(() => bridge(owner).setPaused(true), "Only Owner"));
}
