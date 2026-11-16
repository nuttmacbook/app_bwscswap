/*
 * YOUR CODE (on-chain). Staking: one read for the whole page, the people's actions (stake / take out / claim) and
 * the owner's phase 2 (addReward: pay in, streamed over the days the owner picks; never withdrawable).
 * Pools live on chain (createPool, by the owner: any mix of the native coin and tokens). Names come from
 * settings/config.js; prices for APR come from the exchange's pools (chain/prices.js), never typed in.
 * Pools are read 100 at a time. "Earned" ticks on screen from the read (pendingAt).
 */

import { box } from "../../engine/chain/connect";
import { cachedRead, invalidateReads } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { normalize } from "../../engine/chain/txError";
import { approveIfNeeded } from "../../engine/chain/token";
import { ZERO } from "../../engine/settings";
import { StakingProgram } from "./programs";
import { HUB, coinOf } from "./coins";
import { getDexData } from "./dex";
import { priceBook, sameCoin } from "./prices";

const DAY = 86_400n;
const GAS_RESERVE = 10n ** 16n;   // 0.01 native coin kept for gas when staking the native coin

const staking = () => metered(box.createReader(StakingProgram), "BwscStaking");

const PAGE = 100n;

/** A coin of the view with the page's names and price (settings/config.js) */
const tokenOf = (raw) => coinOf(HUB, { address: raw.address, symbol: raw.symbol, decimals: Number(raw.decimals), balance: raw.balance, allowance: raw.allowance });

/**
 * APR in basis points, or null when it cannot be known (nothing staked, no reward flowing, or a coin with no price).
 * Same coin staked and paid: a plain ratio, no price needed. Otherwise both prices come from the pools.
 */
function aprBps(p, book, dexData) {
    if (p.status !== "live" || !(p.totalStaked > 0n) || !(p.rewardPerSecond > 0n)) return null;
    const yearly = p.rewardPerSecond * 365n * DAY;
    if (sameCoin(dexData, p.stake.address, p.reward.address)) return Number((yearly * 10_000n) / p.totalStaked);
    const ps = book.of(p.stake.address);
    const pr = book.of(p.reward.address);
    if (!ps || !pr) return null;
    const stakedValue = (p.totalStaked * ps) / 10n ** BigInt(p.stake.decimals);
    const yearlyValue = (yearly * pr) / 10n ** BigInt(p.reward.decimals);
    return stakedValue > 0n ? Number((yearlyValue * 10_000n) / stakedValue) : null;
}

/**
 * The stake page's data: one read of the pools, one of the exchange (prices for APR). Pools in on-chain order.
 * @returns {{ wallet, isConnected, isReady, isOwner, now, paused, pools: Array<{ id, stake, reward, status ("new" | "live" | "idle"),
 *            totalStaked, rewardPerSecond, rewardPerDay, aprBps, nextChangeAt, rewardEndsAt, scheduled, funded, unallocated,
 *            myStake, myPending, walletBalance, gasReserve }> }}
 */
