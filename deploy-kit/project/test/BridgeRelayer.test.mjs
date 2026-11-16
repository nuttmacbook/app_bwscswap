/*
 * YOUR CODE (tests). Automatic delivery: bridge-signer's relayer (bridge-signer/src/relayer.mjs) finds every transfer on
 * BSC (anvil) and BWSC (node) by itself and claims it for the user, who never presses "claim". Also: the gas drop for a
 * wallet with no BWSC, nothing paid twice, the website's /deliver, and a restart from the saved state.
 * Skipped without anvil.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { createClient, keyWalletSigner } from "bwscbox";
import { devKey, PEOPLE_FROM } from "../../engine/node.mjs";
import { createBridgeSigner } from "../../../bridge-signer/src/signer.mjs";
import { createSignerServer } from "../../../bridge-signer/src/http.mjs";
import { createRelayer } from "../../../bridge-signer/src/relayer.mjs";
import { seedBridge } from "../seed.mjs";

const BPS = 10_000n;
const units = (text) => ethers.parseUnits(String(text), 18);
const quiet = { log: () => {}, error: () => {} };

export default async function (t) {
    if (!t.bsc) return t.skip("BridgeRelayer", "anvil is not installed (Foundry): no local BSC");
    const { deployed } = t;
    const { anvil, contracts, addresses, tokens } = t.bsc;
    await seedBridge({ deployed, bsc: t.bsc, native: 1_000, usdt: 100_000 });

    const BSC_BRIDGE = addresses.BwscBridgeEvm;
    const BWSC_BRIDGE = deployed.addresses.BwscBridge;
    const BSC_USDT = tokens.USDT.address;
    const BWSC_USDT = deployed.addresses.USDT;
    const BSC_ID = BigInt(anvil.chainId);
    const nodeUrl = `http://127.0.0.1:${t.local.TEST_PORT}`;
    const signer = createBridgeSigner({ ethers, createClient }, { key: devKey(4), hub: { nodeUrl, bridge: BWSC_BRIDGE }, chains: [ { key: "bsc", rpcUrl: anvil.url, bridge: BSC_BRIDGE, confirmations: 0 } ] });

    // The relayer pays gas with its OWN wallet (not the signer's): a funded person on both chains
    const indexOf = (address) => Array.from({ length: 60 }, (_, i) => PEOPLE_FROM + i).find((i) => new ethers.Wallet(devKey(i)).address.toLowerCase() === address);
    const payer = t.newWallet();
    const payerKey = devKey(indexOf(payer.address));
    const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relayer-")), "state.json");
    const makeRelayer = () => createRelayer({ ethers, createClient, keyWalletSigner }, {
        signer, key: payerKey, stateFile, intervalMs: 3_600_000, log: quiet,
        hub: { key: "bwsc", nodeUrl, bridge: BWSC_BRIDGE, gasDrop: units("0.5") },
        chains: [ { key: "bsc", rpcUrl: anvil.url, bridge: BSC_BRIDGE, gasDrop: 0n } ],
    });
    let relayer = makeRelayer();
    const started = await relayer.start();
    t.check("relayer starts with its own wallet and reads both chains", started.address === payer.address && started.queued === 0 && Object.keys(started.lastScan.errors).length === 0, JSON.stringify(started.lastScan.errors));

    const bscBridge = (who) => new ethers.Contract(BSC_BRIDGE, contracts.BwscBridgeEvm.abi, who);
    const bscToken = (address, who = anvil.wallet(0)) => new ethers.Contract(address, contracts.MockToken.abi, who);
    const bwscUsdt = (who) => t.read("USDT", "balanceOf", { who });
    const bscFee = (await bscBridge(anvil.provider).getRoute(BSC_USDT)).feeBps;
    const net = (amount, bps) => amount - (amount * bps) / BPS;
    // Runs the relayer until `done()` or 10 rounds
    const until = async (done) => { for (let i = 0; i < 10; i++) { await relayer.tick(); if (await done()) return true; } return false; };

    /* ------------------------------------ a brand-new wallet: no BWSC at all */

    const fresh = ethers.Wallet.createRandom().connect(anvil.provider);
    const who = fresh.address.toLowerCase();
    await (await anvil.wallet(0).sendTransaction({ to: who, value: units("0.05") })).wait();
    await (await bscToken(BSC_USDT).mint(who, units(100))).wait();
    t.check("new wallet: 0 BWSC on BWSC before", (await t.balance(who)) === 0n);
    await (await bscToken(BSC_USDT, fresh).approve(BSC_BRIDGE, units(100))).wait();
    await (await bscBridge(fresh).bridgeIn(BSC_USDT, units(100))).wait();
    const arrived = await until(async () => (await bwscUsdt(who)) > 0n);
    t.check("BSC → BWSC: the USDT arrives by itself, nobody claims", arrived && (await bwscUsdt(who)) === net(units(100), bscFee));
    t.check("gas drop: the new wallet also got 0.5 BWSC for gas", (await t.balance(who)) === units("0.5"));
    t.check("the relayer paid the gas, not the user (the claim was sent by the relayer)", (await t.read("BwscBridge", "claimedInOf", { chainId: BSC_ID, account: who, token: BWSC_USDT })) === net(units(100), bscFee));

    // A second transfer: delivered again, but no second gas drop
    await (await bscToken(BSC_USDT).mint(who, units(50))).wait();
    await (await bscToken(BSC_USDT, fresh).approve(BSC_BRIDGE, units(50))).wait();
    await (await bscBridge(fresh).bridgeIn(BSC_USDT, units(50))).wait();
    await until(async () => (await bwscUsdt(who)) > net(units(100), bscFee));
    t.check("a second transfer arrives too (only the difference is paid)", (await bwscUsdt(who)) === net(units(100), bscFee) + net(units(50), bscFee));
    t.check("gas drop only once per wallet", (await t.balance(who)) === units("0.5"));

    /* ------------------------------------ BWSC → BSC */

    const person = t.newWallet();
    const hubFee = (await t.read("BwscBridge", "getView", { account: "", offset: 0n, limit: 100n })).routes.find((x) => x.token === BWSC_USDT && x.chainId === BSC_ID).feeBps;
    await t.send(deployed.owner, "USDT", "transfer", { to: person.address, amount: units(40) });
    await t.send(person, "USDT", "approve", { spender: BWSC_BRIDGE, amount: units(40) });
    await t.send(person, "BwscBridge", "bridgeOut", { chainId: BSC_ID, token: BWSC_USDT, amount: units(40) });
    const bscUsdt = (a) => bscToken(BSC_USDT).balanceOf(a);
    const out = await until(async () => (await bscUsdt(person.address)) > 0n);
    t.check("BWSC → BSC: the USDT arrives on BSC by itself (found in BWSC's events)", out && (await bscUsdt(person.address)) === net(units(40), hubFee));

    /* ------------------------------------ nothing twice */

    const before = [ await bwscUsdt(who), await bscUsdt(person.address) ];
    await relayer.tick();
    await relayer.tick();
    t.check("more rounds pay nothing more, the queue is empty", (await bwscUsdt(who)) === before[0] && (await bscUsdt(person.address)) === before[1] && relayer.pending().length === 0);

    /* ------------------------------------ the website's /deliver, and a restart */

    const server = createSignerServer(signer, { allowOrigin: "*", relayer });
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const bad = await fetch(`${base}/deliver?from=bsc&to=bwsc&account=0x1&token=${BSC_USDT}`);
    t.check("/deliver refuses a bad account (400)", bad.status === 400);
    const st = await (await fetch(`${base}/status`)).json();
    t.check("/status shows the relayer, its gas money and the gas drop", st.relayer?.address === payer.address && Number(st.relayer.balances.bwsc) > 0 && Number(st.relayer.balances.bsc) > 0 && st.relayer.gasDrop.bwsc === "0.5");

    server.close();
    relayer.stop();
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    t.check("state saved: how far each chain was read, and who got a gas drop", Number(saved.cursors.bsc) > 0 && Array.isArray(saved.hubSeen) && Boolean(saved.dropped[`bwsc:${who}`]));
    relayer = makeRelayer();
    await relayer.start();
    // The deposit arrives while the relayer was off; the website also tells it (with the deposit's block)
    await (await bscToken(BSC_USDT).mint(who, units(10))).wait();
    await (await bscToken(BSC_USDT, fresh).approve(BSC_BRIDGE, units(10))).wait();
    const receipt = await (await bscBridge(fresh).bridgeIn(BSC_USDT, units(10))).wait();
    const s2 = createSignerServer(signer, { allowOrigin: "*", relayer });
    await new Promise((resolve) => s2.listen(0, resolve));
    const told2 = await (await fetch(`http://127.0.0.1:${s2.address().port}/deliver?from=bsc&to=bwsc&account=${who}&token=${BSC_USDT}&block=${receipt.blockNumber}`)).json();
    await until(async () => (await bwscUsdt(who)) > before[0]);
    t.check("after a restart: carries on from the saved state, /deliver queues it, it arrives", told2.queued === true && (await bwscUsdt(who)) === before[0] + net(units(10), bscFee), JSON.stringify(told2));
    t.check("…and still no second gas drop after the restart", (await t.balance(who)) === units("0.5"));
    s2.close();
    relayer.stop();
}
