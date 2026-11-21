/*
 * YOUR CODE (tests). The deploy guide itself (deploy-kit/README.md): deploy-kit/bwsc/inputs/*.json are deployed exactly
 * the way the explorer sends them (the program file as text + that JSON, placeholders replaced, then the admin's init),
 * in the guide's order, and the BSC side the way Remix does it (coin, then the bridge with its constructor values; no proxy).
 * Then step 9 (pair, first liquidity, stake pools, bridge liquidity) and one trip over the bridge.
 * If a file in inputs/ or a step in the guide stops matching the programs, this fails.
 */

import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { utils, createClient } from "bwscbox";
import { sendAndWait } from "../../engine/deploy-steps.mjs";
import { devKey } from "../../engine/node.mjs";
import { createBridgeSigner } from "../../../bridge-signer/src/signer.mjs";

const INPUTS = path.resolve(import.meta.dirname, "../../bwsc/inputs");
const ZERO = "0x0000000000000000000000000000000000000000";
const BSC_USD = "0x55d398326f99059fF775485246999027B3197955";
const units = (text) => utils.toUnits(String(text), 18);

/** The explorer's own conversion: whole JSON numbers become "123n", strings stay as they are */
const bigints = (v) => (typeof v === "number" && Number.isInteger(v) ? `${v}n`
    : Array.isArray(v) ? v.map(bigints) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([ k, x ]) => [ k, bigints(x) ])) : v);

/** inputs/<file> with every <PLACEHOLDER> (and any text in `swap`) replaced; a placeholder left over fails the test */
const inputOf = (file, values, swap = {}) => {
    let text = fs.readFileSync(path.join(INPUTS, file), "utf8");
    for (const [ key, value ] of Object.entries(values)) text = text.replaceAll(`<${key}>`, value);
    for (const [ from, to ] of Object.entries(swap)) text = text.replaceAll(from, to);
    const left = text.match(/<[A-Za-z_]+>/g);
    if (left) throw new Error(`${file}: ${left.join(", ")} has no value in this test`);
    return bigints(JSON.parse(text));
};

