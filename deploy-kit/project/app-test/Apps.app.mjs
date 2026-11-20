/*
 * YOUR CODE (app tests). The chain's app directory: the Apps page (every built-in tool + settings/config.js
 * directory.apps; on the local chain the four example games with example.com links), search, categories with counts,
 * sort, badges on the cards (Core, Audited, risk, Beta, New, Coming soon) and the badge filter, each app's own page
 * (cover, logo, full text, badges explained, links, Open), #/apps?c=…, the header search (button, "/" key), the home
 * page's apps section, the menu (Apps · Trade · Bridge · Stake) and the Trade tabs on Swap / Limit orders / Pool.
 */

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const ids = (page) => page.locator("[data-apps-grid] [data-app]").evaluateAll((els) => els.map((e) => e.dataset.app));

    await t.step("apps directory", async () => {
        const { page, errors } = await t.open("#/apps");
        await page.waitForSelector("[data-apps-grid]");
        const all = await ids(page);
        t.check("apps: built-in tools and the 4 games are listed", [ "swap", "limit", "pool", "bridge", "stake", "wolf-runner", "chain-chess", "moon-dice", "pixel-farm" ].every((x) => all.includes(x)), all.join(", "));
        const badges = (id) => page.locator(`[data-app='${id}'] [data-badge]`).evaluateAll((els) => els.map((e) => e.dataset.badge));
        t.check("apps: built-in tools carry the Core badge; Open goes straight to the page, the card to its details", (await badges("swap")).join() === "core" && (await page.getAttribute("[data-app='swap'] [data-app-open]", "href")) === "#/swap" && (await page.getAttribute("[data-app='swap'] [data-app-details]", "href")) === "#/app?id=swap");
        t.check("apps: badges on the card: Audited + Low risk + New / Core + Low risk + Beta / High risk / Medium risk + Coming soon",
            (await badges("wolf-runner")).join() === "audited,risk-low,new" && (await badges("chain-chess")).join() === "core,risk-low,beta" && (await badges("moon-dice")).join() === "risk-high" && (await badges("pixel-farm")).join() === "risk-medium,soon",
            [ await badges("wolf-runner"), await badges("chain-chess"), await badges("moon-dice"), await badges("pixel-farm") ].join(" | "));
        t.check("apps: another site's Open button opens a new tab", (await page.getAttribute("[data-app='wolf-runner'] [data-app-open]", "href")) === "https://example.com/wolf-runner" && (await page.getAttribute("[data-app='wolf-runner'] [data-app-open]", "target")) === "_blank");
        t.check("apps: Coming soon has no Open button", (await page.locator("[data-app='pixel-farm'] [data-app-open]").count()) === 0);
        t.check("apps: the badge legend explains the colors", (await page.innerText("[data-apps-legend]")).includes("by the chain team"));
        await page.selectOption("[data-apps-badge]", "audited");
        await page.waitForTimeout(300);
        t.check("apps: filter Audited only", (await ids(page)).join() === "wolf-runner");
        await page.selectOption("[data-apps-badge]", "safer");
        await page.waitForTimeout(300);
        t.check("apps: Hide high risk hides Moon Dice", !(await ids(page)).includes("moon-dice") && (await ids(page)).includes("wolf-runner"));
        await page.selectOption("[data-apps-badge]", "core");
        await page.waitForTimeout(300);
        t.check("apps: Core only = the chain's tools + Chain Chess", (await ids(page)).includes("chain-chess") && !(await ids(page)).includes("wolf-runner"));
        await page.selectOption("[data-apps-badge]", "any");
        await page.waitForTimeout(300);

        // An app's own page
        await page.click("[data-app='wolf-runner'] [data-app-details]");
        await page.waitForSelector("[data-app-page='wolf-runner']");
        const detail = await page.innerText("main");
        t.check("app page: cover, logo, name, developer, full text in paragraphs", (await page.locator("[data-app-cover] img").count()) === 1 && (await page.locator("[data-app-page] img[src='/apps/wolf-runner.svg']").count()) >= 1
            && detail.includes("Night Pack Studio") && (await page.locator("[data-app-about] p").count()) === 2);
        const why = (await page.innerText("[data-app-page-badges]")).toLowerCase();
        t.check("app page: each badge explained, with the audit report link", why.includes("audited by example audits") && why.includes("low risk") && (await page.locator("[data-app-page-badges] a[href='https://example.com/audits/wolf-runner.pdf']").count()) === 1);
        t.check("app page: audited → no 'not checked' warning", !why.includes("not an endorsement"));
        t.check("app page: Open opens the game in a new tab; links listed", (await page.getAttribute("[data-app-page-open]", "href")) === "https://example.com/wolf-runner" && detail.includes("Website") && detail.includes("X"));
        t.check("app page: More Games lists the others", (await page.locator("[aria-label='More Games'] [data-app]").count()) === 3);
        await page.evaluate(() => { location.hash = "#/app?id=swap"; });
        await page.waitForSelector("[data-app-page='swap']");
        t.check("app page of a Core tool: no warning, its program on the explorer, Open → the page", !(await page.innerText("[data-app-page-badges]")).toLowerCase().includes("not an endorsement") && (await page.getAttribute("[data-app-page-open]", "href")) === "#/swap" && (await page.locator("[data-app-programs] a").count()) === 1);
        await page.evaluate(() => { location.hash = "#/app?id=nope"; });
        await page.waitForSelector("text=No app here");
        t.check("app page: an unknown id says so", true);
        await page.evaluate(() => { location.hash = "#/apps"; });
        await page.waitForSelector("[data-apps-grid]");
        t.check("apps: the Games chip counts 4", (await page.innerText("[data-apps-category='games']")).includes("4"));

        await page.click("[data-apps-category='games']");
        await page.waitForTimeout(300);
        t.check("apps: the Games category shows only the 4 games, and the link keeps it", (await ids(page)).length === 4 && (await page.evaluate(() => location.hash)) === "#/apps?c=games");
        await page.fill("[data-apps-search]", "replay");
        t.check("apps: search reads descriptions (and the box keeps focus)", (await ids(page)).join() === "chain-chess" && (await page.evaluate(() => document.activeElement?.hasAttribute("data-apps-search"))));
        await page.fill("[data-apps-search]", "zzzz");
        t.check("apps: no match says so", (await page.innerText("[data-apps-results]")).includes("No app matches"));
        await page.fill("[data-apps-search]", "");
        await page.selectOption("[data-apps-sort]", "name");
        await page.waitForTimeout(300);
        t.check("apps: A–Z", (await ids(page)).join() === "chain-chess,moon-dice,pixel-farm,wolf-runner");
        await page.selectOption("[data-apps-sort]", "new");
        await page.waitForTimeout(300);
        t.check("apps: Newest first", (await ids(page)).at(0) === "wolf-runner");

        // A link straight to a category
        await page.evaluate(() => { location.hash = "#/apps?c=defi"; });
        await page.waitForTimeout(500);
        t.check("apps: #/apps?c=defi opens DeFi (Swap, Limit orders, Pool, Bridge, Stake)", (await ids(page)).length === 5);

        // Header search: "/" opens it, typing finds, picking opens the page
        await page.click("main h1");
        await page.keyboard.press("/");
        await page.waitForSelector("[data-search]");
        await page.fill("[data-search]", "limit");
        const found = await page.$$eval("[data-pick]", (els) => els.map((e) => e.getAttribute("data-pick-label")));
        t.check("search: '/' opens it, 'limit' finds Limit orders", found.includes("Limit orders"), found.join(", "));
        await page.click("[data-pick-label='Limit orders']");
        await page.waitForSelector("[data-trade-tabs]");
        t.check("search: a Core tool opens at once", (await page.evaluate(() => location.hash)) === "#/limit");
        await page.click("[data-search-open]");
        await page.fill("[data-search]", "dice");
        await page.click("[data-pick-label='Moon Dice']");
        await page.waitForSelector("[data-app-page='moon-dice']");
        const moon = (await page.innerText("[data-app-page-badges]")).toLowerCase();
        t.check("search: another app opens its page; not core and not audited → a plain warning", moon.includes("high risk") && moon.includes("not an endorsement"));
        await collect(page, errors);
    });

    await t.step("menu, trade tabs and home", async () => {
        const { page, errors } = await t.open("#/");
        await page.waitForSelector("[data-home-apps]");
        const nav = await page.innerText("header nav");
        t.check("menu: Apps · Trade · Bridge · Stake · Send · Docs (+ Explorer)", /Apps\s+Trade\s+Bridge\s+Stake\s+Send\s+Docs/.test(nav), nav.replace(/\s+/g, " "));
        t.check("home: the hero leads to the apps", (await page.innerText("[data-hero-apps]")).includes("Explore apps"));
        const home = await page.innerText("[data-home-apps]");
        t.check("home: apps as a summary: the count and categories (Games 4)", home.includes("Games") && /4\s+Games/.test(home));
        await page.click("[data-home-category='games']");
        await page.waitForSelector("[data-apps-grid]");
        t.check("home: a category opens the Apps page on it", (await page.locator("[data-apps-grid] [data-app]").count()) === 4);

        for (const [ hash, label ] of [ [ "#/swap", "Swap" ], [ "#/limit", "Limit orders" ], [ "#/pool", "Pool" ] ]) {
            await page.evaluate((h) => { location.hash = h; }, hash);
            await page.waitForSelector("[data-trade-tabs]");
            const current = await page.innerText("[data-trade-tabs] [aria-current=page]");
            const lit = await page.innerText("header nav [aria-current=page]");
            t.check(`trade: ${label} shows the Trade tabs with itself selected, and Trade lit in the menu`, current === label && lit === "Trade");
        }
        await page.click("[data-trade-tabs] >> text=Limit orders");
        await page.waitForSelector("[data-limit-orders]");
        t.check("trade: the tabs move between the three", (await page.evaluate(() => location.hash)) === "#/limit");
        await collect(page, errors);
    });

    t.check("apps pages: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("apps pages: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