async function getStakeData(wallet, { fresh = false } = {}) {
    const base = { wallet, isConnected: Boolean(wallet?.address) };
    if (StakingProgram.address === ZERO) return { ...base, isReady: false, pools: [], now: Math.floor(Date.now() / 1000) };
    const who = String(wallet?.address ?? "").toLowerCase();
    const views = [];
    for (let offset = 0n; ; offset += PAGE) {
        const v = await cachedRead(`stake:${who}:${offset}`, () => staking().methods.getView({ account: who, offset: `${offset}n`, limit: `${PAGE}n` }).call(), { fresh });
        views.push(v);
        if (offset + PAGE >= BigInt(v.poolCount ?? 0)) break;
    }
    // Prices for APR from the pools (the exchange missing or not answering only means "no price": APR shows "—")
    const dexData = await getDexData(wallet, { fresh }).catch(() => null);
    const book = priceBook(dexData);
    const raw = views[0];
    const pools = views.flatMap((v) => v.pools).map((p) => {
        const stake = tokenOf(p.stake);
        const reward = tokenOf(p.reward);
        const pool = {
            id: p.id, stake, reward, status: p.status,
            totalStaked: p.totalStaked, rewardPerSecond: p.rewardPerSecond, rewardPerDay: p.rewardPerSecond * DAY,
            nextChangeAt: Number(p.nextChangeAt), rewardEndsAt: Number(p.rewardEndsAt),
            scheduled: p.scheduled, funded: p.funded, unallocated: p.unallocated, paid: p.paid, streams: Number(p.streams),
            myStake: p.myStake, myPending: p.myPending,
            walletBalance: stake.balance, gasReserve: stake.isNative ? GAS_RESERVE : 0n,
        };
        return { ...pool, aprBps: aprBps(pool, book, dexData) };
    });
    return { ...base, priceUnit: book.unit?.symbol ?? null, isReady: true, isOwner: Boolean(who) && who === raw.owner, owner: raw.owner, now: Number(raw.now), paused: raw.paused, pools };
}

/** My reward at `at` (seconds) from a pool as getStakeData returned it, for the ticking number (no extra read) */
function pendingAt(pool, at, viewNow) {
    if (pool?.status !== "live" || !(pool.myStake > 0n) || !(pool.totalStaked > 0n)) return pool?.myPending ?? 0n;
    // The rate holds until the next stream ends (the page reads again after that)
    const until = pool.nextChangeAt > 0 ? Math.min(at, pool.nextChangeAt) : at;
    const seconds = BigInt(Math.max(0, until - viewNow));
    return pool.myPending + (pool.rewardPerSecond * seconds * pool.myStake) / pool.totalStaked;
}

/**
 * Stake (approve exactly the amount first for a token; the native coin goes as value) or take stake out.
 * @param {object} order  { poolId, mode: "stake" | "unstake", amount }
 */
async function stakeTokens(wallet, { poolId, mode, amount }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getStakeData(wallet, { fresh: true });
    const p = data.pools.find((x) => x.id === poolId);
    if (!p) throw new Error("That pool does not exist.");
    if (!(amount > 0n)) throw new Error(mode === "stake" ? "Enter an amount to stake." : "Enter an amount to take out.");
    const program = box.createProgram(StakingProgram, wallet.signer);
    const SENT = { stake: "staking", unstake: "unstaking" };
    const send = async (stage, total, call) => {
        onStep({ stage, index: total, total });
        try {
            const tx = await call();
            onStep({ stage: SENT[stage], index: total, total });
            const receipt = await tx.wait();
            invalidateReads();
            return receipt;
        } catch (error) {
            throw normalize(error, box.handleTxError(StakingProgram, error), mode === "stake" ? "The stake did not go through." : "Taking out did not go through.");
        }
    };
    if (mode === "unstake") {
        if (amount > p.myStake) throw new Error("That is more than you staked.");
        return send("unstake", 1, () => program.unstake({ pool: poolId, amount: `${amount}n` }));
    }
    if (data.paused) throw new Error("Staking is paused by its owner. Taking out and claiming still work.");
    if (amount > p.walletBalance) throw new Error(`Not enough ${p.stake.symbol} in your wallet.`);
    if (amount > p.walletBalance - p.gasReserve) throw new Error(`Keep some ${p.stake.symbol} for gas.`);
    const needsApprove = !p.stake.isNative && p.stake.allowance < amount;
    const total = needsApprove ? 2 : 1;
    if (needsApprove) await approveIfNeeded({ wallet, token: p.stake.address, spender: StakingProgram.address, amount, allowance: p.stake.allowance, onStep, index: 1, total });
    return send("stake", total, () => program.stake({ pool: poolId, amount: `${amount}n` }, p.stake.isNative ? { value: String(amount) } : {}));
}

