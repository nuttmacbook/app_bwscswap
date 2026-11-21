/*
 * YOUR CODE (app tests). The bridge page with real chains: the BWSC hub, the local BSC and a second EVM chain (anvil),
 * and the bridge signer with its relayer for both. Coins arrive BY THEMSELVES (automatic delivery, nobody presses
 * "claim"): both directions with the demo wallet (a token one way, the native coin back as BEP-20), the second chain
 * both ways, "On the way" rows on several chains at once while the relayer is held (and "Claim now" by hand as the
 * fallback), the "Arrived" toast, every chain in the pickers, the "two other chains go through the hub" note, and
 * BSC → BWSC with an injected wallet that switches between the chains.
 * Without anvil the page must say the BSC side is not set up (and nothing else breaks).
 */

import { ethers } from "ethers";

const units = (text) => ethers.parseUnits(String(text), 18);

export default async function (t) {
    const allErrors = [];
    const thaiLines = [];
    const collect = async (page, errors) => { allErrors.push(...errors); thaiLines.push(...await t.thai(page)); };
    const button = (page) => page.innerText("[data-bridge-button]");
    const pickToken = async (page, label) => { await page.click("[data-bridge-token]"); await page.click(`[data-pick-label="${label}"]`); await page.waitForTimeout(250); };
    const chainKey = (text) => (text.includes("BNB Smart Chain") ? "bsc" : text.includes("Ethereum") ? "eth" : "bwsc");
    const fromChain = async (page) => chainKey(await page.innerText("[data-bridge-from]"));
    const toChain = async (page) => chainKey(await page.innerText("[data-bridge-to]"));
    const pickChain = async (page, side, label) => { await page.click(`[data-bridge-${side}]`); await page.click(`[data-pick-label="${label}"]`); await page.waitForTimeout(250); };
    const N = t.local.LOCAL_COIN_SYMBOL;
    /** Waits until `read()` changes from `before` (the relayer delivers within seconds) */
    const changes = async (read, before, ms = 45_000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { const now = await read(); if (now !== before) return now; await new Promise((r) => setTimeout(r, 500)); }
        return before;
    };
    const demoAddress = async (page) => { const key = await page.evaluate(() => localStorage.getItem("bwsc.local.demoKey")); return key ? new ethers.Wallet(key).address.toLowerCase() : ""; };
    const nothingOnTheWay = (page) => page.waitForSelector("[data-waiting-count='0']", { timeout: 20_000 }).then(() => true).catch(() => false);

    if (!t.bsc) {
        await t.step("bridge without a BSC", async () => {
            const { page, errors } = await t.open("#/bridge");
            t.check("bridge: without anvil the page says what is missing", (await page.innerText("main")).includes("not set up"));
            await collect(page, errors);
        });
        t.check("bridge pages: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
        return;
    }

    const { anvil, contracts, tokens, addresses } = t.bsc;
    const BSC_USDT = tokens.USDT.address;
    const bscBalance = (token, who) => new ethers.Contract(token, contracts.MockToken.abi, anvil.provider).balanceOf(who);
    const bwscUsdt = (who) => t.client.query({ program: t.deployed.addresses.USDT, method: "balanceOf", input: { who } });

    /* ------------------------------------ demo wallet: BSC → BWSC (USDT) */

    await t.step("bridge in with the demo wallet", async () => {
        const { page, errors } = await t.open("#/bridge", { wallet: "demo" });
        await t.panelButton(page, "+1 BNB on BSC");
        await t.panelButton(page, "+1000 USDT on BSC");
        await t.panel(page, false);
        t.check("bridge: starts BWSC → the other chain", (await fromChain(page)) === "bwsc");
        await page.click("[aria-label='Switch direction']");
        await page.waitForTimeout(300);
        t.check("bridge: flipped to BSC → BWSC", (await fromChain(page)) === "bsc");
        await pickToken(page, "USDT");
        await page.fill("[data-bridge-in]", "1");
        t.check("bridge: below the minimum is refused before signing", (await button(page)) === "At least 5 USDT");
        await page.fill("[data-bridge-in]", "5000");
        t.check("bridge: more than the BSC balance is refused", (await button(page)) === "Not enough USDT");
        await page.fill("[data-bridge-in]", "100");
        t.check("bridge: approve and bridge in one go", (await button(page)) === "Approve & bridge to Bluewolfchain", await button(page));
        t.check("bridge: you receive 99.9 (0.1% fee) as a token on BWSC", /You receive\s+99\.9 USDT/.test(await page.innerText("[data-bridge-summary]")) && /Arrives as\s+token on Bluewolfchain/.test(await page.innerText("[data-bridge-summary]")));
        t.check("bridge: the page says it arrives by itself, nothing to claim", /arrives in your wallet on Bluewolfchain by itself[^]*nothing to claim/.test(await page.innerText("[data-bridge-how]")), await page.innerText("[data-bridge-how]"));
        const me = await demoAddress(page);
        const u0 = await bwscUsdt(me);
        await page.click("[data-bridge-button]");
        const locked = await t.toast(page, [ "Sent to the bridge", "Something went wrong" ]);
        t.check("bridge: sent on BSC, the toast says it arrives by itself", locked.includes("Sent to the bridge") && locked.includes("by itself"), locked.split("\n")[0]);
        const u1 = await changes(() => bwscUsdt(me), u0);
        t.check("auto: 99.9 USDT arrived on BWSC without a claim", u1 - u0 === units("99.9"), String(u1 - u0));
        t.check("auto: the page shows nothing on the way any more (it reads again by itself)", await nothingOnTheWay(page));
        t.check("bridge: totals show 99.9 in and 99.9 claimed", /USDT[^\n]*\s+99\.9\s+99\.9/.test(await page.innerText("[aria-label='Your bridge totals']")));

        /* BWSC → BSC: the native coin */
        await page.click("[aria-label='Switch direction']");
        await page.waitForTimeout(300);
        await pickToken(page, N);
        t.check("bridge: flipped to BWSC → BSC, the native coin arrives as a token there", (await fromChain(page)) === "bwsc" && /Arrives as\s+token on BNB Smart Chain/.test(await page.innerText("[data-bridge-summary]")));
        await page.click("text=Max");
        await page.waitForTimeout(200);
        const max = Number(await page.inputValue("[data-bridge-in]"));
        t.check("bridge: Max keeps 0.01 for gas", max > 0 && (await button(page)).startsWith("Bridge to"), String(max));
        await page.fill("[data-bridge-in]", "5");
        const c0 = await bscBalance(tokens.tBWSC.address, me);
        await page.click("[data-bridge-button]");
        t.check("bridge: native coins sent from BWSC", (await t.toast(page, [ "Sent to the bridge", "Something went wrong" ])).includes("Sent"));
        const c1 = await changes(() => bscBalance(tokens.tBWSC.address, me), c0);
        t.check("auto: 4.995 BWSC (BEP-20) arrived on BSC without a claim", c1 - c0 === units("4.995"), String(c1 - c0));
        await nothingOnTheWay(page);
        t.check("bridge: totals show 4.995 out and claimed", /4\.995\s+4\.995/.test(await page.innerText("[aria-label='Your bridge totals']")));
        await collect(page, errors);
    });

    /* ------------------------------------ more than one other chain */

    const second = t.moreChains[0];
    t.check("bridge: a second chain runs next to BSC (the bridge is tested with several chains)", Boolean(second));
    if (second) await t.step("bridge with several chains", async () => {
        const E = second.chain;
        const eBalance = (symbol, who) => new ethers.Contract(second.tokens[symbol].address, contracts.MockToken.abi, second.anvil.provider).balanceOf(who);
        const { page, errors } = await t.open("#/bridge", { wallet: "demo" });
        await t.panelButton(page, `+1 ETH on ${E.short}`);
        await t.panelButton(page, `+1000 USDT on ${E.short}`);
        await t.panel(page, false);

        // Head and routes list name every chain
        const head = await page.innerText("main h1");
        t.check("chains: the page head counts the chains, no single chain named", /2 chains/.test(head), head);
        const routes = await page.innerText("[data-bridge-routes]");
        t.check("chains: the list shows both chains and their coins", routes.includes("BNB Smart Chain (local)") && routes.includes(E.name) && (await page.locator("[data-route-chain]").count()) === 2 && (await page.locator("[data-route^='eth:']").count()) === 2);
        t.check("chains: both chains are open", (await page.locator("[data-route-status='on']").count()) === 2);

        // The From picker lists every chain (the hub too)
        await page.click("[data-bridge-from]");
        const labels = await page.$$eval("[data-pick]", (els) => els.map((e) => e.getAttribute("data-pick-label")));
        t.check("picker: From lists the hub and both chains", [ "Bluewolfchain", "BNB Smart Chain (local)", E.name ].every((l) => labels.includes(l)), labels.join(", "));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);

        // To = the second chain; then From = BSC → no direct route: the hub goes on the other side, with a note
        await pickChain(page, "to", E.name);
        t.check("picker: To = the second chain, From stays the hub", (await fromChain(page)) === "bwsc" && (await toChain(page)) === "eth");
        await pickChain(page, "from", "BNB Smart Chain (local)");
        const note = await page.innerText("[data-bridge-note]").catch(() => "");
        t.check("picker: two other chains → From BSC, To the hub, and a note to go through the hub", (await fromChain(page)) === "bsc" && (await toChain(page)) === "bwsc" && note.includes("do not bridge directly"), note);
        await pickChain(page, "from", "Bluewolfchain");
        t.check("picker: picking the chain on the other side swaps the two", (await fromChain(page)) === "bwsc" && (await toChain(page)) === "bsc");

        // The relayer is held for a moment: transfers stay "On the way", and "Claim now" works by hand (the fallback)
        t.relayer?.pause();
        // A route from the list: BWSC → the second chain, the native coin
        await page.click(`[data-route="eth:0x0000000000000000000000000000000000000000"]`);
        await page.waitForTimeout(300);
        t.check("list: Use a route → From the hub, To the second chain, the native coin", (await fromChain(page)) === "bwsc" && (await toChain(page)) === "eth" && (await page.innerText("[data-bridge-token]")).includes(N));
        await page.fill("[data-bridge-in]", "5");
        t.check("bridge: to the second chain", (await button(page)) === `Bridge to ${E.name}`, await button(page));
        await page.click("[data-bridge-button]");
        t.check("bridge: native coins sent from BWSC for the second chain", (await t.toast(page, [ "Sent to the bridge", "Something went wrong" ])).includes("Sent"));
        await t.settle(page);

        // Second chain → BWSC (USDT): coins now wait on two chains at once
        await pickChain(page, "from", E.name);
        await pickToken(page, "USDT");
        await page.fill("[data-bridge-in]", "10");
        t.check("bridge: from the second chain to the hub", (await toChain(page)) === "bwsc" && (await button(page)) === "Approve & bridge to Bluewolfchain", await button(page));
        await page.click("[data-bridge-button]");
        const locked = await t.toast(page, [ "Sent to the bridge", "Something went wrong" ]);
        t.check("bridge: sent on the second chain (the demo wallet signs there with the same key)", locked.includes("Sent"), locked.split("\n")[0]);
        await t.settle(page);
        const onEth = await page.innerText("[data-waiting-chain='eth']").catch(() => "");
        const onHub = await page.innerText("[data-waiting-chain='bwsc']").catch(() => "");
        t.check("on the way: each row says it is arriving, with Claim now as the fallback", (await page.locator("[data-arriving]").count()) === 2 && (await page.innerText("[aria-label='On the way']")).includes("Claim now"));
        t.check("on the way: grouped by chain: 4.995 BWSC on the second chain, 9.99 USDT on the hub from it", /4\.995 BWSC/.test(onEth) && new RegExp(`9\\.99 USDT\\s*from ${E.name.replace(/[()]/g, ".")}`).test(onHub), `${onEth} | ${onHub}`.replace(/\s+/g, " "));

        const who = await demoAddress(page);
        const coin0 = who ? await eBalance(N, who) : null;
        await page.click("[data-waiting-chain='eth'] [data-waiting$='-remote'] button");
        const out = await t.toast(page, [ "Claimed", "Something went wrong" ]);
        t.check("claim now (by hand): on the second chain", out.includes("Claimed"), out.split("\n")[0]);
        if (who) t.check("claim now: 4.995 arrived on the second chain", (await eBalance(N, who)) - coin0 === units("4.995"));
        await t.settle(page);

        // The relayer is back: the other one arrives by itself, and the page says so
        const h0 = await bwscUsdt(who);
        await page.waitForTimeout(31_000);   // past the hand claim, so the next arrival gets its own toast
        t.relayer?.resume();
        const arrivedToast = await t.toast(page, [ "Arrived", "Something went wrong" ]).catch(() => "");
        t.check("auto: the relayer delivers the waiting USDT on the hub, the page shows 'Arrived'", arrivedToast.includes("Arrived") && (await bwscUsdt(who)) - h0 === units("9.99"), `${arrivedToast.split("\n")[0]} ${(await bwscUsdt(who)) - h0}`);
        t.check("on the way: nothing left on any chain", await nothingOnTheWay(page) && (await page.innerText("[data-bridge-waiting]")).includes("Nothing on the way"));
        t.check("totals: rows for the second chain by name", (await page.innerText("[aria-label='Your bridge totals']")).includes(E.name));
        await collect(page, errors);
    });

    /* ------------------------------------ an injected wallet that switches chains */

    await t.step("bridge in with an injected wallet", async () => {
        // The wallet gets USDT on BSC straight from the test token (anyone may mint a MockToken)
        await (await new ethers.Contract(BSC_USDT, contracts.MockToken.abi, anvil.wallet(0)).mint(t.walletAddress, units(50))).wait();
        const { page, errors } = await t.open("#/bridge", { wallet: "injected" });
        await page.click("header button[aria-label='Connect wallet']");
        await page.click(".bwscbox-item:has-text('Test Wallet')");
        await page.waitForFunction(() => document.querySelector("header [data-wallet-button]")?.getAttribute("aria-label") === "Wallet menu");
        await t.panelButton(page, "(gas)");
        await t.panel(page, false);
        await page.click("[aria-label='Switch direction']");
        await page.waitForTimeout(300);
        await pickToken(page, "USDT");
        await page.fill("[data-bridge-in]", "20");
        const before = await bwscUsdt(t.walletAddress);
        await page.click("[data-bridge-button]");
        const locked = await t.toast(page, [ "Sent to the bridge", "Something went wrong", "Cancelled" ]);
        t.check("wallet: approve + bridgeIn sent from the wallet on BSC", locked.includes("Sent"), locked.split("\n")[0]);
        const added = await page.evaluate(() => window.testWallet.addedParams);
        t.check("wallet: BSC was added to the wallet with the site's settings", added?.chainId === `0x${anvil.chainId.toString(16)}` && added?.nativeCurrency?.symbol === "BNB");
        const sends = (await page.evaluate(() => window.testWallet.log)).filter((m) => m === "eth_sendTransaction").length;
        t.check("wallet: two BSC transactions (approve, bridgeIn)", sends === 2, String(sends));
        t.check("wallet: stays on BSC afterwards, no 'Wrong network' (BWSC is signed from any chain)", !(await page.innerText("header")).includes("Wrong network"));
        const after = await changes(() => bwscUsdt(t.walletAddress), before);
        t.check("wallet: 19.98 USDT arrived on BWSC by itself (no claim, nothing more to sign)", after - before === units("19.98"));
        t.check("wallet: the wallet signed nothing on BWSC (the relayer sent the claim)", ((await page.evaluate(() => window.testWallet.log)).filter((m) => m === "eth_signTypedData_v4").length) === 0);
        t.check("wallet: the BSC side holds what was locked", (await bscBalance(BSC_USDT, addresses.BwscBridgeEvm)) > 0n);
        await collect(page, errors);
    });

    /* ------------------------------------ fee-free wallets */

    await t.step("bridge: a fee-free wallet", async () => {
        const { page, errors } = await t.open("#/bridge", { wallet: "demo" });
        await t.panel(page, false);
        const me = await demoAddress(page);
        // The owner makes the demo wallet fee-free on both bridges
        await t.send(t.owner, "BwscBridge", "setFeeExempt", { account: me, exempt: true });
        const bscBridge = new ethers.Contract(addresses.BwscBridgeEvm, contracts.BwscBridgeEvm.abi, anvil.wallet(0));
        await (await bscBridge.setFeeExempt(me, true)).wait();
        await page.reload();
        await page.waitForSelector("[data-bridge-in]");
        await pickToken(page, "USDT");
        await page.fill("[data-bridge-in]", "100");
        const out = await page.innerText("[data-bridge-summary]");
        t.check("fee-free: BWSC → BSC shows no fee and the whole 100 arriving", /Bridge fee\s+None: fee-free wallet/.test(out) && /You receive\s+100 USDT/.test(out), out.replace(/\s+/g, " ").slice(0, 160));
        await page.click("[aria-label='Switch direction']");
        await page.waitForTimeout(300);
        await page.fill("[data-bridge-in]", "100");
        const back = await page.innerText("[data-bridge-summary]");
        t.check("fee-free: BSC → BWSC too (read from the BSC bridge)", (await fromChain(page)) === "bsc" && /Bridge fee\s+None: fee-free wallet/.test(back) && /You receive\s+100 USDT/.test(back), back.replace(/\s+/g, " ").slice(0, 160));
        await t.send(t.owner, "BwscBridge", "setFeeExempt", { account: me, exempt: false });
        await (await bscBridge.setFeeExempt(me, false)).wait();
        await page.reload();
        await page.waitForSelector("[data-bridge-in]");
        await pickToken(page, "USDT");
        await page.fill("[data-bridge-in]", "100");
        t.check("fee-free off: the fee is back", /Bridge fee\s+0\.1%/.test(await page.innerText("[data-bridge-summary]")));
        await collect(page, errors);
    });

    /* ------------------------------------ layout */

    await t.step("bridge layout", async () => {
        const problems = await t.layout([ "#/bridge" ]);
        t.check("layout: bridge fits 320–1366 px", problems.length === 0, problems.slice(0, 3).join("; "));
    });

    t.check("bridge pages: no errors in the browser console", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    t.check("bridge pages: no Thai text in the UI", thaiLines.length === 0, thaiLines.slice(0, 2).join(" | "));
}
