/*
 * YOUR CODE (on-chain, local only). Sample data for the local test chain, plus helpers the tests reuse.
 * The programs are deployed by the engine from deploy-kit/settings/deploy.config.mjs; pairs and stake pools come from
 * deploy-kit/settings/test-setup.json (project/test-setup.mjs).
 *
 * deployed (from deploy-kit/engine/local-chain.mjs):
 *   deployed.addresses.BwscDex / WBWSC / USDT / BwscStaking / BwscBridge
 *   deployed.send(signer, key, method, input, { value })   deployed.read(key, method, input)
 *   deployed.owner / deployed.funder   signers (owner deployed everything and holds half of each token)
 */

import { utils } from "bwscbox";
import { personSigner } from "../engine/node.mjs";
import { setupPairs } from "./test-setup.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text, decimals = 18) => utils.toUnits(String(text), decimals);

/** approve exactly `amount` of `token` for the exchange (nothing for the native coin) */
async function approve(deployed, signer, token, amount) {
    if (token === ZERO) return null;
    return deployed.send(signer, token, "approve", { spender: deployed.addresses.BwscDex, amount });
}

/** Adds liquidity as `signer` to the pair of tokenA / tokenB (0x0…0 = native coin, sent as value) */
async function provide(deployed, signer, tokenA, tokenB, amountA, amountB) {
    await approve(deployed, signer, tokenA, amountA);
    await approve(deployed, signer, tokenB, amountB);
    const value = tokenA === ZERO ? amountA : tokenB === ZERO ? amountB : 0n;
    return deployed.send(signer, "BwscDex", "addLiquidity", { tokenA, tokenB, amountA, amountB, minShares: 0n }, { value });
}

/** Swaps `amountIn` along `path` as `signer` (minOut = quote less `slippageBps`, 1% by default) */
async function trade(deployed, signer, path, amountIn, { slippageBps = 100n } = {}) {
    const amounts = await deployed.read("BwscDex", "quote", { path, amountIn });
    await approve(deployed, signer, path[0], amountIn);
    const minOut = (amounts.at(-1) * (10_000n - slippageBps)) / 10_000n;
    return deployed.send(signer, "BwscDex", "swap", { path, amountIn, minOut }, { value: path[0] === ZERO ? amountIn : 0n });
}

/** Gives `people` USDT from the funder in one transaction (multiTransfer) */
async function handOut(deployed, people, amount) {
    await deployed.send(deployed.funder, deployed.addresses.USDT, "multiTransfer", { transfers: people.map((p) => ({ to: p.address, amount })) }, { gasLimit: 900_000 });
}

/**
 * Called by npm run dev and the app tests: the pairs of test-setup.json (with their first liquidity), then `count`
 * people (LOCAL_SEED in deploy-kit/settings/local.env) get USDT; each swaps once, every third one also adds liquidity.
 */
async function seed({ deployed, count, onProgress = () => {} }) {
    await setupPairs(deployed);
    const USDT = deployed.addresses.USDT;
    const people = Array.from({ length: count }, (_, n) => personSigner(n));
    if (people.length) await handOut(deployed, people, units(5_000));
    // People are different senders, so a few at a time share a block; their quotes may be a block old, hence 5% slippage
    let done = 0;
    for (let i = 0; i < people.length; i += 4) {
        await Promise.all(people.slice(i, i + 4).map(async (person, j) => {
            const n = i + j;
            if (n % 2 === 0) await trade(deployed, person, [ ZERO, USDT ], units(10 + (n % 5)), { slippageBps: 500n });
            else await trade(deployed, person, [ USDT, ZERO ], units(100 * (1 + (n % 4))), { slippageBps: 500n });
            if (n % 3 === 0) await provide(deployed, person, ZERO, USDT, units(20), units(17));
            onProgress(++done);
        }));
    }
}

/**
 * Bridge liquidity on both sides (lock and release: claims are paid from what the bridges hold).
 * BWSC: the owner adds native coins and USDT to BwscBridge. BSC (when running): the deployer adds the test tokens.
 * Amounts in whole coins.
 */
async function seedBridge({ deployed, bsc, native = 100_000, usdt = 10_000_000 }) {
    const ZERO = "0x0000000000000000000000000000000000000000";
    const BRIDGE = deployed.addresses.BwscBridge;
    await deployed.send(deployed.owner, "BwscBridge", "addLiquidity", { token: ZERO, amount: units(native, 18) }, { value: units(native, 18) });
    await deployed.send(deployed.owner, "USDT", "approve", { spender: BRIDGE, amount: units(usdt, 18) });
    await deployed.send(deployed.owner, "BwscBridge", "addLiquidity", { token: deployed.addresses.USDT, amount: units(usdt, 18) });
    if (!bsc) return;
    const { ethers } = await import("ethers");
    const owner = bsc.anvil.wallet(0);
    const bridge = new ethers.Contract(bsc.addresses.BwscBridgeEvm, bsc.contracts.BwscBridgeEvm.abi, owner);
    for (const [ symbol, amount ] of [ [ "tBWSC", native ], [ "USDT", usdt ] ]) {
        const token = new ethers.Contract(bsc.tokens[symbol].address, bsc.contracts.MockToken.abi, owner);
        const wei = ethers.parseUnits(String(amount), 18);
        await (await token.approve(bsc.addresses.BwscBridgeEvm, wei)).wait();
        await (await bridge.addLiquidity(bsc.tokens[symbol].address, wei)).wait();
    }
}

/** Extra lines printed when npm run dev is ready */
async function summary(deployed) {
    const view = await deployed.read("BwscDex", "getView", { account: "", offset: 0n, limit: 100n });
    const sym = (a) => view.tokens.find((t) => t.address === a)?.symbol ?? a;
    return view.pairs.map((p) => `  ${"Pair".padEnd(26)} ${utils.formNumber(utils.fromUnits(p.reserveA, 18), 2)} ${sym(p.tokenA)} / ${utils.formNumber(utils.fromUnits(p.reserveB, 18), 2)} ${sym(p.tokenB)}, fee ${Number(p.feeBps) / 100}%`);
}

export { approve, provide, trade, handOut, seed, seedBridge, summary };