/** Claims the rewards earned so far in one pool */
async function claimStake(wallet, { poolId }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getStakeData(wallet, { fresh: true });
    const p = data.pools.find((x) => x.id === poolId);
    if (!p) throw new Error("That pool does not exist.");
    if (!(p.myPending > 0n)) throw new Error("No reward to claim yet.");
    onStep({ stage: "claim", index: 1, total: 1 });
    try {
        const tx = await box.createProgram(StakingProgram, wallet.signer).claim({ pool: poolId });
        onStep({ stage: "claiming", index: 1, total: 1 });
        const receipt = await tx.wait();
        invalidateReads();
        return receipt;
    } catch (error) {
        throw normalize(error, box.handleTxError(StakingProgram, error), "The claim did not go through.");
    }
}

/**
 * Owner, phase 2: pays `amount` of the pool's reward token in now and streams it out over `days`.
 * The money can never be taken back out (the program has no such function).
 */
async function addStakeReward(wallet, { poolId, amount, days }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getStakeData(wallet, { fresh: true });
    if (!data.isOwner) throw new Error("Only the owner of the staking program can add reward.");
    const p = data.pools.find((x) => x.id === poolId);
    if (!p) throw new Error("That pool does not exist.");
    const seconds = BigInt(Math.round(Number(days) * 86_400));
    if (!(seconds >= 60n)) throw new Error("Stream it over at least a minute.");
    if (!(amount > 0n)) throw new Error("Enter an amount of reward.");
    if (amount > p.reward.balance) throw new Error(`Not enough ${p.reward.symbol} in your wallet.`);
    if (amount / seconds === 0n) throw new Error("The amount is too small for that many days.");
    const needsApprove = !p.reward.isNative && p.reward.allowance < amount;
    const total = needsApprove ? 2 : 1;
    if (needsApprove) await approveIfNeeded({ wallet, token: p.reward.address, spender: StakingProgram.address, amount, allowance: p.reward.allowance, onStep, index: 1, total });
    onStep({ stage: "reward", index: total, total });
    try {
        const tx = await box.createProgram(StakingProgram, wallet.signer).addReward({ pool: poolId, amount: `${amount}n`, duration: `${seconds}n` }, p.reward.isNative ? { value: String(amount) } : {});
        onStep({ stage: "rewarding", index: total, total });
        const receipt = await tx.wait();
        invalidateReads();
        return receipt;
    } catch (error) {
        throw normalize(error, box.handleTxError(StakingProgram, error), "The reward was not added.");
    }
}

/**
 * Owner, phase 1: a new pool. stakeToken / rewardToken: token addresses, or 0x0…0 for the native coin (any mix).
 * The pool name is its id on chain: a-z, 0-9 and "-", e.g. "bwsc-usdt".
 */
async function createStakePool(wallet, { poolId, stakeToken, rewardToken }, { onStep = () => {} } = {}) {
    if (!wallet?.address || !wallet?.signer) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getStakeData(wallet, { fresh: true });
    if (!data.isOwner) throw new Error("Only the owner of the staking program can create pools.");
    const id = String(poolId ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error("Name the pool with a-z, 0-9 and - (up to 40 characters), e.g. bwsc-usdt.");
    if (data.pools.some((p) => p.id === id)) throw new Error(`A pool named ${id} already exists.`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(stakeToken)) || !/^0x[0-9a-fA-F]{40}$/.test(String(rewardToken))) throw new Error("Pick the stake coin and the reward coin.");
    onStep({ stage: "pool", index: 1, total: 1 });
    try {
        const tx = await box.createProgram(StakingProgram, wallet.signer).createPool({ pool: id, stakeToken: stakeToken.toLowerCase(), rewardToken: rewardToken.toLowerCase() });
        onStep({ stage: "pooling", index: 1, total: 1 });
        const receipt = await tx.wait();
        invalidateReads();
        return receipt;
    } catch (error) {
        throw normalize(error, box.handleTxError(StakingProgram, error), "The pool was not created.");
    }
}

export { getStakeData, pendingAt, stakeTokens, claimStake, addStakeReward, createStakePool };
