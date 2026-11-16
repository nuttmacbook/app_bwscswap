/*
 * YOUR CODE (app tests). The stake page on the real BwscStaking program: the test chain's pools
 * (deploy-kit/settings/test-setup.json: native → USDT, USDT → USDT, USDT → native), search and filters,
 * stake / rewards ticking / claim / take out with the demo wallet, native coin stake keeps gas,
 * and the owner creating a pool (phase 1) and adding reward (phase 2) from the page.
 */

import { SETUP } from "../test-setup.mjs";

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const button = (page, selector) => page.innerText(selector);
    const usdt = t.deployed.addresses.USDT;

    await t.step("staking", async () => {
        const { page, errors } = await t.open("#/stake", { wallet: "demo" });
        await t.panelButton(page, "+1000 USDT");
        await t.panel(page, false);
        const poolIds = await page.locator("[data-pool]").evaluateAll((els) => els.map((el) => el.dataset.pool));
        t.check("stake: every pool of test-setup.json is on the page", SETUP.stakePools.every((p) => poolIds.includes(p.id)) && poolIds.length === SETUP.stakePools.length, poolIds.join(", "));
        t.check("stake: every mix of coins (native → USDT, USDT → USDT, USDT → native)", (await page.innerText("[data-pool='bwsc-usdt']")).includes("Native coin · Earn USDT")
            && (await page.innerText("[data-pool='usdt-usdt']")).includes("Earn USDT") && (await page.innerText("[data-pool='usdt-bwsc']")).includes(`Earn ${t.local.LOCAL_COIN_SYMBOL}`));
        t.check("stake: three filters (All pools, My stakes, Earning now)", (await page.locator("[role=tab]").count()) === 3);
        await page.fill("[data-stake-search]", "usdt-bwsc");
        t.check("stake: search narrows the pools", (await page.locator("[data-pool]").count()) === 1);
        await page.fill("[data-stake-search]", "zzz");
        t.check("stake: no match says so", (await page.innerText("[data-stake-cards]")).includes("No pool matches"));
        await page.fill("[data-stake-search]", "");
        t.check("stake: pools are paying (the local chain streams a first reward into each)", (await page.innerText("[data-pool='usdt-usdt']")).includes("Paying") && (await page.innerText("[data-pool='usdt-usdt']")).includes("still to be paid out"));
        t.check("stake: someone who is not the owner sees no 'Add reward'", (await page.locator("[data-reward-open]").count()) === 0);
        t.check("stake: no preview banner any more", !(await page.innerText("main")).includes("Preview"));

        await page.click("[data-pool='bwsc-usdt'] >> text=Stake / take out");
        await page.fill("[data-stake-in]", "1000000");
        t.check("stake: more native coins than the wallet has is refused", (await button(page, "[data-stake-button]")).startsWith("Not enough"));
        await page.click("[data-pool='bwsc-usdt'] >> text=Max");
        await page.waitForTimeout(200);
        t.check("stake: Max keeps 0.01 for gas", (await button(page, "[data-stake-button]")) === "Stake");
        await page.fill("[data-stake-in]", "2");
        await page.click("[data-stake-button]");
        t.check("stake: native coins staked (sent as value)", (await t.toast(page, [ "Staked", "Something went wrong" ])).includes("Staked"));
        await t.settle(page);

        await page.click("[data-pool='usdt-usdt'] >> text=Stake / take out");
        await page.fill("[data-stake-in]", "5000");
        t.check("stake: more USDT than the wallet has is refused", (await button(page, "[data-stake-button]")) === "Not enough USDT");
        await page.fill("[data-stake-in]", "100");
        await page.click("[data-stake-button]");
        const staked = await t.toast(page, [ "Staked", "Something went wrong" ]);
        t.check("stake: approve + stake 100 USDT", staked.includes("Staked"), staked.split("\n")[0]);
        await t.settle(page);
        t.check("stake: my stake and share are shown", /You stake 100 · [0-9.]+% of pool/.test(await page.innerText("[data-pool='usdt-usdt']")));

        // APR comes from the chain: same coin = a plain ratio; different coins = priced by the exchange's pool (no typed-in prices)
        const YEAR = 365n * 86_400n;
        const pct = (bps) => `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
        const pools = (await t.read("BwscStaking", "getView", { account: "", offset: 0n, limit: 10n })).pools;
        const poolNamed = (id) => pools.find((x) => x.id === id);
        const same = poolNamed("usdt-usdt");
        t.check("stake: APR of USDT → USDT = reward per year ÷ staked (no price needed)",
            (await page.innerText("[data-pool='usdt-usdt'] [data-apr]")) === pct((same.rewardPerSecond * YEAR * 10_000n) / same.totalStaked), await page.innerText("[data-pool='usdt-usdt'] [data-apr]"));
        const pair = await t.read("BwscDex", "getPair", { tokenA: "0x0000000000000000000000000000000000000000", tokenB: usdt });
        const wIsA = pair.tokenA === t.deployed.addresses.WBWSC;
        const price = ((wIsA ? pair.reserveB : pair.reserveA) * 10n ** 18n) / (wIsA ? pair.reserveA : pair.reserveB);   // USDT per 1 BWSC, from the pool
        const mixed = poolNamed("bwsc-usdt");
        const stakedValue = (mixed.totalStaked * price) / 10n ** 18n;
        t.check("stake: APR of BWSC → USDT uses the pool's BWSC price (from the chain, not settings)",
            (await page.innerText("[data-pool='bwsc-usdt'] [data-apr]")) === pct((mixed.rewardPerSecond * YEAR * 10_000n) / stakedValue), `${await page.innerText("[data-pool='bwsc-usdt'] [data-apr]")} vs ${pct((mixed.rewardPerSecond * YEAR * 10_000n) / stakedValue)}`);
        const earned = async () => Number((await page.innerText("[data-earned='usdt-usdt']")).replace(/,/g, ""));
        const first = await earned();
        await page.waitForTimeout(3200);
        const later = await earned();
        t.check("stake: rewards tick up every second (no extra reads)", later > first, `${first} → ${later} USDT`);

        await page.click("[data-pool='usdt-usdt'] >> text=Claim");
        const claimed = await t.toast(page, [ "Rewards claimed", "Something went wrong" ]);
        t.check("stake: claim pays the rewards", claimed.includes("Rewards claimed"), claimed.split("\n")[0]);
        await t.settle(page);

        await page.click("text=My stakes");
        t.check("stake: 'My stakes' shows both pools I am in", (await page.locator("[data-pool]").count()) === 2);
        await page.click("[data-pool='usdt-usdt'] >> text=Stake / take out");
        await page.click("[data-pool='usdt-usdt'] [role=tab]:has-text('Take out')");
        await page.fill("[data-stake-in]", "110");
        t.check("stake: taking out more than staked is refused", (await button(page, "[data-stake-button]")) === "More than you staked");
        await page.fill("[data-stake-in]", "40");
        await page.click("[data-stake-button]");
        t.check("stake: take out 40", (await t.toast(page, [ "Stake taken out", "Something went wrong" ])).includes("taken out"));
        await t.settle(page);
        t.check("stake: 60 still staked", /You stake 60 · /.test(await page.innerText("[data-pool='usdt-usdt']")));
        await collect(page, errors);
    });

    await t.step("owner adds reward", async () => {
        const { page, errors } = await t.open("#/stake", { wallet: "demo" });
        await t.panel(page, true);
        await t.panelButton(page, "Demo wallet = owner");
        await page.waitForSelector("[data-owner-note]", { timeout: 30_000 });
        await t.panel(page, false);
        const before = (await t.client.query({ program: t.deployed.addresses.BwscStaking, method: "getView", input: { account: "" } })).pools.find((p) => p.id === "usdt-usdt");
        await page.click("[data-reward-open='usdt-usdt']");
        await page.fill("[data-reward-amount]", "1");
        await page.fill("[data-reward-days]", "0.0001");
        t.check("owner: a stream under a minute is refused before signing", (await page.innerText("[data-reward-button]")) === "At least 1 minute");
        await page.fill("[data-reward-days]", "30");
        await page.fill("[data-reward-amount]", "300");
        t.check("owner: the button says what happens", (await page.innerText("[data-reward-button]")) === "Add 300 USDT over 30 days");
        t.check("owner: the extra rate per day is shown (300 / 30 = 10)", (await page.innerText("[data-reward-rate]")).startsWith("+10"));
        await page.click("[data-reward-button]");
        const added = await t.toast(page, [ "Reward added", "Something went wrong" ]);
        t.check("owner: reward added from the page", added.includes("Reward added"), added.split("\n")[0]);
        const after = (await t.client.query({ program: t.deployed.addresses.BwscStaking, method: "getView", input: { account: "" } })).pools.find((p) => p.id === "usdt-usdt");
        t.check("owner: the pool's rate went up and the money is in", after.rewardPerSecond > before.rewardPerSecond && after.funded - before.funded === 300n * 10n ** 18n && after.streams === before.streams + 1n);
        // Phase 1 from the page: a new pool (stake USDT, earn wBWSC)
        await page.fill("[data-new-pool-id]", "usdt-wbwsc");
        await page.click("[data-new-pool-stake]");
        await page.click("[data-pick-label='USDT']");
        await page.click("[data-new-pool-reward]");
        await page.click("[data-pick-label='wBWSC']");
        await page.click("[data-new-pool] >> text=Create pool");
        const made = await t.toast(page, [ "Pool created", "Something went wrong" ]);
        t.check("owner: a new pool from the page", made.includes("Pool created"), made.split("\n")[0]);
        await t.settle(page);
        t.check("owner: …it shows up, waiting for rewards", (await page.innerText("[data-pool='usdt-wbwsc']")).includes("Waiting for rewards"));
        await collect(page, errors);
    });

    await t.step("staking counters", async () => {
        const v = await t.client.query({ program: t.deployed.addresses.BwscStaking, method: "getView", input: { account: "" } });
        const c = v.counters.find((x) => x.token === usdt);
        t.check("stake: USDT staked + rewards = what the program holds", c.staked + c.rewardHeld === c.held);
    });

    await t.step("stake layout", async () => {
        const problems = await t.layout([ "#/stake" ]);
        t.check("layout: stake fits 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("stake page: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("stake page: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
