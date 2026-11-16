/*
 * YOUR CODE (on-chain, tests). BwscStaking with rewards added in pieces (different amounts, different lengths) and
 * people who stake, claim and take out at different times: alice claims every 10 s, bob only at the end, carol joins
 * late, and the first seconds nobody is staked. Every amount the program pays is compared with an independent exact
 * calculation from the block times (prints the timeline and a who-got-what table). Takes about 2.5 minutes.
 */
import { utils } from "bwscbox";

const units = (x) => utils.toUnits(String(x), 18);
const show = (v) => utils.fromUnits(v, 18).replace(/(\.\d{4})\d+$/, "$1");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
    const STAKING = t.deployed.addresses.BwscStaking;
    const USDT = t.deployed.addresses.USDT;
    const POOL = "scenario";
    const [ alice, bob, carol ] = [ t.newWallet(), t.newWallet(), t.newWallet() ];
    for (const w of [ alice, bob, carol ]) {
        await t.send(t.owner, USDT, "transfer", { to: w.address, amount: units(1000) });
        await t.send(w, USDT, "approve", { spender: STAKING, amount: units(1000) });
    }
    await t.send(t.owner, USDT, "approve", { spender: STAKING, amount: units(10_000) });
    await t.send(t.owner, STAKING, "createPool", { pool: POOL, stakeToken: USDT, rewardToken: USDT });

    // The timeline as it really happened (block seconds), for the independent calculation
    const events = [];
    const at = (r) => BigInt(Math.floor(Number(r.timestamp) / 1000));
    const log = [];
    let t0 = null;
    const note = (r, text) => { const s = at(r); if (t0 === null) t0 = s; log.push(`t=${String(s - t0).padStart(3)}s  ${text}`); return s; };
    const paid = { alice: 0n, bob: 0n, carol: 0n };
    const who = (w) => (w === alice ? "alice" : w === bob ? "bob" : "carol");

    const reward = async (amount, duration, label) => {
        const r = await t.send(t.owner, STAKING, "addReward", { pool: POOL, amount: units(amount), duration: BigInt(duration) });
        events.push({ t: note(r, `owner adds ${label}: ${amount} USDT over ${duration}s (${amount / duration}/s)`), kind: "stream", amount: units(amount), duration: BigInt(duration) });
    };
    const stake = async (w, amount) => {
        const r = await t.send(w, STAKING, "stake", { pool: POOL, amount: units(amount) });
        events.push({ t: note(r, `${who(w)} stakes ${amount}`), kind: "stake", who: who(w), amount: units(amount) });
    };
    const unstake = async (w, amount) => {
        const r = await t.send(w, STAKING, "unstake", { pool: POOL, amount: units(amount) });
        events.push({ t: note(r, `${who(w)} takes out ${amount} (rewards stay owed)`), kind: "unstake", who: who(w), amount: units(amount) });
    };
    const claim = async (w, quiet = false) => {
        const r = await t.send(w, STAKING, "claim", { pool: POOL });
        paid[who(w)] += r.result;
        const s = at(r);
        events.push({ t: s, kind: "claim", who: who(w), got: r.result });
        if (!quiet) note(r, `${who(w)} claims ${show(r.result)}`);
        return r.result;
    };

    // ---------------- the story
    await reward(600, 60, "stream A");                 // nobody staked yet: these seconds go to "unallocated"
    await wait(5000);
    await stake(alice, 100);
    let aliceClaims = 0;
    const aliceDaily = async () => { await claim(alice, true); aliceClaims += 1; };
    await wait(10000); await aliceDaily();
    await stake(bob, 300);                             // alice now has 1/4, bob 3/4
    await wait(10000); await aliceDaily();
    await reward(330, 110, "stream B");                // runs on top of A: 10 + 3 = 13/s until A ends
    await wait(10000); await aliceDaily();
    await wait(10000); await aliceDaily();
    await wait(12000); await aliceDaily();             // A has ended by now: only B (3/s)
    await stake(carol, 100);                           // carol joins late: alice 100, bob 300, carol 100
    await wait(10000); await aliceDaily();
    await unstake(bob, 150);                           // bob: 150 left (the rewards he earned stay owed)
    for (let i = 0; i < 6; i++) { await wait(10000); await aliceDaily(); }
    await wait(20000);                                 // B has ended
    for (const w of [ alice, bob, carol ]) await claim(w);
    log.push(`(alice also claimed ${aliceClaims} times along the way, about every 10 s)`);

    // ---------------- independent exact calculation from the same block times
    const SCALE = 10n ** 36n;
    const streams = [];        // { start, end, rate }
    const stakeOf = { alice: 0n, bob: 0n, carol: 0n };
    const earned = { alice: 0n, bob: 0n, carol: 0n };   // × SCALE
    let unallocated = 0n;
    let last = events[0].t;
    const rateAt = (from, to) => streams.reduce((s, x) => s + x.rate * (Math.min(Number(to), Number(x.end)) > Math.max(Number(from), Number(x.start)) ? BigInt(Math.min(Number(to), Number(x.end)) - Math.max(Number(from), Number(x.start))) : 0n), 0n);
    const advance = (now) => {
        if (now <= last) return;
        const reward = rateAt(last, now);
        const total = stakeOf.alice + stakeOf.bob + stakeOf.carol;
        if (total === 0n) unallocated += reward;
        else for (const k of Object.keys(earned)) earned[k] += (reward * stakeOf[k] * SCALE) / total;
        last = now;
    };
    for (const e of events) {
        advance(e.t);
        if (e.kind === "stream") { const rate = e.amount / e.duration; streams.push({ start: e.t, end: e.t + e.duration, rate }); unallocated += e.amount - rate * e.duration; }
        if (e.kind === "stake") stakeOf[e.who] += e.amount;
        if (e.kind === "unstake") stakeOf[e.who] -= e.amount;
    }
    advance(events.at(-1).t);

    // ---------------- compare
    console.log("\n  TIMELINE (block seconds)");
    log.forEach((l) => console.log(`    ${l}`));
    console.log("\n  WHO GOT WHAT                 program paid        exact calculation   difference (wei)");
    for (const k of Object.keys(paid)) {
        const want = earned[k] / SCALE;
        console.log(`    ${k.padEnd(8)} ${show(paid[k]).padStart(28)} ${show(want).padStart(20)}   ${String(paid[k] - want).padStart(8)}`);
        t.check(`${k}: paid what the timeline says (within rounding)`, paid[k] <= want && want - paid[k] < 10n ** 6n, `${paid[k]} vs ${want}`);
    }
    const view = (await t.read("BwscStaking", "getView", { account: "", offset: 0n, limit: 100n })).pools.find((p) => p.id === POOL);
    const totalPaid = paid.alice + paid.bob + paid.carol;
    console.log(`\n    owner put in      ${show(view.funded)} USDT (600 + 330)`);
    console.log(`    paid to people    ${show(totalPaid)}`);
    console.log(`    unallocated       ${show(view.unallocated)}  (seconds before anyone staked + rounding; exact calc: ${show(unallocated)})`);
    t.check("nothing lost: paid + unallocated + rounding dust = what the owner put in", view.funded - totalPaid - view.unallocated >= 0n && view.funded - totalPaid - view.unallocated < 10n ** 6n);
    t.check("unallocated = the 5 s before alice staked (10/s) + rounding", view.unallocated >= unallocated - 10n ** 6n && view.unallocated <= unallocated + 10n ** 6n, `${view.unallocated} vs ${unallocated}`);
}
