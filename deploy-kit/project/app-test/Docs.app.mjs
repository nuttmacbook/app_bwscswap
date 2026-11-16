/*
 * YOUR CODE (app tests). The docs (#/docs): the sidebar of every page in groups, search, opening a page, the table
 * of contents, previous / next, code blocks (highlighted, numbered, Copy), the network values filled in from
 * settings, the mobile menu, no reads from the chain, and every size fits.
 */

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };

    await t.step("docs", async () => {
        const { page, errors } = await t.open("#/docs");
        await page.waitForSelector("[data-docs-article]");
        t.check("docs: opens on the introduction", (await page.getAttribute("[data-docs]", "data-docs")) === "introduction" && (await page.innerText("[data-docs-article] h1")).includes("Introduction"));
        const reads = await t.reads(page);
        t.check("docs: no reads from the chain", reads.total === 0, JSON.stringify(reads.calls));
        const links = await page.locator("[data-docs-nav] [data-docs-link]").count();
        const nav = await page.innerText("[data-docs-nav]");
        t.check("docs: the sidebar lists every page in its group", links === 20 && [ "Getting started", "Using the apps", "Programs", "Build apps", "Reference" ].every((g) => nav.toLowerCase().includes(g.toLowerCase())), String(links));

        // Search narrows the sidebar
        await page.fill("[data-docs-search]", "event");
        await page.waitForTimeout(200);
        const found = await page.locator("[data-docs-nav] [data-docs-link]").evaluateAll((els) => els.map((e) => e.dataset.docsLink));
        t.check("docs: search narrows the sidebar (and the box keeps focus)", found.includes("events") && found.length < links && (await page.evaluate(() => document.activeElement?.hasAttribute("data-docs-search"))), found.join());
        await page.fill("[data-docs-search]", "");

        // A program page: code blocks
        await page.click("[data-docs-link='first-program']");
        await page.waitForSelector("[data-docs='first-program']");
        t.check("docs: a sidebar link opens its page (and marks it)", (await page.getAttribute("[data-docs-link='first-program']", "aria-current")) === "page");
        const blocks = page.locator("[data-docs-article] [data-code]");
        t.check("docs: code is in code blocks: highlighted, numbered, a Copy button", (await blocks.count()) >= 1 && (await page.locator("[data-docs-article] [data-code] .tok-kw").count()) > 0
            && (await page.locator("[data-docs-article] [data-code] .code-ln").count()) > 3 && (await page.locator("[data-docs-article] [data-code] button[aria-label='Copy code']").count()) === (await blocks.count()));
        t.check("docs: the code says how a program is written", (await page.innerText("[data-docs-article]")).includes("function program"));
        t.check("docs: the table of contents lists the page's headings", (await page.locator("[data-docs-toc] li").count()) >= 2);

        // Previous / next
        await page.click("[data-docs-next]");
        await page.waitForSelector("[data-docs='structure']");
        t.check("docs: Next opens the next page", true);
        await page.click("[data-docs-prev]");
        await page.waitForSelector("[data-docs='first-program']");
        t.check("docs: Previous goes back", true);

        // Network values come from settings
        await page.evaluate(() => { location.hash = "#/docs?p=network"; });
        await page.waitForSelector("[data-docs='network']");
        const net = await page.innerText("[data-docs-article]");
        t.check("docs: the network page has this chain's values (RPC, chain id, symbol)", net.includes(`${t.node}/evm`) && net.includes(String(t.local.LOCAL_CHAIN_ID)) && net.includes(t.local.LOCAL_COIN_SYMBOL) && !/\{[A-Z_]+\}/.test(net));
        await page.evaluate(() => { location.hash = "#/docs?p=nothing-here"; });
        await page.waitForTimeout(300);
        t.check("docs: an unknown page falls back to the introduction", (await page.getAttribute("[data-docs]", "data-docs")) === "introduction");
        await collect(page, errors);

        // Phone: the sidebar is a menu
        const phone = await t.open("#/docs?p=events", { width: 375 });
        await phone.page.waitForSelector("[data-docs='events']");
        const menu = phone.page.locator("[data-docs-menu]");
        t.check("docs (phone): a menu button instead of the sidebar", await menu.isVisible() && !(await phone.page.locator("[data-docs-nav]").first().isVisible()));
        await menu.click();
        await phone.page.waitForTimeout(200);
        t.check("docs (phone): the menu opens the page list", (await menu.getAttribute("aria-expanded")) === "true" && await phone.page.locator("[data-docs-nav] [data-docs-link='bridge']:visible").count() === 1);
        await phone.page.click("[data-docs-nav] [data-docs-link='bridge']:visible");
        await phone.page.waitForSelector("[data-docs='bridge']");
        t.check("docs (phone): a page from the menu opens and the menu closes", (await phone.page.getAttribute("[data-docs-menu]", "aria-expanded")) === "false");
        await collect(phone.page, phone.errors);
    });

    await t.step("docs layout", async () => {
        const problems = await t.layout([ "#/docs", "#/docs?p=first-program", "#/docs?p=http-api" ]);
        t.check("layout: docs fit 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("docs: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("docs: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
