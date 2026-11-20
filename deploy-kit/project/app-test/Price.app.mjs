/*
 * YOUR CODE (app tests). The coin's price under the chain's name in the header: read from the BWSC / USDT pool
 * (never typed in), the same number the pool gives, one shared read (not one per page), a new price after a swap,
 * shown on phones too, and it fits every size.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

/** The header's rule: 4 significant digits below 1, 2 decimals from 1 */
function expected(pair, usdt) {
    const usdtIsA = pair.tokenA.toLowerCase() === usdt.toLowerCase();
    const coin = BigInt(usdtIsA ? pair.reserveB : pair.reserveA);
    const unit = BigInt(usdtIsA ? pair.reserveA : pair.reserveB);
    const value = (unit * 10n ** 18n) / coin;
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, "0");
    if (whole > 0n) return `$${whole.toLocaleString("en-US")}.${frac.slice(0, 2)}`;
    const lead = frac.match(/^0*/)[0].length;
    return `$0.${frac.slice(0, lead + 4).replace(/0+$/, "") || "0"}`;
}

export default async function (t) {
    const allErrors = [];
    const N = t.local.LOCAL_COIN_SYMBOL;
    const USDT = t.deployed.addresses.USDT;
    const pair = () => t.read("BwscDex", "getPair", { tokenA: ZERO, tokenB: USDT });
    const shown = (page) => page.innerText("header [data-coin-price]");

    await t.step("header price", async () => {
        const { page, errors } = await t.open("#/docs", { wallet: "demo" });
        await page.waitForSelector("header [data-coin-price]:not(.hidden)");
        const want = expected(await pair(), USDT);
        const text = (await shown(page)).replace(/\s+/g, " ").trim();
        t.check("price: under the chain's name, from the BWSC / USDT pool", text === `${N} ${want}`, `${text} (pool: ${want})`);
        t.check("price: says where it comes from (title)", (await page.getAttribute("header [data-coin-price]", "title")).includes(`${N} / USDT pool`));
        const docs = await t.reads(page);
        t.check("price: one shared read; the docs page itself still reads nothing", docs.total === 0 && docs.shared === 1, JSON.stringify(docs));

        // Other pages within 30 s use the same price: no new read
        await page.evaluate(() => { location.hash = "#/apps"; });
        await page.waitForSelector("[data-apps-grid]");
        await page.waitForTimeout(400);
        const apps = await t.reads(page);
        t.check("price: the next page reuses it (no second price read)", apps.shared === 0 && (await shown(page)).includes(want), JSON.stringify(apps));

        // A swap moves the pool: the header shows the new price
        await t.panelButton(page, "+1000 USDT");
        await t.panel(page, false);
        await page.evaluate(() => { location.hash = "#/swap"; });
        await page.waitForSelector("[data-swap-in]");
        await page.click("button[aria-label='Switch direction']");
        await page.waitForFunction(() => document.querySelector("[data-pick-from]")?.innerText.includes("USDT"));
        await page.fill("[data-swap-in]", "900");
        await page.waitForSelector("[data-swap-button]:not([disabled])");
        await page.click("[data-swap-button]");
        const toast = await t.toast(page, [ "Swap confirmed", "Something went wrong" ]);
        t.check("price: a swap goes through", toast.includes("Swap confirmed"), toast.split("\n")[0]);
        const after = expected(await pair(), USDT);
        await page.waitForFunction((w) => document.querySelector("header [data-coin-price]")?.innerText.includes(w), after, { timeout: 15_000 }).catch(() => {});
        t.check("price: after the swap the header shows the pool's new price", after !== want && (await shown(page)).includes(after), `${await shown(page)} (pool: ${after}, before: ${want})`);
        allErrors.push(...errors);

        // Phone: the line is there too
        const phone = await t.open("#/", { width: 390 });
        await phone.page.waitForSelector("header [data-coin-price]:not(.hidden)");
        t.check("price (phone): shown under the name", (await phone.page.locator("header [data-coin-price]").isVisible()) && (await shown(phone.page)).includes("$"));
        allErrors.push(...phone.errors);
    });

    await t.step("header price layout", async () => {
        const problems = await t.layout([ "#/", "#/swap" ]);
        t.check("layout: the header with the price fits 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("price: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
}
