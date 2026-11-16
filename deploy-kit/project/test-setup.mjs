/*
 * TEST CHAIN ONLY. Pairs and stake pools from deploy-kit/settings/test-setup.json, on the local chain:
 * exactly what you do by hand on your real chain (deploy-kit/README.md step 9), done by script.
 */

import fs from "node:fs";
import path from "node:path";
import { utils } from "bwscbox";

const ZERO = "0x0000000000000000000000000000000000000000";
const SETUP = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../settings/test-setup.json"), "utf8"));

/** "native" → 0x0…0, otherwise the deployed program's address */
function addressOf(deployed, name) {
    if (name === "native") return ZERO;
    const a = deployed.addresses[name];
    if (!a) throw new Error(`test-setup.json: ${name} was not deployed (a key of deploy.config.mjs, or "native").`);
    return a;
}
const units = (n) => utils.toUnits(String(n), 18);

/** approve (a token) and the value (the native coin) for `amount` going to `spender` */
async function pay(deployed, signer, token, spender, amount) {
    if (token !== ZERO) await deployed.send(signer, token, "approve", { spender, amount });
    return token === ZERO ? amount : 0n;
}

/** Pairs: created when missing; the owner gives each empty pair its first liquidity (that sets its price) */
async function setupPairs(deployed) {
    const dex = deployed.addresses.BwscDex;
    if (!dex) return [];
    const made = [];
    for (const p of SETUP.pairs) {
        const a = addressOf(deployed, p.tokenA);
        const b = addressOf(deployed, p.tokenB);
        let pair = await deployed.read("BwscDex", "getPair", { tokenA: a, tokenB: b });
        if (!pair) {
            await deployed.send(deployed.owner, "BwscDex", "createPair", { tokenA: a, tokenB: b });
            pair = await deployed.read("BwscDex", "getPair", { tokenA: a, tokenB: b });
        }
        if (pair.totalShares === 0n) {
            const value = (await pay(deployed, deployed.owner, a, dex, units(p.amountA))) + (await pay(deployed, deployed.owner, b, dex, units(p.amountB)));
            await deployed.send(deployed.owner, "BwscDex", "addLiquidity", { tokenA: a, tokenB: b, amountA: units(p.amountA), amountB: units(p.amountB), minShares: 0n }, { value });
        }
        made.push(`${p.tokenA}/${p.tokenB}`);
    }
    return made;
}

/** Stake pools: created when missing, each with one reward stream (LOCAL_STAKE_REWARD over LOCAL_STAKE_DAYS) */
async function setupPools(deployed, local) {
    const staking = deployed.addresses.BwscStaking;
    if (!staking) return [];
    const have = new Set((await deployed.read("BwscStaking", "getView", { account: "" })).pools.map((p) => p.id));
    const made = [];
    for (const p of SETUP.stakePools) {
        if (have.has(p.id)) continue;
        const reward = addressOf(deployed, p.reward);
        await deployed.send(deployed.owner, "BwscStaking", "createPool", { pool: p.id, stakeToken: addressOf(deployed, p.stake), rewardToken: reward });
        const amount = units(local.LOCAL_STAKE_REWARD);
        const value = await pay(deployed, deployed.owner, reward, staking, amount);
        await deployed.send(deployed.owner, "BwscStaking", "addReward", { pool: p.id, amount, duration: BigInt(Number(local.LOCAL_STAKE_DAYS) * 86_400) }, { value });
        made.push(p.id);
    }
    return made;
}

/** Limit orders: the owner places each one of test-setup.json (once: only when the program has no orders yet) */
async function setupLimitOrders(deployed) {
    const limit = deployed.addresses.BwscLimit;
    if (!limit || !SETUP.limitOrders?.length) return 0;
    const view = await deployed.read("BwscLimit", "getView", { account: "", offset: 0n, limit: 1n });
    if (view.orderCount > 0n) return Number(view.orderCount);
    // wBWSC for the owner first (the native coin wrapped), when an order gives it
    const wrapped = SETUP.limitOrders.filter((o) => o.give === "WBWSC").reduce((s, o) => s + units(o.giveAmount), 0n);
    if (wrapped > 0n && deployed.addresses.WBWSC) await deployed.send(deployed.owner, "WBWSC", "deposit", {}, { value: wrapped });
    for (const o of SETUP.limitOrders) {
        const give = addressOf(deployed, o.give);
        const giveAmount = units(o.giveAmount);
        const value = await pay(deployed, deployed.owner, give, limit, giveAmount);
        await deployed.send(deployed.owner, "BwscLimit", "placeOrder", { give, giveAmount, want: addressOf(deployed, o.want), wantAmount: units(o.wantAmount), partial: o.partial !== false, expiresAt: 0n }, { value });
    }
    return SETUP.limitOrders.length;
}

export { setupPairs, setupPools, setupLimitOrders, addressOf, SETUP };
