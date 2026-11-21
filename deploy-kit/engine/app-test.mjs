/*
 * ENGINE (same in every project, do not edit).
 *
 * npm run test:app: tests the WHOLE app in a real browser (Chromium via playwright), the way a person uses it.
 *   1. starts a local chain: the mock node by default (no chain package needed), or the real node with test:app:real
 *   2. deploys everything in deploy-kit/settings/deploy.config.mjs and adds a little sample data (APP_TEST_SEED)
 *   3. starts the website on APP_TEST_PORT with the test panel (exactly like npm run dev)
 *   4. runs every deploy-kit/project/app-test/*.app.mjs
 *
 *   npm run test:app                       mock node
 *   npm run test:app:real                  the real node (programvm installed in deploy-kit/)
 *   npm run test:app -- --only Swap        files whose name contains "Swap"
 *   npm run test:app -- --headed           watch it happen
 *   PW_CHROMIUM=/path/to/chrome            use a browser already on this computer (otherwise: npx playwright install chromium)
 *
 * A test file:
 *   export default async function (t) {
 *       const { page } = await t.open("#/swap", { wallet: "demo" });
 *       await page.fill("[data-swap-in]", "1");
 *       t.check("what it proves", condition, "optional detail");
 *   }
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { compileAll } from "./compile.mjs";
import { DEV_DIR, ROOT, isMock, devKey, devWallet, startNode, waitForNode, localClient } from "./node.mjs";
import { localSettings } from "./settings.mjs";
import { deployLocal, websiteEnv } from "./local-chain.mjs";
import { startLocalBsc, deployBscLocal, bscWebsiteEnv } from "./bsc/local.mjs";
import * as services from "../project/services.mjs";
import { testConfig } from "../project/app-config.mjs";
import * as project from "../project/seed.mjs";

const TEST_DIR = path.join(DEV_DIR, "project", "app-test");
const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const THAI = /[\u0E00-\u0E7F]/;
const WALLET_KEY_INDEX = 3;   // public test key funded in the genesis; the injected wallet of the tests

const playwright = await import("playwright").catch(() => null);
if (!playwright) {
    console.error("✖ playwright is not installed in deploy-kit/. Run npm install in deploy-kit/, then npx playwright install chromium (or set PW_CHROMIUM).");
    process.exit(1);
}

const local = localSettings();
const results = [];
const children = [];
let node = null;
let bscLocal = null;
let running = null;
const stopAll = () => { children.forEach((c) => { try { c.kill(); } catch {} }); node?.stop(); bscLocal?.anvil?.stop(); running?.stop?.(); };
process.on("SIGINT", () => { stopAll(); process.exit(1); });

/** The browser wallet of the tests: EIP-6963, behaves like MetaMask, signs in Node with a public test key */
const INJECTED_WALLET = ({ address, info }) => {
    const listeners = {};
    const state = window.testWallet = { chain: "0x1", added: [ "0x1" ], log: [], rejectNext: null, addedParams: null };
    const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
    const provider = {
        isMetaMask: true,
        on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); },
        removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
        async request({ method, params }) {
            state.log.push(method);
            if (state.rejectNext === method) { state.rejectNext = null; throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }
            if (method === "eth_requestAccounts" || method === "eth_accounts") return [ address ];
            if (method === "eth_chainId") return state.chain;
            if (method === "wallet_switchEthereumChain") {
                if (!state.added.includes(params[0].chainId)) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
                state.chain = params[0].chainId; emit("chainChanged", state.chain); return null;
            }
            if (method === "wallet_addEthereumChain") { state.addedParams = params[0]; state.added.push(params[0].chainId); state.chain = params[0].chainId; emit("chainChanged", state.chain); return null; }
            if (method === "wallet_revokePermissions") return null;
            if (method === "eth_signTypedData_v4") {
                const typed = JSON.parse(params[1]);
                // MetaMask's rule: a domain WITH a chainId must match the open chain (format 2 has none: signs from any chain)
                if (typed.domain.chainId !== undefined && "0x" + Number(typed.domain.chainId).toString(16) !== state.chain) throw Object.assign(new Error("Provided chainId must match the active chainId"), { code: -32602 });
                return window.testWalletSign(params[1]);
            }
            // Any other EVM call (a BSC-side contract): sent to the chain the wallet is on, signed in Node
            if (window.testWalletRpc) {
                const answer = JSON.parse(await window.testWalletRpc(state.chain, method, JSON.stringify(params ?? [])));
                if (answer.error) throw Object.assign(new Error(answer.error.message), { code: answer.error.code ?? -32603 });
                return answer.result;
            }
            throw Object.assign(new Error("Unsupported " + method), { code: 4200 });
        },
    };
    window.testWalletSwitchChain = (id) => { state.chain = id; emit("chainChanged", id); };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
};