export default async function (t) {
    const { client, programs } = t;
    const me = t.owner.address;
    const signerKey = new ethers.Wallet(devKey(4));
    const signer = signerKey.address.toLowerCase();

    /** Explorer "Deploy": code + input (+ upgrader) → then the admin approves it (init) */
    const deploy = async (name, input, { upgrader = null } = {}) => {
        const sent = await sendAndWait(client, t.owner, { action: "deploy", code: programs[name].code, input, ...(upgrader ? { upgrader } : {}), gasLimit: 1_500_000 });
        const address = String(sent.result?.programUuid ?? "").toLowerCase();
        await sendAndWait(client, t.owner, { action: "init", to: address, gasLimit: 1_000_000 });
        return address;
    };

    const files = fs.readdirSync(INPUTS).filter((f) => f.endsWith(".json")).sort();
    t.check("inputs/: one file per BWSC deploy step, in order", files.join() === "1-USDT.json,2-wBWSC.json,3-BwscDex.json,4-BwscStaking.json,4b-BwscLimit.json,4c-BwscMultiSend.json,8-BwscBridge.json", files.join(", "));
    t.check("every program in bwsc/ starts with function program() { (nothing before it)", fs.readdirSync(path.resolve(INPUTS, "..")).filter((f) => f.endsWith(".js")).every((f) => fs.readFileSync(path.resolve(INPUTS, "..", f), "utf8").startsWith("function program() {")));

    /* ------------------------------------ BWSC steps 1–4 */

    const usdt = await deploy("Token", inputOf("1-USDT.json", {}));
    t.check("step 1: USDT on BWSC, 18 decimals, the whole supply in the deploying wallet", (await t.read(usdt, "ticker")) === "USDT" && (await t.read(usdt, "decimals")) === 18n && (await t.read(usdt, "balanceOf", { who: me })) === units("1000000000"));
    const wbwsc = await deploy("WBWSC", inputOf("2-wBWSC.json", {}));
    t.check("step 2: wBWSC, 18 decimals, empty, no owner", (await t.read(wbwsc, "ticker")) === "wBWSC" && (await t.read(wbwsc, "decimals")) === 18n && (await t.read(wbwsc, "totalSupply")) === 0n);
    const dex = await deploy("BwscDex", inputOf("3-BwscDex.json", { YOUR_WALLET: me, wBWSC_ADDRESS: wbwsc }), { upgrader: me });
    const dv = await t.read(dex, "getView", { account: "", offset: 0n, limit: 1n });
    t.check("step 3: the exchange: owned by you, wBWSC as the wrapper, 0.30% default fee, only you add pairs", dv.owner === me && dv.wrapped === wbwsc && dv.defaultFeeBps === 30n && !dv.openPairs && dv.pairCount === 0n);
    const staking = await deploy("BwscStaking", inputOf("4-BwscStaking.json", { YOUR_WALLET: me }), { upgrader: me });
    t.check("step 4: BwscStaking starts with no pools, owned by you", (await t.read(staking, "getView", { account: "" })).owner === me);
    const limit = await deploy("BwscLimit", inputOf("4b-BwscLimit.json", { YOUR_WALLET: me, USDT_ON_BWSC_ADDRESS: usdt, wBWSC_ADDRESS: wbwsc }), { upgrader: me });
    const lv = await t.read(limit, "getView", { account: "", offset: 0n, limit: 1n });
    t.check("step 4b: BwscLimit owned by you, the native coin, USDT and wBWSC listed at 0.1%", lv.owner === me && lv.coins.length === 3 && lv.coins.every((c) => c.feeBps === 10n && c.enabled) && lv.coins.at(1).token === usdt && lv.coins.at(2).symbol === "wBWSC");

    const multi = await deploy("BwscMultiSend", inputOf("4c-BwscMultiSend.json", {}));
    const mv = await t.read(multi, "getView", { account: me, token: usdt });
    t.check("step 4c: BwscMultiSend (no upgrader): 200 wallets per transaction, reads your USDT", mv.maxTransfers === 200n && mv.balance === units("1000000000") && mv.symbol === "USDT");

    /* ------------------------------------ BSC steps 5–7 (Remix), when anvil is installed */

    let coinBsc = "0x1111111111111111111111111111111111111111";
    let usdOnBsc = BSC_USD.toLowerCase();
    let bsc = null;
    const hubChainId = BigInt((await client.genesis()).chainId);
    if (t.bsc) {
        const wallet = t.bsc.anvil.wallet(0);
        const factory = (name) => new ethers.ContractFactory(t.bsc.contracts[name].abi, t.bsc.contracts[name].bytecode, wallet);
        // BSC-USD on the local BSC: a stand-in at whatever address anvil gives it
        const usd = await (await factory("BwscCoinBsc").deploy("Binance-Peg BSC-USD", "USDT", units(1_000_000), wallet.address)).waitForDeployment();
        usdOnBsc = (await usd.getAddress()).toLowerCase();
        // Step 5: the BWSC coin as a BEP-20
        const coin = await (await factory("BwscCoinBsc").deploy("Bluewolfchain", "BWSC", units(100_000_000), wallet.address)).waitForDeployment();
        coinBsc = (await coin.getAddress()).toLowerCase();
        // Step 6: the bridge itself, no proxy: Remix's Deploy with the constructor's values (previous = 0x0, a new bridge)
        const bridge = await (await factory("BwscBridgeEvm").deploy(
            wallet.address, signer, hubChainId, ZERO, [ coinBsc, usdOnBsc ], [ ZERO, usdt ], [ 10, 10 ], [ "1000000000000000000", "5000000000000000000" ],
        )).waitForDeployment();
        const bridgeBsc = new ethers.Contract(await bridge.getAddress(), t.bsc.contracts.BwscBridgeEvm.abi, wallet);
        const list = (await bridgeBsc.tokenList()).map((a) => a.toLowerCase());
        t.check("steps 5–6: the BSC bridge (no proxy) has your owner, signer, BWSC's chain id and both coins, and is open", (await bridgeBsc.owner()) === wallet.address && (await bridgeBsc.signer()).toLowerCase() === signer
            && (await bridgeBsc.remoteChainId()) === hubChainId && list.join() === [ coinBsc, usdOnBsc ].join() && !(await bridgeBsc.paused()) && !(await bridgeBsc.migrating()));
        t.check("step 6: there is nothing to upgrade (no proxy, no initialize, no admin)", [ "initialize", "upgradeTo", "adminCall" ].every((f) => bridgeBsc.interface.getFunction(f) === null));
        // Step 9 (BSC): the BEP-20 coins go to the bridge as liquidity (approve, then addLiquidity)
        await (await coin.approve(await bridge.getAddress(), units(1000))).wait();
        await (await bridgeBsc.addLiquidity(coinBsc, units(1000))).wait();
        t.check("step 9: BWSC on BSC added to the bridge as liquidity", (await bridgeBsc.getRoute(coinBsc)).held === units(1000));
        bsc = { wallet, coin, usd, bridge: bridgeBsc, address: (await bridge.getAddress()).toLowerCase(), chainId: BigInt(t.bsc.anvil.chainId) };
    } else {
        t.skip("steps 5–7 (BSC)", "anvil is not installed");
    }

    /* ------------------------------------ BWSC step 8: the bridge */

    const chainOnTest = bsc ? `${bsc.chainId}n` : "56n";
    const bridge = await deploy("BwscBridge", inputOf("8-BwscBridge.json", { YOUR_WALLET: me, SIGNER_ADDRESS: signer, BWSC_ON_BSC_ADDRESS: coinBsc, USDT_ON_BWSC_ADDRESS: usdt },
        { '"56n"': `"${chainOnTest}"`, [BSC_USD]: usdOnBsc }), { upgrader: me });
    const bv = await t.read(bridge, "getView", { account: "", offset: 0n, limit: 100n });
    const [ native, usdtRoute ] = bv.routes;
    t.check("step 8: routes BWSC ↔ BWSC (BEP-20) and USDT ↔ BSC-USD, to BSC", native.token === ZERO && native.remoteToken === coinBsc && usdtRoute.token === usdt && usdtRoute.remoteToken === usdOnBsc && bv.signer === signer && bv.owner === me);
    t.check("step 8: fees 0.10% and the smallest transfers (1 coin, 5 USDT)", native.feeBps === 10n && usdtRoute.feeBps === 10n && native.min === units(1) && usdtRoute.min === units(5));

    /* ------------------------------------ step 9: after deploying */

    // The pair BWSC / USDT, and its first liquidity (sets the price)
    await t.send(t.owner, dex, "createPair", { tokenA: ZERO, tokenB: usdt });
    await t.send(t.owner, usdt, "approve", { spender: dex, amount: units(850) });
    await t.send(t.owner, dex, "addLiquidity", { tokenA: ZERO, tokenB: usdt, amountA: units(1000), amountB: units(850), minShares: 0n }, { value: units(1000) });
    const pair = await t.read(dex, "getPair", { tokenA: ZERO, tokenB: usdt });
    t.check("step 9: pair BWSC / USDT with its first liquidity (held as wBWSC)", pair && pair.totalShares > 0n && (pair.tokenA === wbwsc || pair.tokenB === wbwsc));

    // Stake pools of every kind, and a reward
    await t.send(t.owner, staking, "createPool", { pool: "bwsc-usdt", stakeToken: ZERO, rewardToken: usdt });
    await t.send(t.owner, staking, "createPool", { pool: "usdt-usdt", stakeToken: usdt, rewardToken: usdt });
    await t.send(t.owner, usdt, "approve", { spender: staking, amount: units(300) });
    await t.send(t.owner, staking, "addReward", { pool: "usdt-usdt", amount: units(300), duration: 2_592_000n });
    const pools = (await t.read(staking, "getView", { account: "" })).pools;
    t.check("step 9: createPool from the guide makes both pools; 300 USDT over 30 days = 10 USDT a day", pools.map((p) => p.id).join() === "bwsc-usdt,usdt-usdt" && pools[1].rewardPerSecond * 86_400n >= units("9.99"));

    // Bridge liquidity on BWSC: USDT (approve + addLiquidity) and native coins (value)
    await t.send(t.owner, usdt, "approve", { spender: bridge, amount: units(1_000_000) });
    await t.send(t.owner, bridge, "addLiquidity", { token: usdt, amount: units(1_000_000) });
    await t.send(t.owner, bridge, "addLiquidity", { token: ZERO, amount: units(100) }, { value: units(100) });
    const coins = (await t.read(bridge, "getView", { account: "", offset: 0n, limit: 100n })).coins;
    t.check("step 9: USDT and native coins added to the BWSC bridge as liquidity", coins.find((c) => c.address === usdt).available === units(1_000_000) && coins.find((c) => c.address === ZERO).available === units(100));

    /* ------------------------------------ one trip: BSC-USD in, claimed as USDT on BWSC */

    if (bsc) {
        const nodeUrl = `http://127.0.0.1:${t.local.TEST_PORT}`;
        const s = createBridgeSigner({ ethers, createClient }, { key: devKey(4), hub: { nodeUrl, bridge }, chains: [ { key: "bsc", rpcUrl: t.bsc.anvil.url, bridge: bsc.address, confirmations: 0 } ] });
        await (await bsc.usd.approve(bsc.address, units(100))).wait();
        await (await bsc.bridge.bridgeIn(usdOnBsc, units(100))).wait();
        const c = await s.claim({ from: "bsc", to: "bwsc", account: bsc.wallet.address, token: usdOnBsc });
        const who = bsc.wallet.address.toLowerCase();
        const before = await t.read(usdt, "balanceOf", { who });
        await t.send(t.stranger, bridge, "claimIn", { chainId: bsc.chainId, account: c.account, token: c.token, total: BigInt(c.total), signature: c.signature });
        t.check("a first trip: 100 BSC-USD in → 99.9 USDT on BWSC, claimed by anyone", (await t.read(usdt, "balanceOf", { who })) - before === units("99.9"));
        s.stop();
    }
}
