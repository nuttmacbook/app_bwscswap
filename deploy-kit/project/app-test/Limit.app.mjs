/*
 * YOUR CODE (app tests). The limit-order page on the real BwscLimit program, with the test chain's orders
 * (deploy-kit/settings/test-setup.json): the busiest market opens first, orders sorted best rate first (and by size),
 * markets search, the seller filter (row, panel, #/limit?seller= link, buy window, Copy my link), the coin list, flipping the pair, buying part of an order, placing an order (its place in the list
 * shown before), My orders and cancel, and the owner tab (fee, turn a coin off and on, withdraw fees). Every size fits.
 */

import { ethers } from "ethers";
import { SETUP } from "../test-setup.mjs";

const units = (text) => ethers.parseUnits(String(text), 18);

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const N = t.local.LOCAL_COIN_SYMBOL;
    const order = (id) => t.read("BwscLimit", "getOrder", { order: BigInt(id) });
    const rowIds = (page) => page.locator("[data-limit-order]").evaluateAll((els) => els.map((e) => Number(e.dataset.limitOrder)));
    const rates = (page) => page.locator("[data-limit-order] .font-mono.text-\\[15px\\]").evaluateAll((els) => els.map((e) => Number(e.textContent.replace(/,/g, ""))));
    const placeButton = (page) => page.innerText("[data-limit-place-button]");

    await t.step("limit orders: market", async () => {
        const { page, errors } = await t.open("#/limit", { wallet: "demo" });
        await t.panelButton(page, "+1000 USDT");
        await t.panel(page, false);
        await page.waitForSelector("[data-limit-orders]");

        t.check("limit: page head and tabs (no Owner tab for others)", (await page.innerText("main h1")).includes("at your price") && (await page.locator("[role=tab]").count()) === 2);
        t.check("limit: the busiest market opens first (get the native coin, pay USDT)", (await page.innerText("[data-limit-orders]")).includes(`Get ${N} · pay USDT`));
        const ids = await rowIds(page);
        const r = await rates(page);
        t.check("limit: the 4 orders of test-setup.json, best rate first (0.825 → 0.84 → 0.86 → 0.9)", ids.join() === "4,1,2,3" && r.join() === "0.825,0.84,0.86,0.9", `${ids} | ${r}`);
        t.check("limit: the first row is marked Best rate and the Swap price is there to compare", (await page.innerText("[data-limit-order='4']")).includes("Best rate") && /vs Swap/.test(await page.innerText("[data-limit-order='4']")));
        t.check("limit: an all-at-once order says so", (await page.innerText("[data-limit-order='3']")).includes("all at once"));

        await page.selectOption("[data-limit-sort]", "size");
        await page.waitForTimeout(400);
        t.check("limit: sort by size puts the 250 first", (await rowIds(page)).at(0) === 3);
        await page.selectOption("[data-limit-sort]", "rate");
        await page.waitForTimeout(400);

        // Markets: all of them, searchable
        const markets = await page.locator("[data-limit-market]").count();
        t.check("limit: All markets lists the 3 markets of the test chain", markets === 3, String(markets));
        await page.fill("[data-limit-market-search]", "wbwsc");
        t.check("limit: market search narrows the list (and the box keeps focus)", (await page.locator("[data-limit-market]").count()) === 1 && (await page.evaluate(() => document.activeElement?.hasAttribute("data-limit-market-search"))));
        await page.fill("[data-limit-market-search]", "");

        // The coin list: searchable, with order counts
        await page.locator("[data-limit-pair] [data-limit-coin='give']").click();
        const labels = await page.$$eval("[data-pick]", (els) => els.map((e) => e.getAttribute("data-pick-label")));
        t.check("limit: the coin list shows every listed coin", [ N, "USDT", "wBWSC" ].every((l) => labels.includes(l)), labels.join(", "));
        await page.keyboard.press("Escape");

        // Flip: people selling USDT for the native coin
        await page.click("[aria-label='Switch the two coins']");
        await page.waitForSelector(`[data-limit-orders] >> text=Get USDT · pay ${N}`);
        t.check("limit: flipped market shows its 2 orders, best (1.15) first", (await rowIds(page)).join() === "5,6");
        await page.click("[aria-label='Switch the two coins']");
        await page.waitForSelector(`[data-limit-orders] >> text=Get ${N} · pay USDT`);

        // Buy 10 from the best order: pay 8.25 USDT, get 10 less the 0.1% fee
        const left0 = (await order(4)).left;
        await page.click("[data-limit-buy='4']");
        await page.fill("[data-limit-buy-amount]", "10");
        const summary = await page.innerText("[data-limit-buy-summary]");
        t.check("buy: the window shows price, fee and what arrives (8.25 USDT → 9.99)", /You pay\s+8\.25 USDT/.test(summary) && /You receive\s+9\.99/.test(summary) && /cheaper/.test(summary), summary.replace(/\s+/g, " "));
        await page.fill("[data-limit-buy-amount]", "50");
        t.check("buy: more than the order has is refused before signing", (await page.innerText("[data-limit-buy-button]")).startsWith("Only 20"));
        await page.fill("[data-limit-buy-amount]", "10");
        t.check("buy: approve and buy in one go", (await page.innerText("[data-limit-buy-button]")) === `Approve & buy 10 ${N}`, await page.innerText("[data-limit-buy-button]"));
        await page.click("[data-limit-buy-button]");
        const bought = await t.toast(page, [ "Bought", "Something went wrong" ]);
        t.check("buy: bought 10 from order 4", bought.includes("Bought") && left0 - (await order(4)).left === units(10), bought.split("\n")[0]);
        await t.settle(page);

        // An all-at-once order: the amount is fixed
        await page.click("[data-limit-buy='3']");
        t.check("buy: all-at-once order fixes the amount to all of it", (await page.inputValue("[data-limit-buy-amount]")) === "250" && (await page.getAttribute("[data-limit-buy-amount]", "readonly")) !== null);
        await page.click("[aria-label='Close']");

        // Place an order: its place in the list shows while typing
        await page.fill("[data-limit-give]", "5");
        await page.fill("[data-limit-want]", "4.5");
        t.check("place: 5 for 4.5 (0.9) would be #5 of 5", (await page.innerText("[data-limit-rank]")) === "#5 of 5");
        await page.fill("[data-limit-want]", "4");
        t.check("place: 5 for 4 (0.8) would be #1 of 5, below the Swap price", (await page.innerText("[data-limit-rank]")) === "#1 of 5" && (await page.innerText("[data-limit-draft]")).includes("less than Swap"));
        await page.fill("[data-limit-give]", "100000000");
        t.check("place: more than the wallet has is refused", (await placeButton(page)).startsWith("Not enough"));
        await page.fill("[data-limit-give]", "5");
        t.check("place: the native coin needs no approval", (await placeButton(page)) === "Place order");
        await page.click("[data-limit-place-button]");
        const placed = await t.toast(page, [ "Order placed", "Something went wrong" ]);
        t.check("place: order placed", placed.includes("Order placed"), placed.split("\n")[0]);
        await t.settle(page);
        const first = await page.innerText("[data-limit-orders] [data-limit-order]");
        t.check("place: my order is first in the list, marked Yours, with Cancel instead of Buy", first.includes("Yours") && first.includes("Cancel") && first.includes("0.8"));

        // My orders: cancel it
        await page.click("[role=tab]:has-text('My orders')");
        await page.waitForSelector("[data-limit-mine-list]");
        t.check("mine: one open order", (await page.locator("[data-limit-mine]").count()) === 1 && (await page.innerText("[data-limit-mine-list]")).includes("Give 5"));
        await page.click("[data-limit-mine] button:has-text('Cancel')");
        const cancelled = await t.toast(page, [ "Order cancelled", "Something went wrong" ]);
        t.check("mine: cancelled, the coins are back", cancelled.includes("Order cancelled"));
        await t.settle(page);
        t.check("mine: no open orders left; All still lists it as Cancelled", (await page.innerText("[data-limit-mine-list]")).includes("No open orders"));
        await page.click("[role=tab]:has-text('All')");
        t.check("mine: All shows the cancelled order", (await page.innerText("[data-limit-mine-list]")).includes("Cancelled"));
        await collect(page, errors);
    });

    await t.step("limit orders: seller", async () => {
        const { page, errors } = await t.open("#/limit", { wallet: "demo" });
        await page.waitForSelector("[data-limit-orders] [data-limit-order]");
        const maker = (await page.getAttribute("[data-limit-order='4'] [data-limit-seller]", "data-limit-seller")).toLowerCase();
        t.check("seller: every order shows its seller (short address)", (await page.locator("[data-limit-order] [data-limit-seller]").count()) === (await page.locator("[data-limit-order]").count()) && (await page.innerText("[data-limit-order='4'] [data-limit-seller]")).startsWith(maker.slice(0, 6)));

        // Tap the seller: only their orders, and all of theirs in every market
        await page.click("[data-limit-order='4'] [data-limit-seller]");
        await page.waitForSelector("[data-limit-seller-panel] [data-limit-seller-order]");
        const panel = await page.innerText("[data-limit-seller-panel]");
        const theirs = await page.locator("[data-limit-seller-order]").count();
        const open = SETUP.limitOrders.length;
        t.check("seller: the panel shows the full address and their open orders in every market", panel.toLowerCase().includes(maker) && theirs >= open - 1 && theirs <= open, `${theirs} of ${open}`);
        const makers = await page.locator("[data-limit-order] [data-limit-seller]").evaluateAll((els) => els.map((e) => e.dataset.limitSeller.toLowerCase()));
        t.check("seller: the list keeps only that seller's orders", makers.length > 0 && makers.every((m) => m === maker));
        t.check("seller: the box holds the address", (await page.inputValue("[data-limit-seller-input]")).toLowerCase() === maker);

        // An order of theirs in another market opens that market
        const other = page.locator("[data-limit-seller-order]:not(:has-text('shown below'))").first();
        const otherId = Number(await other.getAttribute("data-limit-seller-order"));
        await other.click();
        await page.waitForSelector(`[data-limit-order='${otherId}']`);
        t.check("seller: tapping one of their orders opens its market", (await page.locator(`[data-limit-order='${otherId}']`).count()) === 1);

        // Buy dialog: the seller in full
        await page.click("[data-limit-orders] [data-limit-buy] >> nth=0");
        await page.waitForSelector("[data-limit-buy-seller]");
        t.check("seller: the buy window shows the seller's full address", (await page.innerText("[data-limit-buy-seller]")).toLowerCase() === maker);
        await page.click("[aria-label='Close']");

        // A bad address is refused; Clear shows everyone again
        await page.fill("[data-limit-seller-input]", "0x1234");
        await page.press("[data-limit-seller-input]", "Enter");
        t.check("seller: a bad address is refused", (await t.toast(page, [ "address", "Something went wrong" ])).toLowerCase().includes("address"));
        await page.click("[data-limit-seller-clear]");
        await page.waitForTimeout(300);
        t.check("seller: Clear removes the filter", (await page.locator("[data-limit-seller-panel]").count()) === 0 && (await page.inputValue("[data-limit-seller-input]")) === "");
        await collect(page, errors);

        // A shared link opens with the seller's orders
        const linked = await t.open(`#/limit?seller=${maker}`, { wallet: "demo" });
        await linked.page.waitForSelector("[data-limit-seller-panel] [data-limit-seller-order]");
        t.check("seller: #/limit?seller=0x… opens with their orders", (await linked.page.innerText("[data-limit-seller-panel]")).toLowerCase().includes(maker));
        // My orders: a link to share
        await linked.page.click("[role=tab]:has-text('My orders')");
        await linked.page.waitForSelector("[data-limit-share]");
        t.check("mine: Copy my link to share my orders", (await linked.page.innerText("[data-limit-share]")).includes("Copy my link"));
        await collect(linked.page, linked.errors);
    });

    await t.step("limit orders: owner", async () => {
        const { page, errors } = await t.open("#/limit", { wallet: "demo" });
        await t.panelButton(page, "Demo wallet = owner");
        await t.panel(page, false);
        await page.waitForSelector("[role=tab]:has-text('Owner')");
        await page.click("[role=tab]:has-text('Owner')");
        await page.waitForSelector("[data-limit-owner]");
        t.check("owner: the Owner tab lists the 3 coins with their fees", (await page.locator("[data-limit-owner-coin]").count()) === 3);
        await page.fill("[data-limit-coin-search]", "usdt");
        t.check("owner: coin search", (await page.locator("[data-limit-owner-coin]").count()) === 1);
        await page.fill("[data-limit-coin-search]", "");
        await page.fill("[data-limit-owner-coin='USDT'] input", "0.2");
        await page.click("[data-limit-owner-coin='USDT'] button:has-text('Save fee')");
        t.check("owner: fee saved", (await t.toast(page, [ "Coin saved", "Something went wrong" ])).includes("Coin saved"));
        const coins = (await t.read("BwscLimit", "getView", { account: "", offset: 0n, limit: 1n })).coins;
        t.check("owner: USDT's fee is now 0.2% on chain", coins.find((c) => c.token === t.deployed.addresses.USDT).feeBps === 20n);
        await t.settle(page);
        await page.click("[data-limit-owner-coin='wBWSC'] button:has-text('Turn off')");
        await t.toast(page, [ "Coin saved", "Something went wrong" ]);
        await t.settle(page);
        t.check("owner: wBWSC turned off", (await page.innerText("[data-limit-owner-coin='wBWSC']")).includes("Off"));
        await page.click("[data-limit-owner-coin='wBWSC'] button:has-text('Turn on')");
        await t.toast(page, [ "Coin saved", "Something went wrong" ]);
        await t.settle(page);
        const native = page.locator(`[data-limit-owner-coin='${N}'] button:has-text('Withdraw')`);
        t.check("owner: the fee from the buy (0.01) can be withdrawn", await native.isEnabled());
        await native.click();
        t.check("owner: fees withdrawn", (await t.toast(page, [ "Fees withdrawn", "Something went wrong" ])).includes("Fees withdrawn"));
        t.check("owner: test-setup orders were placed", SETUP.limitOrders.length === 7);
        await collect(page, errors);
    });

    await t.step("limit layout", async () => {
        const problems = await t.layout([ "#/limit" ]);
        t.check("layout: limit orders fit 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("limit pages: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("limit pages: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