/** Layout problems at one width: horizontal overflow, small inputs on phones, uneven cards in one row */
const LAYOUT_CHECK = () => {
    const doc = document.documentElement;
    const problems = [];
    if (doc.scrollWidth > doc.clientWidth) problems.push(`page is ${doc.scrollWidth}px wide in ${doc.clientWidth}px`);
    if (doc.clientWidth < 768) {
        for (const input of document.querySelectorAll("#app input")) if (parseFloat(getComputedStyle(input).fontSize) < 16) problems.push("an input is smaller than 16px (phones zoom in)");
    }
    if (getComputedStyle(doc).touchAction !== "manipulation") problems.push("html has no touch-action: manipulation");
    const rows = {};
    document.querySelectorAll("#app .grid > *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.height) return;
        const key = `${el.parentElement.className}|${Math.round(r.top)}`;
        (rows[key] = rows[key] || []).push(Math.round(r.height));
    });
    for (const heights of Object.values(rows)) if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 1) problems.push(`cards in one row have different heights (${heights.join("/")})`);
    return problems;
};

async function main() {
    // The site under test reads settings/config.js like npm run dev does (the test chain's values are merged over it)
    if (!fs.existsSync(path.join(ROOT, "settings", "config.js"))) throw new Error("settings/config.js is missing.");

    /* ------------------------------------ chain + programs + sample data */
    const port = Number(local.TEST_PORT);
    node = startNode({ port, chainId: Number(local.LOCAL_CHAIN_ID), blockMs: Number(local.TEST_BLOCK_MS), people: Number(local.APP_TEST_SEED),
        balance: local.LOCAL_GENESIS_BALANCE, coinName: local.LOCAL_COIN_NAME, coinSymbol: local.LOCAL_COIN_SYMBOL, logFile: path.join(DEV_DIR, "generated", "node.log") });
    await waitForNode(node.url);
    const client = localClient(node.url);
    const programs = await compileAll({ write: false, quiet: true });
    bscLocal = await startLocalBsc({ port: Number(local.APP_TEST_BSC_PORT), chainId: Number(local.LOCAL_BSC_CHAIN_ID) });
    const deployed = await deployLocal({ client, programs, overrides: bscLocal.overrides });
    const bsc = bscLocal.anvil ? { ...bscLocal, ...(await deployBscLocal(bscLocal, { bwsc: deployed.addresses })) } : null;
    if (project.seed) await project.seed({ client, deployed, count: Number(local.APP_TEST_SEED) });
    running = services.start ? await services.start({ deployed, bsc, local, client, nodeUrl: node.url, port: Number(local.APP_TEST_SIGNER_PORT), chain2Port: Number(local.APP_TEST_CHAIN2_PORT) }) : null;
    console.log(`${isMock() ? "Mock node" : "Real node"} at ${node.url}, ${Object.keys(deployed.addresses).length} programs, sample data ready${bsc ? `; local BSC at ${bsc.anvil.url}` : "; no local BSC (anvil not installed)"}`);

    /* ------------------------------------ website */
    const webPort = Number(local.APP_TEST_PORT);
    const url = `http://localhost:${webPort}/`;
    const web = spawn(path.join(ROOT, "node_modules/.bin/vite"), [ "--port", String(webPort), "--strictPort" ], {
        cwd: ROOT,
        stdio: [ "ignore", "pipe", "pipe" ],
        env: { ...process.env, ...websiteEnv(deployed), VITE_NETWORK: "local",
            VITE_DEV_FUNDER_KEY: devKey(1), VITE_DEV_FUND_GAS: local.LOCAL_FUND_GAS, VITE_DEV_FUND_AMOUNT: local.LOCAL_FUND_AMOUNT, VITE_RPC_LATENCY: "0",
            ...bscWebsiteEnv(bsc),
            VITE_CONFIG: JSON.stringify(testConfig({ nodeUrl: node.url, local, deployed, bsc, signerUrl: running?.signerUrl, extraChains: running?.chains ?? [], extraTokens: running?.tokens ?? [] })) },
    });
    children.push(web);
    let webLog = "";
    web.stdout.on("data", (d) => { webLog += d; });
    web.stderr.on("data", (d) => { webLog += d; });
    const until = Date.now() + 120_000;
    for (;;) {
        try { if ((await fetch(url)).ok) break; } catch {}
        if (Date.now() > until || web.exitCode !== null) throw new Error(`The website did not start on ${url}.\n${webLog}`);
        await new Promise((r) => setTimeout(r, 300));
    }

    /* ------------------------------------ browser */
    const browser = await playwright.chromium.launch({ headless: !argv.includes("--headed"), ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
    const walletKey = devWallet(WALLET_KEY_INDEX);
    const files = (fs.existsSync(TEST_DIR) ? fs.readdirSync(TEST_DIR) : []).filter((f) => f.endsWith(".app.mjs") && (!argOf("only") || f.includes(argOf("only")))).sort();

    for (const file of files) {
        const label = file.replace(/\.app\.mjs$/, "");
        console.log(`\n── ${label}`);
        const contexts = [];

        const t = {
            url,
            node: node.url,
            client,
            deployed,
            settings: deployed.settings,
            local,
            /** The local BSC (or null without anvil): { anvil, contracts, tokens, addresses, settings } */
            bsc,
            /** More local EVM chains from the project's services (project/secondChain.mjs): [{ chain, anvil, tokens, addresses }] */
            moreChains: running?.secondChain ? [ running.secondChain ] : [],
            /** The bridge relayer (automatic delivery): pause() / resume() to test claiming by hand */
            relayer: running?.relayer ?? null,
            isMock: isMock(),
            walletAddress: walletKey.address.toLowerCase(),

            check: (name, pass, detail = "") => {
                results.push({ file: label, name, pass: Boolean(pass) });
                console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
            },

            /** Runs one scenario; an exception fails it with the message instead of stopping the file */
            step: async (name, fn) => {
                try { await fn(); } catch (error) { t.check(name, false, String(error?.message ?? error).split("\n")[0]); }
            },

            /**
             * Opens the site in a new browser profile.
             * @param {string} hash   "#/swap" …
             * @param {object} options
             * @param {"demo"|"injected"|null} options.wallet  demo = the test panel's demo wallet; injected = an EIP-6963 wallet like MetaMask
             * @param {number} options.width                   viewport width (phones: < 768 also emulates touch)
             * @param {boolean} options.panel                  keep the test panel open (default: closed after setup)
             * @returns {Promise<{ page, errors, context }>}
             */
            open: async (hash = "", { wallet = null, width = 1280, panel = false } = {}) => {
                const isPhone = width < 768;
                const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: isPhone, hasTouch: isPhone });
                // Web fonts (Google Fonts) are not reachable from the test machine: answer them empty (system fonts)
                await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
                contexts.push(context);
                if (wallet === "injected") {
                    await context.exposeFunction("testWalletSign", (json) => {
                        const typed = JSON.parse(json);
                        const { EIP712Domain, ...types } = typed.types;
                        return walletKey.signTypedData(typed.domain, types, typed.message);
                    });
                    // EVM calls on BSC (the local anvil): reads go straight to it, eth_sendTransaction is signed with the wallet key
                    await context.exposeFunction("testWalletRpc", async (chain, method, paramsJson) => {
                        try {
                            // Every local EVM chain (BSC and the second chain) has an RPC here
                            const provider = running?.evm?.get(Number(chain)) ?? (bsc && Number(chain) === bsc.anvil.chainId ? bsc.anvil.provider : null);
                            if (!provider) return JSON.stringify({ error: { code: 4901, message: `The test wallet is on chain ${Number(chain)}, which has no RPC here.` } });
                            const params = JSON.parse(paramsJson);
                            if (method === "eth_sendTransaction") {
                                const tx = params[0];
                                const signer = walletKey.connect(provider);
                                const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit: tx.gas ?? undefined });
                                return JSON.stringify({ result: sent.hash });
                            }
                            return JSON.stringify({ result: await provider.send(method, params) });
                        } catch (error) {
                            return JSON.stringify({ error: { code: error?.error?.code ?? -32603, message: error?.shortMessage ?? error?.message ?? String(error), data: error?.data } });
                        }
                    });
                    await context.addInitScript(INJECTED_WALLET, { address: walletKey.address.toLowerCase(), info: { uuid: "app-test", name: "Test Wallet", icon: "", rdns: "io.test.wallet" } });
                }
                const page = await context.newPage();
                const errors = [];
                page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
                page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
                await page.goto(url + hash);
                await page.waitForSelector("main:not([aria-busy])", { timeout: 30_000 });
                const setup = await page.locator("text=Setup is not finished").count();
                if (setup) throw new Error(`The site says "Setup is not finished": ${(await page.innerText("#app")).replace(/\s+/g, " ").slice(0, 300)}`);
                if (wallet === "demo") await t.demo(page);
                if (!panel) await t.panel(page, false);
                return { page, errors, context };
            },

            /** Test panel open / closed */
            panel: async (page, open) => {
                const isOpen = await page.locator("[data-dev-panel]:not(.hidden)").count();
                if (Boolean(isOpen) !== Boolean(open)) await page.evaluate(() => window.devTogglePanel?.());
            },

            /** Clicks a test panel button by its label and waits for its toast */
            panelButton: async (page, label, { done = "Done on the local chain." } = {}) => {
                await t.panel(page, true);
                await page.getByRole("button", { name: label, exact: false }).first().click();
                const text = await t.toast(page, [ done, "Something went wrong" ]);
                if (!text.includes(done)) throw new Error(`Panel "${label}": ${text.replace(/\s+/g, " ").trim()}`);
            },

            /** Turns on the demo wallet and gives it coins + every token */
            demo: async (page) => {
                await t.panel(page, true);
                if (await page.getByRole("button", { name: "Demo wallet: off" }).count()) await page.getByRole("button", { name: "Demo wallet: off" }).click();
                await page.waitForFunction(() => document.querySelector("header [data-wallet-button]")?.innerText.includes("demo"));
                await t.panelButton(page, "(gas)");
                for (const symbol of Object.keys(deployed.tokens)) await t.panelButton(page, `+${local.LOCAL_FUND_AMOUNT} ${symbol}`);
            },

            /** Waits until the toast shows one of the texts; returns the toast text */
            toast: async (page, texts, timeout = 60_000) => {
                const list = Array.isArray(texts) ? texts : [ texts ];
                const end = Date.now() + timeout;
                for (;;) {
                    const text = await page.locator("#toast").innerText().catch(() => "");
                    if (list.some((x) => text.includes(x))) return text;
                    if (Date.now() > end) throw new Error(`No toast with "${list.join('" or "')}" (last: ${text.replace(/\s+/g, " ").slice(0, 120)})`);
                    await page.waitForTimeout(200);
                }
            },

            /** Waits for a quiet moment after a toast (the page repaints with fresh numbers) */
            settle: (page) => page.waitForTimeout(800),

            /** Reads of the current page: { page, total, rounds, calls } */
            // The header's coin price ("Price.*": one read shared by every page, at most every 30 s) is counted apart,
            // so `total` is the page's own reads
            reads: (page) => page.evaluate(() => {
                const calls = { ...window.rpcMeter?.calls };
                const shared = Object.entries(calls).filter(([ k ]) => k.startsWith("Price.")).reduce((s, [ k, n ]) => { delete calls[k]; return s + n; }, 0);
                return { page: window.rpcMeter?.page, total: (window.rpcMeter?.total ?? 0) - shared, shared, rounds: window.rpcMeter?.rounds, calls };
            }),

            /** Thai letters in the page (the UI must be English; the test panel is skipped) */
            thai: (page) => page.evaluate((source) => {
                const re = new RegExp(source);
                const text = [ ...document.querySelectorAll("header, main, footer, #toast, .bwscbox-card") ].map((el) => el.innerText).join("\n");
                return text.split("\n").filter((line) => re.test(line));
            }, THAI.source),

            /** Layout problems of `hashes` at `widths` (fresh profile per width) → [ "320 #/pool: …" ] */
            layout: async (hashes, widths = [ 320, 360, 390, 768, 1024, 1366 ]) => {
                const problems = [];
                for (const width of widths) {
                    const { page } = await t.open("", { width });
                    for (const hash of hashes) {
                        await page.evaluate((h) => { location.hash = h; }, hash);
                        await page.waitForTimeout(500);
                        await page.waitForSelector("main:not([aria-busy])");
                        for (const p of await page.evaluate(LAYOUT_CHECK)) problems.push(`${width} ${hash || "#/"}: ${p}`);
                    }
                    await page.context().close();
                }
                return problems;
            },

            /** Token balance of an address, straight from the chain (not through the page) */
            balanceOf: (symbol, who) => deployed.read(deployed.tokens[symbol].address, "balanceOf", { who }),

            /** A read of a program by name (deploy.config) or address, straight from the chain */
            read: (nameOrAddress, fn, input = {}) => deployed.read(deployed.addresses[nameOrAddress] ?? nameOrAddress, fn, input),

            /** The owner's transaction (e.g. a setting the page must show): t.send(t.owner, "BwscBridge", "setFeeExempt", { … }) */
            owner: deployed.owner,
            send: (signer, nameOrAddress, fn, input = {}, options = {}) => deployed.send(signer, nameOrAddress, fn, input, options),
        };

        try {
            const mod = await import(pathToFileURL(path.join(TEST_DIR, file)).href);
            await mod.default(t);
        } catch (error) {
            t.check(`${label} ran to the end`, false, error?.message ?? String(error));
        } finally {
            for (const c of contexts) await c.close().catch(() => {});
        }
    }
    await browser.close();

    const failed = results.filter((r) => !r.pass);
    console.log("");
    failed.forEach((r) => console.log(`FAILED  ${r.file}: ${r.name}`));
    console.log(`${results.length - failed.length}/${results.length} app checks passed (${isMock() ? "mock node" : "real node"})`);
    return failed.length || !results.length ? 1 : 0;
}

let code = 1;
try {
    code = await main();
} catch (error) {
    console.error(error.isCompileError ? `✖ ${error.message}` : error);
} finally {
    stopAll();
}
process.exit(code);
