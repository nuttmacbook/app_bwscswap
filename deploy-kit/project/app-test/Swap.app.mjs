/*
 * YOUR CODE (app tests). The exchange in a real browser, the way people use it: landing → swap (native coin in and out,
 * a token with approval, wrap / unwrap) → pools (search, open a pair, add / take out with the native coin), the owner's
 * "New pair", pausing, a wallet like MetaMask, and every page at every width.
 * Runs on the mock node (npm run test:app) or the real node (npm run test:app:real). Engine: deploy-kit/engine/app-test.mjs.
 */

import { utils } from "bwscbox";

export default async function (t) {
    const N = t.local.LOCAL_COIN_SYMBOL;   // the native coin on the test chain
    const W = "wBWSC";
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const button = (page) => page.innerText("[data-swap-button]");
    const pick = async (page, side, label) => {
        await page.click(`[data-pick-${side}]`);
        await page.click(`[data-pick-label="${label}"]`);
        await page.waitForTimeout(250);
    };
    const balanceIn = async (page, side) => {
        const text = await page.evaluate((s) => document.querySelector(`[data-pick-${s}]`).closest(".rounded-2xl").innerText, side);
        return Number(text.match(/Balance ([0-9,.]+)/)[1].replace(/,/g, ""));
    };

    /* ------------------------------------ landing */

    await t.step("home: the chain's landing page", async () => {
        const { page, errors } = await t.open("#/");
        const reads = await t.reads(page);
        t.check("home: one read (the chain's live numbers)", reads.total === 1, JSON.stringify(reads.calls));
        const text = await page.innerText("main");
        t.check("home: says what the chain is: JavaScript programs, 2-second blocks, EVM wallets", /Smart contracts\s+in JavaScript/.test(text) && /every two seconds/.test(text) && /EVM wallets/.test(text));
        const network = await page.innerText("[data-network]");
        t.check("home: live numbers from the node (latest block, block time, base fee, chain id)", /Latest block\s+#[0-9,]+/i.test(network) && /2 s/.test(network) && /Base fee\s+[0-9,]+/i.test(network)
            && network.includes(String(t.local.LOCAL_CHAIN_ID)), network.replace(/\s+/g, " ").slice(0, 160));
        t.check("home: the chain's capabilities (2 large + 6)", (await page.locator("[data-capabilities] > li").count()) === 8 && /EIP-712/.test(text) && /Merkle/.test(text) && /burned/.test(text));
        t.check("home: code examples are real code blocks (highlighted, numbered, copyable)", (await page.locator("main [data-code]").count()) === 3 && (await page.locator("main [data-code] .tok-kw").count()) > 5 && (await page.locator("main [data-code] .code-ln").count()) > 20);
        t.check("home: the hero's code block has the running edge light", (await page.locator(".glow-edge [data-code]").count()) === 1);
        t.check("home: apps as a summary (counts and categories), not a list of app cards", (await page.locator("[data-home-apps] [data-app]").count()) === 0 && /One chain, many apps/.test(text) && (await page.locator("[data-home-category]").count()) >= 1);
        const details = await page.innerText("[data-network-details]");
        t.check("home: network details for a wallet (RPC = node /evm, chain id, symbol)", details.includes(`${t.node}/evm`) && details.includes(String(t.local.LOCAL_CHAIN_ID)) && details.includes(N));
        await page.click("[data-code] button[aria-label='Copy code'] >> nth=0").catch(() => {});
        await page.click("text=Add automatically");
        await page.waitForSelector(".bwscbox-card");
        t.check("home: 'Add to wallet' with no wallet connected opens the connect window", true);
        await page.keyboard.press("Escape");
        await page.click("[data-hero-docs]");
        await page.waitForSelector("[data-docs-article]");
        t.check("home: Read the docs opens the docs", page.url().includes("#/docs"));
        await collect(page, errors);
    });

    /* ------------------------------------ swap */

    await t.step("swap: native coin, token, wrap", async () => {
        const { page, errors } = await t.open("#/swap", { wallet: "demo" });
        t.check("swap: starts on the native coin → the token it pairs with", (await page.innerText("[data-pick-from]")).includes(N) && (await page.innerText("[data-pick-to]")).includes("USDT"));
        await page.click("[data-pick-from]");
        const listed = await page.locator("[data-pick]").evaluateAll((els) => els.map((el) => el.dataset.pickLabel));
        t.check("swap: the list is the native coin and every token in a pair", [ N, "USDT", W ].every((s) => listed.includes(s)) && listed.length === 3, listed.join(", "));
        await page.fill("[data-search]", "usd");
        t.check("swap: the list is searchable", (await page.locator("[data-pick]").count()) === 1);
        await page.keyboard.press("Escape");

        const readsBefore = (await t.reads(page)).total;
        await page.fill("[data-swap-in]", "2");
        await page.waitForTimeout(200);
        const details = await page.innerText("[data-swap-details]");
        t.check("swap: preview shows rate, route, fee and the minimum you get", /You get at least\s+[0-9,.]+/.test(details) && details.includes("Route") && details.includes("Pair fee"));
        t.check("swap: typing does not read the chain", (await t.reads(page)).total === readsBefore);
        t.check("swap: the native coin needs no approval", (await button(page)) === "Swap");
        const n0 = await balanceIn(page, "from");
        await page.click("[data-swap-button]");
        const toast = await t.toast(page, [ "Swap confirmed", "Something went wrong", "Cancelled" ]);
        t.check(`swap: ${N} → USDT confirmed`, toast.includes("Swap confirmed"), toast.split("\n")[0]);
        t.check("swap: toast links the transaction", (await page.locator("#toast a", { hasText: "Explorer" }).count()) === 1);
        await t.settle(page);
        t.check(`swap: 2 ${N} (plus gas) left the wallet`, n0 - (await balanceIn(page, "from")) >= 2);
        t.check("swap: the form is cleared after the swap", (await page.inputValue("[data-swap-in]")) === "");

        await page.click("button[aria-label='Switch direction']");
        await page.fill("[data-swap-in]", "abc");
        t.check("swap: text is refused with a plain message", (await button(page)) === "Enter a number, like 1.5" && await page.isDisabled("[data-swap-button]"));
        await page.fill("[data-swap-in]", "999999999");
        t.check("swap: more than the balance → 'Not enough USDT'", (await button(page)) === "Not enough USDT");
        await page.fill("[data-swap-in]", "10");
        t.check("swap: a token needs an approval first", (await button(page)) === "Approve & swap");
        await page.click("[data-swap-button]");
        const back = await t.toast(page, [ "Swap confirmed", "Something went wrong" ]);
        t.check(`swap: USDT → ${N} confirmed (paid out as the native coin)`, back.includes("Swap confirmed"), back.split("\n")[0]);
        await t.settle(page);
        await page.fill("[data-swap-in]", "1");
        t.check("swap: no allowance left over (asks to approve again)", (await button(page)) === "Approve & swap");

        // Wrap and unwrap
        await pick(page, "from", N);
        await pick(page, "to", W);
        await page.fill("[data-swap-in]", "1");
        t.check(`wrap: ${N} → ${W} is a 1 : 1 wrap with no fee`, (await button(page)) === `Wrap ${N}` && (await page.inputValue("[data-swap-out]")) === "1" && (await page.innerText("[data-swap-details]")).includes("none"));
        const w0 = await balanceIn(page, "to");
        await page.click("[data-swap-button]");
        t.check("wrap: confirmed", (await t.toast(page, [ "Wrapped", "Something went wrong" ])).includes("Wrapped"));
        await t.settle(page);
        t.check(`wrap: +1 ${W}`, (await balanceIn(page, "to")) - w0 === 1);
        await page.click("button[aria-label='Switch direction']");
        await page.fill("[data-swap-in]", "1");
        t.check(`unwrap: ${W} → ${N}`, (await button(page)) === `Unwrap to ${N}`);
        await page.click("[data-swap-button]");
        t.check("unwrap: confirmed", (await t.toast(page, [ "Unwrapped", "Something went wrong" ])).includes("Unwrapped"));
        await collect(page, errors);
    });

    await t.step("swap: settings, exact out, price impact", async () => {
        const { page, errors } = await t.open("#/swap", { wallet: "demo" });
        await pick(page, "from", N);
        await pick(page, "to", "USDT");
        // Settings (gear): your own slippage and deadline, remembered in this browser
        await page.click("[data-swap-gear]");
        t.check("settings: the gear opens slippage and deadline", (await page.locator("[data-swap-settings]").count()) === 1);
        await page.fill("[data-slippage-custom]", "0.01");
        await page.dispatchEvent("[data-slippage-custom]", "change");
        t.check("settings: a very low slippage warns that the swap may fail", (await page.innerText("[data-slippage-warning]")).includes("may fail"));
        await page.fill("[data-slippage-custom]", "0.3");
        await page.dispatchEvent("[data-slippage-custom]", "change");
        await page.fill("[data-deadline]", "5");
        await page.dispatchEvent("[data-deadline]", "change");
        await page.fill("[data-swap-in]", "1");
        await page.waitForTimeout(150);
        t.check("settings: the quote uses them (0.3% · 5 min)", (await page.innerText("[data-swap-details]")).includes("0.3% · 5 min"));
        await page.reload();
        await page.waitForSelector("[data-swap-gear]");
        t.check("settings: still 0.3% after a reload (kept in this browser)", (await page.innerText("[data-swap-gear]")).includes("0.3%"));

        // Exact out: type what you want in "You get"
        await pick(page, "from", N);
        await pick(page, "to", "USDT");
        await page.fill("[data-swap-out]", "5");
        await page.waitForTimeout(150);
        const details = await page.innerText("[data-swap-details]");
        const pays = await page.inputValue("[data-swap-in]");
        t.check("exact out: typing in 'You get' fills what you pay, and says the most you pay", Number(pays) > 0 && /You pay at most\s+[0-9,.]+/.test(details) && (await page.innerText("[data-swap-label='to']")) === "You get", `${pays}`);
        const u0 = await balanceIn(page, "to");
        await page.click("[data-swap-button]");
        const done = await t.toast(page, [ "Swap confirmed", "Something went wrong" ]);
        await t.settle(page);
        const got = (await balanceIn(page, "to")) - u0;
        t.check("exact out: 5 USDT arrive (swapExactOut on the chain)", done.includes("Swap confirmed") && got >= 4.9999 && got <= 5.0001, `${got}`);

        // A big trade: warning, then the button asks to confirm before it swaps (the owner wallet holds enough coins)
        await t.panelButton(page, "Demo wallet = owner");
        await t.panel(page, false);
        await page.waitForTimeout(500);
        await page.fill("[data-swap-in]", "50000");
        await page.waitForTimeout(150);
        t.check("price impact: a big trade shows a warning", (await page.locator("[data-impact-warning]").count()) === 1);
        t.check("price impact: from 15% the button asks to confirm first", /^Price impact [0-9.]+%: tap to confirm$/.test(await button(page)), await button(page));
        await page.click("[data-swap-button]");
        t.check("price impact: after the tap it says 'Swap anyway'", (await button(page)) === "Swap anyway");
        await page.fill("[data-swap-in]", "1");
        t.check("price impact: a normal amount asks nothing extra", (await button(page)) === "Swap");
        // Back to the defaults for the other tests
        await page.click("[data-swap-gear]");
        await page.click("[data-swap-settings] button[aria-pressed]:has-text('0.5%')");
        await page.fill("[data-deadline]", "20");
        await page.dispatchEvent("[data-deadline]", "change");
        await collect(page, errors);
    });

    /* ------------------------------------ pools */

    await t.step("pools: list, search, a position with the native coin", async () => {
        const { page, errors } = await t.open("#/pool", { wallet: "demo" });
        t.check("pools: one row per pair, the wBWSC side shown as the native coin", (await page.locator("[data-pair]").count()) === 1 && (await page.innerText("[data-pair-list]")).includes(N));
        await page.fill("[data-pool-search]", "zzz");
        t.check("pools: search with no match says so", (await page.innerText("[data-pair-list]")).includes("No pair matches"));
        await page.fill("[data-pool-search]", N.toLowerCase());
        t.check("pools: searching the native coin finds its pair", (await page.locator("[data-pair]").count()) === 1);
        await page.click("[role=tab]:has-text('My positions')");
        t.check("pools: 'My positions' is empty before a deposit", (await page.innerText("[data-pair-list]")).includes("no liquidity yet"));
        await page.click("[role=tab]:has-text('All pairs')");
        await page.fill("[data-pool-search]", "");
        await page.click("[data-pair] >> text=Open");
        await page.waitForSelector("[data-add-a]");
        t.check("pool: a pair with wBWSC offers the native coin or the wrapped token", (await page.locator(`[role=tab]:has-text("${N}")`).count()) === 1 && (await page.locator(`[role=tab]:has-text("${W}")`).count()) === 1);
        const label = await page.innerText("main h1");
        const nativeIsA = label.trim().startsWith(N);
        await page.fill(nativeIsA ? "[data-add-a]" : "[data-add-b]", "1");
        const paired = await page.inputValue(nativeIsA ? "[data-add-b]" : "[data-add-a]");
        t.check(`pool: typing ${N} fills USDT at the pair's price`, Number(paired) > 0, `${paired} USDT`);
        const add = await page.innerText("[data-add-button]");
        t.check("pool: only USDT needs an approval (the native coin goes as value)", add === "Approve & add (2 steps)" || add === "Add liquidity", add);
        await page.click("[data-add-button]");
        const added = await t.toast(page, [ "Liquidity added", "Something went wrong" ], 90_000);
        t.check("pool: liquidity added with the native coin", added.includes("Liquidity added"), added.split("\n")[0]);
        await t.settle(page);
        // What the position can take out (more digits than the share in percent)
        const share = async () => Number(((await page.innerText("section[aria-label='Your position']")).match(/USDT you can take out\s+([0-9.,]+)/)?.[1] ?? "0").replace(/,/g, ""));
        const before = await share();
        t.check("pool: position shows what you can take out", before > 0, `${before} USDT`);
        await page.click("button:has-text('25%')");
        await page.click("text=Take out 25%");
        const removed = await t.toast(page, [ "Liquidity taken out", "Something went wrong" ]);
        t.check("pool: 25% taken out", removed.includes("Liquidity taken out"), removed.split("\n")[0]);
        await t.settle(page);
        const after = await share();
        t.check("pool: about 75% of the position is left", Math.abs(after / before - 0.75) < 0.01, `${before} → ${after} USDT`);
        await page.click("text=All pools");
        await page.click("[role=tab]:has-text('My positions')");
        t.check("pools: 'My positions' now lists the pair", (await page.locator("[data-pair]").count()) === 1);
        await collect(page, errors);
    });

    /* ------------------------------------ owner */

    await t.step("owner: new pair, pause", async () => {
        const { page, errors } = await t.open("#/pool", { wallet: "demo" });
        t.check("pools: someone who is not the owner sees no 'New pair'", (await page.locator("section[aria-label='New pair']").count()) === 0);
        await t.panel(page, true);
        await t.panelButton(page, "Demo wallet = owner");
        await page.waitForSelector("section[aria-label='New pair']", { timeout: 30_000 });
        await t.panel(page, false);
        await page.click("[data-new-a]");
        await page.click(`[data-pick-label="${N}"]`);
        await page.click("[data-new-b]");
        await page.fill("[data-search]", "0x00000000000000000000000000000000000000ab");
        t.check("new pair: a pasted address can be used (a token not in the list)", (await page.locator("[data-pick='__free__']").count()) === 1);
        await page.fill("[data-search]", "usdt");
        await page.click(`[data-pick-label="USDT"]`);
        t.check(`new pair: ${N} / USDT exists already → said, and Create is off`, (await page.innerText("[data-new-note]")).includes("exists already") && await page.isDisabled("text=Create pair"));

        await t.panelButton(page, "Pause / resume swaps (owner)");
        await t.panel(page, false);
        await page.goto(page.url().replace(/#.*$/, "#/swap"));
        await page.waitForSelector("text=Swaps are paused by the owner");
        await page.fill("[data-swap-in]", "1");
        t.check("paused: the swap button is off", (await button(page)) === "Swaps are paused" && await page.isDisabled("[data-swap-button]"));
        await t.panelButton(page, "Pause / resume swaps (owner)");
        await page.evaluate(() => window.refreshPage());
        await page.waitForTimeout(800);
        t.check("paused: resumed", !(await page.innerText("main")).includes("paused by the owner"));
        await collect(page, errors);
    });

    /* ------------------------------------ no wallet, and a wallet like MetaMask */

    await t.step("visitor without a wallet", async () => {
        const { page, errors } = await t.open("#/swap");
        t.check("no wallet: the main button asks to connect", (await button(page)) === "Connect wallet");
        await page.click("[data-swap-button]");
        await page.waitForSelector(".bwscbox-card");
        t.check("no wallet: the connect window says how to get one", (await page.innerText(".bwscbox-card")).includes("No wallet found"));
        await page.keyboard.press("Escape");
        await collect(page, errors);
    });

    await t.step("injected wallet", async () => {
        const { page, errors } = await t.open("#/swap", { wallet: "injected" });
        await page.click("header button[aria-label='Connect wallet']");
        await page.click(".bwscbox-item:has-text('Test Wallet')");
        await page.waitForFunction(() => document.querySelector("header [data-wallet-button]")?.getAttribute("aria-label") === "Wallet menu");
        const asked = await page.evaluate(() => ({ added: window.testWallet.addedParams, chain: window.testWallet.chain, log: window.testWallet.log }));
        t.check("wallet: connecting asks for no chain switch (the wallet stays on Ethereum)", asked.added === null && asked.chain === "0x1" && !asked.log.includes("wallet_switchEthereumChain"), JSON.stringify(asked.log));
        await t.panelButton(page, "(gas)");
        await t.panel(page, false);
        const u0 = await t.balanceOf("USDT", t.walletAddress);
        await page.fill("[data-swap-in]", "1");
        await page.click("[data-swap-button]");
        const done = await t.toast(page, [ "Swap confirmed", "Something went wrong", "Cancelled" ]);
        t.check("wallet: swap signed by the wallet (EIP-712) while it is on Ethereum, and confirmed", done.includes("Swap confirmed") && (await page.evaluate(() => window.testWallet.chain)) === "0x1", done.split("\n")[0]);
        const signs = (await page.evaluate(() => window.testWallet.log)).filter((m) => m === "eth_signTypedData_v4").length;
        t.check("wallet: one signature (the native coin needs no approval)", signs === 1, `${signs}`);
        t.check("wallet: USDT really arrived on chain", (await t.balanceOf("USDT", t.walletAddress)) > u0);

        await t.settle(page);
        // Clicking again while the popup is working sends nothing more (no double swap)
        await page.fill("[data-swap-in]", "1");
        await page.evaluate(() => { const b = document.querySelector("[data-swap-button]"); b.click(); b.click(); b.click(); });
        t.check("wallet: three quick clicks → one swap, the button is dimmed meanwhile", (await page.evaluate(() => document.body.classList.contains("tx-busy")))
            && (await t.toast(page, [ "Swap confirmed", "Something went wrong" ])).includes("Swap confirmed")
            && (await page.evaluate(() => window.testWallet.log)).filter((m) => m === "eth_signTypedData_v4").length === signs + 1);
        await t.settle(page);
        await page.evaluate(() => { window.testWallet.rejectNext = "eth_signTypedData_v4"; });
        await page.fill("[data-swap-in]", "1");
        await page.click("[data-swap-button]");
        t.check("wallet: closing the wallet prompt → 'Cancelled', nothing sent", (await t.toast(page, [ "Cancelled", "Swap confirmed", "Something went wrong" ])).includes("Cancelled"));

        // Any chain can sign for BWSC: on BNB Smart Chain there is no "Wrong network", and a swap still goes through
        await t.settle(page);
        await page.evaluate(() => { window.testWallet.added.push("0x38"); window.testWalletSwitchChain("0x38"); });
        await page.waitForTimeout(400);
        await page.fill("[data-swap-in]", "1");
        await page.click("[data-swap-button]");
        const onBsc = await t.toast(page, [ "Swap confirmed", "Something went wrong" ]);
        t.check("wallet: on another chain (BSC) → no 'Wrong network', the swap still signs and confirms", onBsc.includes("Swap confirmed") && !(await page.innerText("header")).includes("Wrong network"), onBsc.split("\n")[0]);
        await t.settle(page);
        await page.click("header [data-wallet-button]");
        await page.click("[data-disconnect]");
        await page.waitForFunction(() => document.querySelector("header [data-wallet-button]")?.getAttribute("aria-label") === "Connect wallet");
        t.check("wallet: disconnect", true);
        await collect(page, errors);
    });

    await t.step("layout", async () => {
        const problems = await t.layout([ "#/", "#/swap", "#/pool" ]);
        t.check("layout: no overflow, inputs ≥ 16px on phones, even cards (320–1366 px)", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
    void utils;
}
