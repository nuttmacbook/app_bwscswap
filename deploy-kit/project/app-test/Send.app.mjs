/*
 * YOUR CODE (app tests). Multi transfer (#/send) on the real BwscMultiSend program: one read, the list checked while
 * typing (lines with a problem by number, wallets listed twice and Merge), the summary (wallets, total, transactions,
 * fee, balance after), sending the native coin, a token to 250 wallets in two transactions with one approval
 * ("same amount for everyone"), the batch list, a CSV file, an address that is not a token, and every size fits.
 */

import { ethers } from "ethers";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text) => ethers.parseUnits(String(text), 18);
const fresh = (n) => Array.from({ length: n }, () => ethers.Wallet.createRandom().address.toLowerCase());

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const N = t.local.LOCAL_COIN_SYMBOL;
    const nativeOf = async (who) => (await t.read("BwscMultiSend", "getView", { account: who, token: ZERO })).balance;
    const usdtOf = (who) => t.balanceOf("USDT", who);
    const button = (page) => page.innerText("[data-send-submit]");

    await t.step("multi transfer: the native coin", async () => {
        const { page, errors } = await t.open("#/send", { wallet: "demo" });
        await t.panelButton(page, "+1000 USDT");
        await t.panel(page, false);
        await page.waitForSelector("[data-send-text]");
        t.check("send: page head, the chain's coin picked first", (await page.innerText("main h1")).includes("many wallets") && (await page.innerText("[data-send-coin]")).includes(N));
        const reads = await t.reads(page);
        t.check("send: one read for the page", reads.page === 1 || reads.total === 1, JSON.stringify(reads.calls));
        t.check("send: nothing to send yet", (await button(page)) === "Add wallets to the list");

        // A list with a mistake on line 3 and a heading on line 1
        const [ a, b, c ] = fresh(3);
        await page.fill("[data-send-text]", `address,amount\n${a}, 1.5\n0x1234, 2\n${b} 2\n${c}=0.5\n${a};1`);
        const problems = await page.innerText("[data-send-problems]");
        t.check("send: a bad line is listed by its number; the heading is skipped", /1 line to fix/.test(problems) && /Line 3/.test(problems) && /not a wallet address/.test(problems), problems.replace(/\s+/g, " "));
        t.check("send: cannot send until it is fixed", (await button(page)) === "Fix 1 line first" && (await page.locator("[data-send-submit][disabled]").count()) === 1);
        t.check("send: the box keeps focus while the list is checked", await page.evaluate(() => document.activeElement?.hasAttribute("data-send-text")));
        await page.fill("[data-send-text]", `${a}, 1.5\n${b} 2\n${c}=0.5\n${a};1`);
        t.check("send: a wallet listed twice is pointed out", (await page.innerText("[data-send-duplicates]")).includes("2 times"));
        await page.click("[data-send-merge]");
        await page.waitForTimeout(300);
        const merged = (await page.inputValue("[data-send-text]")).split("\n");
        t.check("send: Merge makes one line each, amounts added (2.5)", merged.length === 3 && merged.at(0) === `${a}, 2.5` && (await page.locator("[data-send-duplicates]").count()) === 0, merged.join(" | "));
        const summary = await page.innerText("[data-send-summary]");
        t.check("send: summary: 3 wallets, 1 transaction, total 5, a fee, balance after", /Wallets\s+3/i.test(summary) && /Transactions\s+1/i.test(summary) && /Total\s+5/i.test(summary) && /Network fee\s+about/i.test(summary) && /After sending\s+[0-9,]/i.test(summary), summary.replace(/\s+/g, " "));
        t.check("send: the button says what happens", (await button(page)) === "Send 3 wallets");
        await page.click("[data-send-submit]");
        const sent = await t.toast(page, [ "Transfer done", "Something went wrong" ]);
        t.check("send: sent in one transaction", sent.includes("Transfer done") && sent.includes("3 wallets"), sent.split("\n")[0]);
        t.check("send: each wallet got its amount on the chain (2.5, 2, 0.5)", (await nativeOf(a)) === units("2.5") && (await nativeOf(b)) === units(2) && (await nativeOf(c)) === units("0.5"));
        await t.settle(page);
        t.check("send: after sending, the same list shows All sent (no double send)", (await button(page)) === "All sent");
        await collect(page, errors);
    });

    await t.step("multi transfer: a token to 250 wallets", async () => {
        const { page, errors } = await t.open("#/send", { wallet: "demo" });
        // 200 token transfers use about 2.2M gas (Bluewolfchain gas table): the demo wallet needs more coin for the fee
        for (let i = 0; i < 8; i++) await t.panelButton(page, "(gas)");
        await t.panel(page, false);
        await page.waitForSelector("[data-send-text]");
        await page.click("[data-send-coin]");
        await page.click("[data-pick-label='USDT']");
        await page.waitForSelector("[data-send-coin] >> text=USDT");
        t.check("send: the coin list switches to USDT (balance shown)", /[0-9]/.test(await page.innerText("[data-send-balance]")));

        const many = fresh(250);
        await page.click("[data-send-same]");
        await page.waitForSelector("[data-send-same-amount]");
        await page.fill("[data-send-same-amount]", "2");
        await page.fill("[data-send-text]", many.join("\n"));
        const summary = await page.innerText("[data-send-summary]");
        t.check("send: same amount for everyone: 250 wallets, 500 USDT, 2 transactions", /Wallets\s+250/i.test(summary) && /Transactions\s+2/i.test(summary) && /Total\s+500/i.test(summary), summary.replace(/\s+/g, " ").slice(0, 200));
        t.check("send: the two transactions are listed (1–200, 201–250)", (await page.locator("[data-send-batch]").count()) === 2 && (await page.innerText("[data-send-batch='2']")).includes("201–250"));
        t.check("send: a token says it approves first", (await button(page)) === "Approve and send 250 wallets in 2 transactions", await button(page));
        await page.fill("[data-send-same-amount]", "100");
        t.check("send: more than the wallet has is refused before signing", (await button(page)) === "Not enough USDT");
        await page.fill("[data-send-same-amount]", "2");
        await page.click("[data-send-submit]");
        const sent = await t.toast(page, [ "Transfer done", "Something went wrong" ], 120_000);
        t.check("send: approve + 2 transactions, all sent", sent.includes("Transfer done") && sent.includes("250 wallets"), sent.split("\n")[0]);
        t.check("send: the first and the last wallet got 2 USDT", (await usdtOf(many.at(0))) === units(2) && (await usdtOf(many.at(249))) === units(2) && (await usdtOf(many.at(200))) === units(2));
        await t.settle(page);
        t.check("send: both transactions marked Sent, with explorer links", (await page.locator("[data-send-batch][data-sent='yes']").count()) === 2 && (await page.locator("[data-send-batch] a[href*='tx/']").count()) === 2,
            (await page.locator("[data-send-batch-list]").innerText().catch(() => "no list")).replace(/\s+/g, " ").slice(0, 200) + " | " + (await page.locator("[data-send-batch] a").first().getAttribute("href").catch(() => "")));

        // A CSV file goes into the box
        await page.click("[data-send-same]");
        await page.waitForSelector("[data-send-same-amount]", { state: "detached" });
        const [ x, y ] = fresh(2);
        await page.setInputFiles("[data-send-file]", { name: "list.csv", mimeType: "text/csv", buffer: Buffer.from(`﻿address,amount\r\n${x},1\r\n${y},2\r\n`) });
        await page.waitForFunction(() => document.querySelector("[data-send-text]")?.value.includes("address,amount"));
        t.check("send: a CSV file is read into the list (heading skipped): 2 wallets, 3 USDT", /Wallets\s+2/i.test(await page.innerText("[data-send-summary]")) && /Total\s+3/i.test(await page.innerText("[data-send-summary]")));
        await page.click("[data-send-clear]");
        await page.waitForTimeout(300);
        t.check("send: Clear empties the list", (await page.inputValue("[data-send-text]")) === "");

        // An address that is not a token
        await page.click("[data-send-coin]");
        await page.fill(".fixed [data-search]", fresh(1).at(0));
        await page.click("[data-pick='__free__']");
        await page.waitForSelector("main [role=alert]");
        t.check("send: an address that is not a token is explained", (await page.innerText("main [role=alert]")).includes("not a token"));
        await collect(page, errors);
    });

    await t.step("multi transfer layout", async () => {
        const problems = await t.layout([ "#/send" ]);
        t.check("layout: multi transfer fits 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("send: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("send: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
