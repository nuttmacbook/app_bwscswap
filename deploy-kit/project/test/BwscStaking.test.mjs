/*
 * YOUR CODE (on-chain, tests). BwscStaking on the real node: phase 1 (createPool), phase 2 (addReward streams that add
 * up, any time, never withdrawable), sharing by stake size, unallocated seconds, restream, stream ends.
 * The node has no time travel, so streams here last a minute or two and the test waits real seconds. Expected numbers
 * come from the pool's own clock (lastUpdate, in seconds) after each transaction. Rounding may lose a unit or two.
 */

import { utils } from "bwscbox";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text) => utils.toUnits(String(text), 18);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tolerance = 5n) => (a > b ? a - b : b - a) <= tolerance;
const show = (x) => utils.fromUnits(x, 18);

// What a transaction paid for gas (the receipt's fee), so balance checks are exact whatever the node's base fee is
const feeOf = (receipt) => BigInt(String(receipt?.fee ?? 0).replace(/n$/, ""));

export default async function (t) {
    const { deployed } = t;
    const STAKING = deployed.addresses.BwscStaking;
    const USDT = deployed.addresses.USDT;
    const view = (account = "") => t.read("BwscStaking", "getView", { account });
    const pool = async (id, account = "") => (await view(account)).pools.find((p) => p.id === id);
    const usdt = (who) => t.read("USDT", "balanceOf", { who });
    const approve = (who, amount) => t.send(who, "USDT", "approve", { spender: STAKING, amount });
    const create = (id, stakeToken = USDT, rewardToken = USDT, who = t.owner) => t.send(who, "BwscStaking", "createPool", { pool: id, stakeToken, rewardToken });
    const addReward = async (id, amount, seconds, { token = USDT, who = t.owner } = {}) => {
        if (token === USDT) await approve(who, amount);
        return t.send(who, "BwscStaking", "addReward", { pool: id, amount, duration: BigInt(seconds) }, { value: token === ZERO ? amount : 0n });
    };
    const stake = async (who, id, amount, token = USDT) => {
        if (token === USDT) await approve(who, amount);
        return t.send(who, "BwscStaking", "stake", { pool: id, amount }, { value: token === ZERO ? amount : 0n });
    };
    const claim = (who, id) => t.send(who, "BwscStaking", "claim", { pool: id });
    const countersOk = async () => {
        const v = await view();
        return v.counters.every((c) => c.staked + c.rewardHeld === c.held || (c.token === ZERO && c.held >= c.staked + c.rewardHeld));
    };

    /* ------------------------------------ setup */

    let v = await view();
    t.check("owner comes from deploy.config, starts with no pools", v.owner === t.owner.address && v.pools.length === 0 && !v.paused);
    const names = ((await t.client.program(STAKING))?.metadata?.abi?.functions ?? []).map((f) => f.name);
    t.check("the owner has no function that takes reward out", names.includes("addReward") && !names.some((n) => /withdraw|remove|leftover|rescue/i.test(n)), names.join(", "));

    const alice = t.newWallet();
    const bob = t.newWallet();
    for (const who of [ alice, bob ]) await t.send(t.owner, "USDT", "transfer", { to: who.address, amount: units(10_000) });

    /* ------------------------------------ phase 1: createPool */

    t.check("only the owner can create a pool", await t.doesRevert(() => create("x", USDT, USDT, t.stranger), "Only the owner"));
    t.check("a pool name with other characters is refused", await t.doesRevert(() => create("Bad Name"), "a-z, 0-9"));
    let r = await create("usdt-a");
    t.gas("createPool", r);
    let p = await pool("usdt-a");
    t.check("phase 1: a new pool has its tokens and no reward yet", p.status === "new" && p.rewardPerSecond === 0n && p.funded === 0n && p.stake.address === USDT && p.reward.address === USDT);
    t.check("a second pool with the same name is refused", await t.doesRevert(() => create("usdt-a"), "already exists"));
    await stake(alice, "usdt-a", units(100));
    await wait(1200);
    t.check("people may stake before any reward; they earn nothing yet", (await t.read("BwscStaking", "pendingOf", { pool: "usdt-a", account: alice.address })) === 0n);

    /* ------------------------------------ phase 2: addReward streams */

    t.check("only the owner can add reward", await t.doesRevert(() => addReward("usdt-a", units(10), 60, { who: t.stranger }), "Only the owner"));
    t.check("a stream shorter than a minute is refused", await t.doesRevert(() => addReward("usdt-a", units(10), 59), "duration"));
    const o0 = await usdt(t.owner.address);
    r = await addReward("usdt-a", units(600), 60);
    t.gas("addReward", r);
    p = await pool("usdt-a");
    t.check("addReward 600 over 60 s: pulled now, 10 USDT per second, ends in 60 s", o0 - (await usdt(t.owner.address)) === units(600) && p.funded === units(600) && p.rewardPerSecond === units(10) && r.result.rate === units(10) && p.status === "live");
    const s1 = p.lastUpdate;
    await wait(3200);
    const a0 = await usdt(alice.address);
    r = await claim(alice, "usdt-a");
    t.gas("claim", r);
    const s2 = (await pool("usdt-a")).lastUpdate;
    t.check("alone in the pool: alice gets 10 USDT × seconds since the reward started", near(r.result, units(10) * (s2 - s1)) && (await usdt(alice.address)) - a0 === r.result, `${show(r.result)} for ${s2 - s1}s`);

    // A second top-up while the first runs: rates add up
    r = await addReward("usdt-a", units(240), 120);
    p = await pool("usdt-a");
    t.check("a second top-up (240 over 120 s) adds 2/s: 12 USDT per second while both run", p.rewardPerSecond === units(12) && p.funded === units(840) && p.streams === 2n);
    t.check("…the next change is when the first stream ends", p.nextChangeAt < p.rewardEndsAt);
    const s3 = p.lastUpdate;
    await stake(bob, "usdt-a", units(300));
    const s4 = (await pool("usdt-a")).lastUpdate;
    await wait(3200);
    const ra = await claim(alice, "usdt-a");
    const s5 = (await pool("usdt-a")).lastUpdate;
    const rb = await claim(bob, "usdt-a");
    const s6 = (await pool("usdt-a")).lastUpdate;
    const expectA = units(10) * (s3 - s2) + units(12) * (s4 - s3) + (units(12) * (s5 - s4)) / 4n;
    const expectB = (units(12) * (s6 - s4) * 3n) / 4n;
    t.check("alice: 10/s alone, 12/s alone after the top-up, then ¼ once bob joined", near(ra.result, expectA, 20n), `${show(ra.result)} vs ${show(expectA)}`);
    t.check("bob (300 of 400) gets ¾ of 12/s", near(rb.result, expectB, 20n), `${show(rb.result)} vs ${show(expectB)}`);

    // Unstake gives the stake back exactly
    const b0 = await usdt(bob.address);
    r = await t.send(bob, "BwscStaking", "unstake", { pool: "usdt-a", amount: units(100) });
    t.gas("unstake", r);
    t.check("unstake 100: bob gets exactly 100 back, 200 still staked", (await usdt(bob.address)) - b0 === units(100) && r.result === units(200));
    t.check("unstaking more than staked is refused", await t.doesRevert(() => t.send(bob, "BwscStaking", "unstake", { pool: "usdt-a", amount: units(201) }), "more than you staked"));
    t.check("USDT: staked + reward money = what the program holds", await countersOk());

    /* ------------------------------------ nobody staked → unallocated → restream */

    await create("empty");
    await addReward("empty", units(120), 60);
    const e1 = (await pool("empty")).lastUpdate;
    await wait(2200);
    await stake(alice, "empty", units(10));
    p = await pool("empty");
    t.check("seconds nobody was staked go to unallocated (2/s × seconds)", near(p.unallocated, units(2) * (p.lastUpdate - e1)), `${show(p.unallocated)}`);
    t.check("restream more than unallocated is refused", await t.doesRevert(() => t.send(t.owner, "BwscStaking", "restream", { pool: "empty", amount: p.unallocated + 1n, duration: 60n }), "More than the unallocated"));
    const fundedBefore = p.funded;
    r = await t.send(t.owner, "BwscStaking", "restream", { pool: "empty", amount: units(1), duration: 60n });
    const pe = await pool("empty");
    t.check("restream puts it back to work: rate goes up, nothing new paid in, nothing taken out", pe.funded === fundedBefore && pe.rewardPerSecond > units(2) && pe.unallocated < p.unallocated);
    t.check("only the owner can restream", await t.doesRevert(() => t.send(t.stranger, "BwscStaking", "restream", { pool: "empty", amount: 1n, duration: 60n }), "Only the owner"));

    /* ------------------------------------ native coin stake, and a native coin reward */

    await create("native-a", ZERO, USDT);
    t.check("native stake: value must equal the amount", await t.doesRevert(() => t.send(alice, "BwscStaking", "stake", { pool: "native-a", amount: units(5) }, { value: units(4) }), "exactly"));
    await stake(alice, "native-a", units(5), ZERO);
    await create("coin-reward", USDT, ZERO);
    t.check("a native coin reward must come as value", await t.doesRevert(() => t.send(t.owner, "BwscStaking", "addReward", { pool: "coin-reward", amount: units(60), duration: 60n }), "exactly"));
    await addReward("coin-reward", units(60), 60, { token: ZERO });
    t.check("…and with value it streams (1 coin per second)", (await pool("coin-reward")).rewardPerSecond === units(1));
    const n0 = await t.balance(alice.address);
    const u = await t.send(alice, "BwscStaking", "unstake", { pool: "native-a", amount: units(5) });
    t.check("native unstake: the 5 coins come back (minus gas)", (await t.balance(alice.address)) - n0 === units(5) - feeOf(u));

    /* ------------------------------------ a stream ends; the next top-up starts again */

    await create("short");
    await stake(alice, "short", units(10));
    r = await addReward("short", units(60), 60);
    const start = (await pool("short")).lastUpdate;
    await wait(63_000);
    p = await pool("short", alice.address);
    t.check("after its 60 s the stream stops: rate 0, status idle", p.rewardPerSecond === 0n && p.status === "idle" && p.scheduled === 0n);
    t.check("…and the whole 60 USDT was earned (alice was alone all the time)", near(p.myPending, units(60), 10n), show(p.myPending));
    const late = await claim(alice, "short");
    t.check("claiming after the end pays it", near(late.result, units(60), 10n));
    await addReward("short", units(30), 60);
    t.check("a new top-up later starts the pool again (0.5/s)", (await pool("short")).rewardPerSecond === units("0.5"));
    void start;

    /* ------------------------------------ every mix of coins, and many pools */

    t.check("pools of every kind: native → token, token → token, token → native", ((await pool("native-a")).stake.isNative && !(await pool("native-a")).reward.isNative)
        && !(await pool("usdt-a")).stake.isNative && (await pool("coin-reward")).reward.isNative && !(await pool("coin-reward")).stake.isNative);
    await create("native-native", ZERO, ZERO);
    t.check("…and native → native", (await pool("native-native")).stake.isNative && (await pool("native-native")).reward.isNative);
    const all = await t.read("BwscStaking", "getView", { account: "", offset: 0n, limit: 100n });
    const page2 = await t.read("BwscStaking", "getView", { account: "", offset: 2n, limit: 2n });
    t.check("getView reads pools in pages (offset 2, limit 2 = the 3rd and 4th pool)", page2.pools.length === 2 && page2.pools[0].id === all.pools[2].id && page2.pools[1].id === all.pools[3].id && page2.poolCount === all.poolCount);
    t.check("each token is read once per page (counters list each coin once)", all.counters.length === new Set(all.counters.map((c) => c.token)).size);

    /* ------------------------------------ pause and owner */

    await t.send(t.owner, "BwscStaking", "setPaused", { paused: true });
    t.check("paused: no new stakes", await t.doesRevert(() => stake(alice, "usdt-a", units(1)), "paused"));
    t.check("paused: unstake still works", !(await t.doesRevert(() => t.send(alice, "BwscStaking", "unstake", { pool: "usdt-a", amount: units(1) }))));
    t.check("paused: claim still works", !(await t.doesRevert(() => claim(alice, "usdt-a"))));
    t.check("paused: the owner can still add reward", !(await t.doesRevert(() => addReward("usdt-a", units(10), 60))));
    await t.send(t.owner, "BwscStaking", "setPaused", { paused: false });

    v = await view();
    t.check("at the end: every token's counters equal the program's balance", await countersOk());
    t.check("paid out never exceeds what the streams gave out", v.pools.every((x) => x.paid <= x.distributed));
    await t.send(t.owner, "BwscStaking", "transferOwnership", { owner: alice.address });
    t.check("transferOwnership: the old owner cannot add reward", await t.doesRevert(() => addReward("usdt-a", units(1), 60), "Only the owner"));
}
