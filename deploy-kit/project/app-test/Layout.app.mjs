/*
 * YOUR CODE (app tests). Every page, in every state people reach (lists, an opened pair, the stake form, the owner's
 * forms, a coin picker, a filled bridge form), at every common screen size from a 320 px phone to a 2560 px screen,
 * plus a phone held sideways. One browser profile is resized through the sizes, so the state stays as it is.
 *
 * At each size: nothing sticks out sideways (page or element), no field cuts off the number in it, buttons are big
 * enough to tap on phones, and the bottom bar never hides the last thing on the page.
 * SHOTS_DIR=<folder> also saves a screenshot of every state at 320 / 768 / 1440 / 2560 px for a look by eye.
 */

import fs from "node:fs";

const SIZES = [ [ 320, 640 ], [ 360, 740 ], [ 375, 667 ], [ 390, 844 ], [ 414, 896 ], [ 600, 960 ], [ 768, 1024 ], [ 820, 1180 ], [ 1024, 768 ],
    [ 1280, 800 ], [ 1440, 900 ], [ 1920, 1080 ], [ 2560, 1440 ], [ 844, 390 ] ];
const SHOT_WIDTHS = [ 320, 768, 1440, 2560 ];

/** Runs in the page: what is wrong at this size */
const CHECK = () => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const problems = [];
    if (doc.scrollWidth > vw + 1) problems.push(`the page is ${doc.scrollWidth}px wide in ${vw}px`);
    const clipped = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX !== "visible" || s.position === "fixed") return true;
        }
        return false;
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.dataset && Object.keys(el.dataset).length ? `[data-${Object.keys(el.dataset)[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]` : ""} "${(el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
    for (const el of document.querySelectorAll("#app *")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.position === "fixed" || el.closest(".sr-only")) continue;
        if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) problems.push(`${name(el)} sticks out (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
    }
    for (const input of document.querySelectorAll("#app input")) {
        if (input.type === "checkbox" || input.type === "radio" || !input.value) continue;
        if (input.scrollWidth > input.clientWidth + 2) problems.push(`field ${name(input)} cuts off "${input.value}"`);
    }
    if (vw < 768) {
        for (const b of document.querySelectorAll("#app button, header button")) {
            const r = b.getBoundingClientRect();
            if (r.width && r.height && r.height < 28 && !b.closest("[data-dev-panel]")) problems.push(`button ${name(b)} is ${Math.round(r.height)}px tall`);
        }
        // The last thing on the page can scroll clear of the bottom bar
        const bar = document.querySelector("nav.fixed");
        const footer = document.querySelector("footer");
        if (bar && footer && getComputedStyle(bar).display !== "none") {
            const pad = parseFloat(getComputedStyle(footer).paddingBottom);
            if (pad + 1 < bar.getBoundingClientRect().height) problems.push(`the bottom bar (${Math.round(bar.getBoundingClientRect().height)}px) can cover the footer (padding ${pad}px)`);
        }
    }
    return [ ...new Set(problems) ];
};

export default async function (t) {
    const N = t.local.LOCAL_COIN_SYMBOL;
    const shotsDir = process.env.SHOTS_DIR;
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
    const allProblems = [];

    /** Resizes through every size and checks the current state */
    const sweep = async (page, state) => {
        const found = [];
        for (const [ width, height ] of SIZES) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(120);
            for (const p of await page.evaluate(CHECK)) found.push(`${width}×${height}: ${p}`);
            if (shotsDir && SHOT_WIDTHS.includes(width) && !(width === 844 && height === 390)) {
                await page.screenshot({ path: `${shotsDir}/${state.replace(/[^a-z0-9]+/gi, "-")}-${width}.png`, fullPage: true });
            }
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(120);
        allProblems.push(...found.map((p) => `${state} · ${p}`));
        t.check(`${state}: fits every size (${SIZES.length} sizes)`, found.length === 0, found.slice(0, 4).join(" | "));
    };

    await t.step("every page and state at every size", async () => {
        const { page } = await t.open("#/", { wallet: "demo" });
        await t.panelButton(page, "Demo wallet = owner");
        await t.panel(page, false);
        const go = async (hash) => {
            await page.evaluate((h) => { location.hash = h; }, hash);
            await page.waitForTimeout(400);
            await page.waitForSelector("main:not([aria-busy])");
        };

        await go("#/");
        await sweep(page, "home");

        await go("#/swap");
        await page.fill("[data-swap-in]", "3");
        await page.waitForTimeout(200);
        await sweep(page, "swap with an amount");
        await page.click("[data-pick-from]");
        await sweep(page, "swap coin picker");
        await page.keyboard.press("Escape");

        await go("#/pool");
        await page.waitForSelector("section[aria-label='New pair']");
        await sweep(page, "pool list + new pair (owner)");
        await page.click("[data-pair] >> text=Open");
        await page.waitForSelector("[data-add-a]");
        await page.fill("[data-add-a]", "2");
        await page.waitForTimeout(200);
        await sweep(page, "pool opened");

        await go("#/stake");
        await page.click("[data-pool='usdt-usdt'] >> text=Stake / take out");
        await page.fill("[data-stake-in]", "10");
        await sweep(page, "stake with the form open");
        await page.click("[data-reward-open='usdt-bwsc']");
        await page.fill("[data-reward-amount]", "300");
        await page.fill("[data-reward-days]", "30");
        await page.fill("[data-new-pool-id]", "usdt-wbwsc-long-name");
        await sweep(page, "stake owner forms");

        await go("#/bridge");
        await page.fill("[data-bridge-in]", "12.5");
        await sweep(page, "bridge with an amount");
        await page.click("[aria-label='Switch direction']");
        await page.click("[data-bridge-token]");
        await sweep(page, "bridge coin picker");
        await page.keyboard.press("Escape");

        await go("#/apps");
        await sweep(page, "apps directory");
        await go("#/apps?c=games");
        await page.fill("[data-apps-search]", "chess");
        await sweep(page, "apps: games, searched");
        await go("#/app?id=wolf-runner");
        await sweep(page, "an app's page (cover, badges, links)");
        await go("#/app?id=swap");
        await sweep(page, "a core tool's page");
        await page.click("[data-search-open]");
        await sweep(page, "header search open");
        await page.keyboard.press("Escape");

        await go("#/docs");
        await sweep(page, "docs: introduction");
        await go("#/docs?p=first-program");
        await sweep(page, "docs: a page with code");
        await go("#/docs?p=http-api");
        await sweep(page, "docs: the HTTP API reference");

        await go("#/limit");
        await page.waitForSelector("[data-limit-orders]");
        await page.fill("[data-limit-give]", "5");
        await page.fill("[data-limit-want]", "4.2");
        await sweep(page, "limit orders with a draft");
        await page.click("[role=tab]:has-text('Owner')");
        await page.waitForSelector("[data-limit-owner]");
        await sweep(page, "limit owner tab");
    });

    if (allProblems.length) console.log(`  layout problems:\n    ${allProblems.slice(0, 200).join("\n    ")}`);
}
