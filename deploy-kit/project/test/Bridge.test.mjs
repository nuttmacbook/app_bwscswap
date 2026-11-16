/*
 * YOUR CODE (tests). The whole bridge: BSC (anvil) ↔ bridge signer ↔ BWSC (real node), both ways, through the
 * signer library and its HTTP API, exactly as the website and a relayer use them. Skipped without anvil.
 */

import { ethers } from "ethers";
import { createClient } from "bwscbox";
import { devKey, PEOPLE_FROM } from "../../engine/node.mjs";
import { createBridgeSigner } from "../../../bridge-signer/src/signer.mjs";
import { createSignerServer } from "../../../bridge-signer/src/http.mjs";
import { seedBridge } from "../seed.mjs";
import { deployToken } from "./tools.mjs";

const ZERO = ethers.ZeroAddress;
const BPS = 10_000n;
const units = (text) => ethers.parseUnits(String(text), 18);

export default async function (t) {
    if (!t.bsc) return t.skip("Bridge", "anvil is not installed (Foundry): no local BSC");
    const { deployed } = t;
    const { anvil, contracts, addresses, tokens } = t.bsc;
    await seedBridge({ deployed, bsc: t.bsc, native: 1_000, usdt: 100_000 });

    const BSC_BRIDGE = addresses.BwscBridgeEvm;
    const BWSC_BRIDGE = deployed.addresses.BwscBridge;
    const BSC_USDT = tokens.USDT.address;
    const BSC_COIN = tokens.tBWSC.address;
    const BWSC_USDT = deployed.addresses.USDT;
    const nodeUrl = `http://127.0.0.1:${t.local.TEST_PORT}`;
    const config = { key: devKey(4), hub: { nodeUrl, bridge: BWSC_BRIDGE }, chains: [ { key: "bsc", rpcUrl: anvil.url, bridge: BSC_BRIDGE, confirmations: 0 } ] };
    const BSC_ID = BigInt(anvil.chainId);
    const signer = createBridgeSigner({ ethers, createClient }, config);

    // One person, the same address on both chains (same key)
    const person = t.newWallet();
    const index = Array.from({ length: 60 }, (_, i) => PEOPLE_FROM + i).find((i) => new ethers.Wallet(devKey(i)).address.toLowerCase() === person.address);
    const onBsc = anvil.wallet(index);
    const relayer = t.newWallet();
    const bscBridge = (who) => new ethers.Contract(BSC_BRIDGE, contracts.BwscBridgeEvm.abi, who);
    const bscToken = (address, who = anvil.wallet(0)) => new ethers.Contract(address, contracts.MockToken.abi, who);
    const bwscUsdt = (who) => t.read("USDT", "balanceOf", { who });
    const feeOf = (amount, bps) => (amount * bps) / BPS;
    const bscFee = (await bscBridge(anvil.provider).getRoute(BSC_USDT)).feeBps;
    const hubRoute = async (token) => (await t.read("BwscBridge", "getView", { account: "", offset: 0n, limit: 100n })).routes.find((x) => x.token === token && x.chainId === BSC_ID);
    const bwscFee = (await hubRoute(BWSC_USDT)).feeBps;

    const status = await signer.status();
    t.check("signer checks every bridge trusts its key, and reads the chain ids", status.signer === new ethers.Wallet(devKey(4)).address.toLowerCase() && status.chains[0].chainId === anvil.chainId && status.hub.chainId === Number(t.local.LOCAL_CHAIN_ID));

    /* ------------------------------------ BSC → BWSC: USDT */

    await (await bscToken(BSC_USDT).mint(person.address, units(1000))).wait();
    await (await bscToken(BSC_USDT, onBsc).approve(BSC_BRIDGE, units(200))).wait();
    await (await bscBridge(onBsc).bridgeIn(BSC_USDT, units(200))).wait();
    let c = await signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_USDT });
    const total1 = units(200) - feeOf(units(200), bscFee);
    t.check("bridge in 200 USDT → signer signs total 199.8 for BWSC's USDT", c.total === String(total1) && c.token === BWSC_USDT && c.to === "bwsc" && c.signature);
    const u0 = await bwscUsdt(person.address);
    let r = await t.send(relayer, "BwscBridge", "claimIn", { chainId: BSC_ID, account: c.account, token: c.token, total: BigInt(c.total), signature: c.signature });
    t.check("a relayer claims it on BWSC: the person gets 199.8 USDT", (await bwscUsdt(person.address)) - u0 === total1);
    const old = c;

    await (await bscToken(BSC_USDT, onBsc).approve(BSC_BRIDGE, units(120))).wait();
    await (await bscBridge(onBsc).bridgeIn(BSC_USDT, units(120))).wait();
    c = await signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_USDT });
    const total2 = total1 + units(120) - feeOf(units(120), bscFee);
    t.check("120 more → the signer signs the new running total", c.total === String(total2));
    r = await t.send(person, "BwscBridge", "claimIn", { chainId: BSC_ID, account: c.account, token: c.token, total: BigInt(c.total), signature: c.signature });
    t.check("claiming pays only the difference (new total − claimed)", r.result === total2 - total1 && (await bwscUsdt(person.address)) - u0 === total2);
    t.check("the first signature can never be used again", await t.doesRevert(() => t.send(person, "BwscBridge", "claimIn", { chainId: BSC_ID, account: old.account, token: old.token, total: BigInt(old.total), signature: old.signature }), "already paid"));

    /* ------------------------------------ BSC → BWSC: the BEP-20 of the coin arrives as the native coin */

    await (await bscToken(BSC_COIN).mint(person.address, units(50))).wait();
    await (await bscToken(BSC_COIN, onBsc).approve(BSC_BRIDGE, units(30))).wait();
    await (await bscBridge(onBsc).bridgeIn(BSC_COIN, units(30))).wait();
    c = await signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_COIN });
    const coinFee = (await bscBridge(anvil.provider).getRoute(BSC_COIN)).feeBps;
    const nativeIn = units(30) - feeOf(units(30), coinFee);
    t.check("bridge in 30 BWSC (BEP-20) → signed for the native coin (0x0) on BWSC", c.token === ZERO && c.total === String(nativeIn));
    const n0 = await t.balance(person.address);
    await t.send(relayer, "BwscBridge", "claimIn", { chainId: BSC_ID, account: c.account, token: c.token, total: BigInt(c.total), signature: c.signature });
    t.check("…a relayer claims: the person gets 29.97 native coins on BWSC", (await t.balance(person.address)) - n0 === nativeIn);

    /* ------------------------------------ BWSC → BSC: native coin and USDT */

    await t.send(person, "BwscBridge", "bridgeOut", { chainId: BSC_ID, token: ZERO, amount: units(10) }, { value: units(10) });
    c = await signer.claim({ from: "bwsc", to: "bsc", account: person.address, token: ZERO });
    const nativeOut = units(10) - feeOf(units(10), (await hubRoute(ZERO)).feeBps);
    t.check("bridge out 10 native coins → signed for BSC's BWSC coin", c.total === String(nativeOut) && c.token === BSC_COIN && c.to === "bsc" && c.chainId === anvil.chainId);
    const coin0 = await bscToken(BSC_COIN).balanceOf(person.address);
    await (await bscBridge(anvil.wallet(25)).claimOut(c.account, c.token, BigInt(c.total), c.signature)).wait();
    t.check("anyone claims it on BSC: the person gets 9.99 BWSC (BEP-20)", (await bscToken(BSC_COIN).balanceOf(person.address)) - coin0 === nativeOut);

    await t.send(person, "USDT", "approve", { spender: BWSC_BRIDGE, amount: units(50) });
    await t.send(person, "BwscBridge", "bridgeOut", { chainId: BSC_ID, token: BWSC_USDT, amount: units(50) });
    c = await signer.claim({ from: "bwsc", to: "bsc", account: person.address, token: BWSC_USDT });
    const usdtOut = units(50) - feeOf(units(50), bwscFee);
    const b0 = await bscToken(BSC_USDT).balanceOf(person.address);
    await (await bscBridge(onBsc).claimOut(c.account, c.token, BigInt(c.total), c.signature)).wait();
    t.check("bridge 50 USDT back out → 49.95 USDT on BSC", c.token === BSC_USDT && (await bscToken(BSC_USDT).balanceOf(person.address)) - b0 === usdtOut);

    /* ------------------------------------ the signer's own checks */

    c = await signer.claim({ from: "bwsc", to: "bsc", account: relayer.address, token: BWSC_USDT });
    t.check("nothing bridged yet → no signature", c.total === "0" && c.signature === null);
    // An address that is a coin on neither chain (on the mock node, BWSC_USDT can share an address with a local BSC coin)
    t.check("an unknown coin is refused", await t.doesRevert(() => signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: "0x000000000000000000000000000000000000dEaD" }), "no route"));
    t.check("an unknown chain is refused", await t.doesRevert(() => signer.claim({ from: "eth", to: "bwsc", account: person.address, token: BSC_USDT }), "Unknown chain"));
    t.check("two chains that are not BWSC are refused", await t.doesRevert(() => signer.claim({ from: "bsc", to: "bsc", account: person.address, token: BSC_USDT }), "One side must be BWSC"));

    // Confirmations: a deposit is signed only after N more blocks on BSC
    const slow = createBridgeSigner({ ethers, createClient }, { ...config, chains: [ { ...config.chains[0], confirmations: 3 } ] });
    await (await bscToken(BSC_USDT, onBsc).approve(BSC_BRIDGE, units(10))).wait();
    await (await bscBridge(onBsc).bridgeIn(BSC_USDT, units(10))).wait();
    const fresh = (await slow.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_USDT })).total;
    await anvil.provider.send("anvil_mine", [ "0x3" ]);
    const settled = (await slow.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_USDT })).total;
    t.check("with 3 confirmations, a new deposit is signed only 3 blocks later", fresh === String(total2) && settled === String(total2 + units(10) - feeOf(units(10), bscFee)), `${fresh} → ${settled}`);
    slow.stop();

    // Routes must point at each other: a new BWSC coin routed to BSC's USDT (BSC's USDT routes back to BWSC's USDT)
    const ODD = await deployToken(t, "ODD");
    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC_ID, token: ODD, remoteToken: BSC_USDT, enabled: true, feeBps: 0n, min: 0n });
    await t.send(t.owner, ODD, "transfer", { to: person.address, amount: units(1) });
    await t.send(person, ODD, "approve", { spender: BWSC_BRIDGE, amount: units(1) });
    await t.send(person, "BwscBridge", "bridgeOut", { chainId: BSC_ID, token: ODD, amount: units(1) });
    t.check("routes that do not point at each other are refused", await t.doesRevert(() => signer.claim({ from: "bwsc", to: "bsc", account: person.address, token: ODD }), "not the same on both bridges"));

    // Decimals must match (the bridge pays 1:1): an 18-decimal BSC token routed both ways with a 6-decimal BWSC token is refused
    const SIX = await deployToken(t, "SIX", { decimals: 6 });
    const big = await new ethers.ContractFactory(contracts.MockToken.abi, contracts.MockToken.bytecode, anvil.wallet(0)).deploy("Eighteen", "E18", 18);
    await big.waitForDeployment();
    const E18 = (await big.getAddress()).toLowerCase();
    await (await bscBridge(anvil.wallet(0)).setRoute(E18, SIX, true, 0n, 0n)).wait();
    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC_ID, token: SIX, remoteToken: E18, enabled: true, feeBps: 0n, min: 0n });
    await (await big.mint(person.address, units(5))).wait();
    await (await big.connect(onBsc).approve(BSC_BRIDGE, units(5))).wait();
    await (await bscBridge(onBsc).bridgeIn(E18, units(5))).wait();
    t.check("a route whose decimals differ is refused (18 on BSC, 6 on BWSC)", await t.doesRevert(() => signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: E18 }), "decimals"));

    // BNB (BSC's own coin) ↔ a BWSC token: native on one side, token on the other
    await (await bscBridge(anvil.wallet(0)).setRoute(ZERO, ODD, true, 0n, 0n)).wait();
    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC_ID, token: ODD, remoteToken: ZERO, enabled: true, feeBps: 0n, min: 0n }).catch(() => null);
    t.check("a BWSC route's other side cannot change once coins moved (ODD stays on BSC-USD)", (await hubRoute(ODD)).remoteToken === BSC_USDT);
    const WB = await deployToken(t, "WBNB");
    await t.send(t.owner, "BwscBridge", "setRoute", { chainId: BSC_ID, token: WB, remoteToken: ZERO, enabled: true, feeBps: 0n, min: 0n });
    await (await bscBridge(anvil.wallet(0)).setRoute(ZERO, WB, true, 0n, 0n)).wait();
    await t.send(t.owner, WB, "approve", { spender: BWSC_BRIDGE, amount: units(10) });
    await t.send(t.owner, "BwscBridge", "addLiquidity", { token: WB, amount: units(10) });
    await (await bscBridge(onBsc).bridgeIn(ZERO, units(2), { value: units(2) })).wait();
    c = await signer.claim({ from: "bsc", to: "bwsc", account: person.address, token: ZERO });
    await t.send(relayer, "BwscBridge", "claimIn", { chainId: BSC_ID, account: c.account, token: c.token, total: BigInt(c.total), signature: c.signature });
    t.check("BNB (native on BSC) → a token on BWSC: signed and paid", c.token === WB && (await t.read(WB, "balanceOf", { who: person.address })) === units(2));

    /* ------------------------------------ HTTP API (what the website calls) */

    const server = createSignerServer(signer, { allowOrigin: "http://site.test" });
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let res = await fetch(`${base}/claim?from=bsc&to=bwsc&account=${person.address}&token=${BSC_USDT}`, { headers: { origin: "http://site.test" } });
    let body = await res.json();
    t.check("GET /claim answers the same signed total, with CORS for the website", res.status === 200 && body.signature && res.headers.get("access-control-allow-origin") === "http://site.test");
    res = await fetch(`${base}/claim?from=bsc&to=bwsc&account=${person.address}&token=${BSC_USDT}`, { headers: { origin: "http://evil.test" } });
    t.check("…other websites get no CORS header", res.headers.get("access-control-allow-origin") === null);
    res = await fetch(`${base}/claim?from=bsc&to=bwsc&account=nope&token=${BSC_USDT}`);
    body = await res.json();
    t.check("bad input → 400 with a message", res.status === 400 && body.error.includes("account"));
    res = await fetch(`${base}/status`);
    t.check("GET /status", res.status === 200 && (await res.json()).signer === status.signer);
    server.close();

    // A signer key the bridges do not trust is refused at start
    const wrong = createBridgeSigner({ ethers, createClient }, { ...config, key: devKey(5) });
    t.check("a key that is not the bridges' signer refuses to sign", await t.doesRevert(() => wrong.claim({ from: "bsc", to: "bwsc", account: person.address, token: BSC_USDT }), "signer is"));
    wrong.stop();
    signer.stop();

    /* ------------------------------------ money adds up on both sides */

    const bscView = await bscBridge(anvil.provider).getBridgeView(ZERO, 0n, 100n);
    t.check("BSC: held = token balance for every route", bscView.routes.every((x) => x.held === x.actual));
    const bwscView = await t.read("BwscBridge", "getView", { account: "", offset: 0n, limit: 100n });
    const u = bwscView.coins.find((x) => x.address === BWSC_USDT);
    t.check("BWSC: USDT held = the program's balance", u.held === u.actual);
    t.check("BSC USDT bridged in (net) = BWSC USDT claimed in from BSC", bscView.routes.find((x) => x.token.toLowerCase() === BSC_USDT).totalBridgedIn - units(10) + feeOf(units(10), bscFee) === (await hubRoute(BWSC_USDT)).totalClaimedIn);
}
