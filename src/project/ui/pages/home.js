/*
 * YOUR CODE (off-chain). Home: the landing page of the chain (Bluewolfchain). What the chain is and can do: programs in
 * JavaScript, fast blocks, EVM wallets, fees, review, verifiable state, its apps (as a summary: the list is #/apps),
 * code examples, how to connect. Reads: one GET /genesis (live numbers).
 * Every fact here comes from the chain's own code (Program VM); change the words in CAPABILITIES / BUILD if it changes.
 */

import { formNumber, escapeHtml, addressUrl } from "../../../engine/ui/helpers";
import { settings } from "../../../engine/settings";
import { APPS, CATEGORIES, countIn } from "../directory";
import { networkDetails } from "../../chain";
import { pageLoading, pageError } from "./shared";
import { codeBlock } from "../code";

const svg = (d, size = "size-5") => `<svg viewBox="0 0 24 24" class="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
    code: `<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>`,
    wallet: `<path d="M4 7.5A2.5 2.5 0 016.5 5H18v3M4 7.5V17a2 2 0 002 2h13a1 1 0 001-1v-3M4 7.5A1.5 1.5 0 005.5 9H19a1 1 0 011 1v2.5M20 12.5h-3.5a1.75 1.75 0 000 3.5H20"/>`,
    check: `<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>`,
    review: `<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 14l2 2 4-4"/>`,
    layers: `<path d="M12 3l8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/>`,
    flame: `<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3 .5-6 1-8.5z"/>`,
    gift: `<path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1zm0 0c1.5-3 5-3 5-1s-3 1-5 1z"/>`,
    puzzle: `<path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z"/>`,
    proof: `<path d="M12 3v18M5 8l7-5 7 5M5 8v4M19 8v4M3 12h4M17 12h4M5 12l-2 5h4zM19 12l-2 5h4z"/>`,
    swap: `<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>`,
    bridge: `<path d="M3 17h18M5 17V9M19 17V9M3 9c3 0 6-3 9-3s6 3 9 3M9 17v-5M15 17v-5"/>`,
    arrow: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
    limit: `<path d="M4 7h13l-3-3M20 17H7l3 3"/>`,
    send: `<circle cx="5" cy="12" r="2"/><path d="M7 12h3c2 0 3-6 6-6h4M10 12c2 0 3 6 6 6h4M10 12h10M17 3l3 3-3 3M17 15l3 3-3 3"/>`,
    out: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>`,
};

/** What the chain itself does (from the Program VM's code and docs) */
const CAPABILITIES = [
    { icon: "code", title: "Programs in plain JavaScript", text: "A smart contract is one JavaScript function that returns its public functions. Amounts are BigInt, so nothing is rounded away." },
    { icon: "wallet", title: "The wallet you already have", text: "MetaMask and other EVM wallets sign from whatever network they have open, with no network to add. You sign readable EIP-712 fields: the program, the function and its inputs." },
    { icon: "check", title: "Checked before it is queued", text: "The node runs every transaction once before accepting it. One that would fail is refused on the spot and costs you nothing." },
    { icon: "review", title: "Reviewed, then approved", text: "New code passes an automatic review that allows only known-safe JavaScript, then the chain team approves it before it can run." },
    { icon: "layers", title: "Upgrades in the open", text: "A program deployed without an upgrader can never change. With one, every new version needs approval, and every past version stays on record." },
    { icon: "flame", title: "Fees that follow demand", text: "An EIP-1559 base fee rises and falls with how full blocks are, and part of every fee is burned." },
    { icon: "gift", title: "Apps can pay the gas", text: "A sponsor can sign the same transaction and pay its gas, so a new user can start without holding any coins." },
    { icon: "puzzle", title: "Standards and composition", text: "Tokens, NFTs (ERC-721), multi-tokens (ERC-1155), permit (EIP-2612) and multicall. Programs call each other, and a failed call rolls back cleanly." },
    { icon: "proof", title: "State you can verify", text: "All state sits in a Merkle Patricia trie. Any value can come with a proof against the block's state root, so you need not trust the node." },
];

const BUILD = [
    { title: "Write a program", text: "One function. initialization runs once when it goes live; the functions you return are the ones people may call." },
    { title: "Deploy from the explorer", text: "Paste the code and its first input, then sign with your wallet. The code is reviewed as it arrives." },
    { title: "Approved by the chain team", text: "Once approved, initialization runs and the program gets its address. Every call is on the explorer." },
    { title: "Call it from any wallet", text: "People sign readable fields in their own wallet. Reads are free and need no wallet at all." },
];

/** A second example for the developer section: holding and paying out the native coin */
const TIP_JAR = `function program() {
    function initialization(params) {
        writeDB("owner", params.context.sender);
    }

    // Anyone can tip: the coins sent with the call stay here
    function tip(params) {
        if (params.value === 0n) throw new Error("Send a tip");
        emit("Tipped", { from: params.context.sender, amount: params.value });
    }

    // The owner takes everything out
    function withdraw(params) {
        if (params.context.sender !== readDB("owner")) throw new Error("Only the owner");
        transferNative(params.context.sender, ThisBalance());
    }

    return { tip, withdraw };
}`;

/** Calling the program from an app: a read over HTTP (free, no wallet) */
const CLIENT = (node) => `// Read from a program: free, no wallet, no gas
const res = await fetch("${node}/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        programUuid: COUNTER,          // the program's address
        functionName: "countOf",
        input: { who: "0x5a3c...e91f" },
    }),
});
const { result } = await res.json();  // "3n": numbers arrive as "<digits>n"
console.log(BigInt(result.slice(0, -1)));`;

const SAMPLE = `function program() {
    function initialization(params) {
        writeDB("owner", params.context.sender);
    }

    function add(params) {
        const key = map("count", params.context.sender);
        const next = (readDB(key) || 0n) + 1n;
        writeDB(key, next);
        return next;
    }

    function countOf(params) {
        return readDB(map("count", params.input.who)) || 0n;
    }

    return { add, countOf };
}`;

/* ------------------------------------ pieces */

const eyebrow = (text) => `<p class="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-brand-300/90">${text}</p>`;

const copyButton = (value, label) => /*html*/`
    <button type="button" onclick="copyText(this.dataset.copy, this)" data-copy="${escapeHtml(value)}"
        class="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        aria-label="Copy ${escapeHtml(label)}">Copy</button>`;

/** The live numbers in one band (or the fixed facts when the node does not answer) */
function statsBand(network) {
    const d = networkDetails();
    const live = network?.isLive;
    const cell = (label, value, note) => /*html*/`
        <div class="min-w-0 px-5 py-5 sm:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">${label}</p>
            <p class="mt-2 truncate font-mono text-[22px] tabular-nums tracking-tight text-white sm:text-[26px]">${value}</p>
            <p class="mt-1 truncate text-[12px] text-zinc-500">${note}</p>
        </div>`;
    return /*html*/`
    <div class="glow-edge slow mt-14 rounded-3xl sm:mt-20" data-rise="3" data-network>
        <div class="grid grid-cols-2 divide-white/[0.06] rounded-3xl border border-white/[0.07] bg-ink-950/80 backdrop-blur lg:grid-cols-4 lg:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-white/[0.06] lg:[&>*:nth-child(-n+2)]:border-b-0">
            ${cell("Latest block", live ? `#${formNumber(network.latest ?? 0n, 0, 0)}` : "–", live ? `<span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-mint-400"></span>live</span>` : "node not answering")}
            ${cell("Block time", "2 s", "a block when there is work")}
            ${cell("Base fee", live && network.baseFee !== null ? `${formNumber(network.baseFee, 9, 0)}` : "10,000", "gwei, burned")}
            ${cell("Chain ID", String(d.chainId), `0x${Number(d.chainId).toString(16)} · ${escapeHtml(d.symbol)}`)}
        </div>
    </div>`;
}

/** The feature grid: two large cards (code, speed), then the rest */
function features() {
    const card = (c, extra = "") => /*html*/`
        <li class="spot surface min-w-0 rounded-3xl p-6 sm:p-7 ${extra}" onpointermove="spotMove(event, this)">
            <span class="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-brand-300">${svg(ICON[c.icon])}</span>
            <p class="mt-5 text-[16px] font-semibold tracking-tight text-white">${c.title}</p>
            <p class="mt-2 text-[14px] leading-relaxed text-zinc-400">${c.text}</p>
        </li>`;
    const blocks = Array.from({ length: 14 }, (_, i) => `<span class="block-tick" style="animation-delay:${(i * 0.14).toFixed(2)}s"></span>`).join("");
    return /*html*/`
    <ul class="mt-10 grid gap-4 lg:grid-cols-6" data-capabilities>
        <li class="spot surface min-w-0 overflow-hidden rounded-3xl p-6 sm:p-7 lg:col-span-4" onpointermove="spotMove(event, this)">
            <span class="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-brand-300">${svg(ICON.code)}</span>
            <p class="mt-5 text-[20px] font-semibold tracking-tight text-white">Smart contracts are JavaScript</p>
            <p class="mt-2 max-w-xl text-[14px] leading-relaxed text-zinc-400">No new language. A program is one function that returns its public functions; storage, events and calls to other programs are plain function calls. Amounts are BigInt, so nothing is rounded away.</p>
            <div class="mt-6 grid gap-2 font-mono text-[12px] text-zinc-400 sm:grid-cols-3">
                ${[ [ "writeDB(key, value)", "storage" ], [ "runProgram(to, fn, input)", "composition" ], [ "emit(name, data)", "events" ] ].map(([ c, l ]) => `<span class="rounded-xl border border-white/[0.07] bg-ink-950/60 px-3 py-2.5"><span class="tok-api">${escapeHtml(c)}</span><span class="mt-1 block font-sans text-[11px] text-zinc-500">${l}</span></span>`).join("")}
            </div>
        </li>
        <li class="spot surface min-w-0 overflow-hidden rounded-3xl p-6 sm:p-7 lg:col-span-2" onpointermove="spotMove(event, this)">
            <span class="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-brand-300">${svg(ICON.layers)}</span>
            <p class="mt-5 text-[20px] font-semibold tracking-tight text-white">Blocks every 2 seconds</p>
            <p class="mt-2 text-[14px] leading-relaxed text-zinc-400">A transaction is in a block within about two seconds, with 5 million gas per block.</p>
            <div class="mt-6 flex h-10 items-end gap-1.5" aria-hidden="true">${blocks}</div>
        </li>
        ${[ "wallet", "check", "review", "flame", "gift", "proof" ].map((k) => CAPABILITIES.find((c) => c.icon === k)).map((c) => card(c, "lg:col-span-2")).join("")}
    </ul>`;
}

/* ------------------------------------ page */

const home = (all) => {
    const d = networkDetails();
    const network = all.network ?? { isLive: false };
    const details = [
        [ "Network name", d.name ],
        [ "RPC URL", d.rpcUrl ],
        [ "Chain ID", String(d.chainId) ],
        [ "Currency symbol", d.symbol ],
        ...(d.explorerUrl ? [ [ "Block explorer", d.explorerUrl ] ] : []),
    ];
    const tools = APPS.filter((a) => a.core && a.url.startsWith("#/"));

    return /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 sm:px-6" data-landing>
        <!-- Hero -->
        <section class="grid items-center gap-12 pb-4 pt-14 sm:pt-20 lg:grid-cols-[1fr_1fr] lg:gap-14 lg:pt-24">
            <div data-rise class="min-w-0">
                <p class="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-2 pr-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                    <span class="relative flex size-2"><span class="absolute inline-flex size-full animate-ping rounded-full bg-mint-400/60 motion-reduce:animate-none"></span><span class="relative inline-flex size-2 rounded-full bg-mint-400"></span></span>
                    Layer 1 · Chain ${d.chainId}
                </p>
                <h1 class="mt-7 text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] text-white sm:text-[56px] lg:text-[64px]">
                    Smart contracts<br />in <span class="brand-text">JavaScript</span>.
                </h1>
                <p class="mt-6 max-w-lg text-[16px] leading-relaxed text-zinc-400 sm:text-[17px]">${escapeHtml(settings.appName)} runs programs written in plain JavaScript, closes a block every two seconds, and works with the EVM wallets and tools people already use.</p>
                <div class="mt-9 flex flex-wrap gap-3">
                    <a href="#/docs" class="btn-brand inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950" data-hero-docs>
                        Read the docs ${svg(ICON.arrow, "size-4")}
                    </a>
                    <a href="#/apps" class="inline-flex min-h-12 items-center rounded-xl border border-white/10 bg-white/[0.03] px-5 text-[14px] font-semibold text-white transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-hero-apps>Explore apps</a>
                </div>
            </div>
            <div class="min-w-0" data-rise="2">${codeBlock({ code: SAMPLE, file: "counter.js", glow: true })}</div>
        </section>

        ${statsBand(network)}

        <!-- What the chain does -->
        <section class="py-20 sm:py-28" aria-labelledby="chain-title">
            ${eyebrow("The chain")}
            <h2 id="chain-title" class="mt-4 max-w-3xl text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]">Built for people who write code,<br class="hidden sm:block" /> and people who just use apps.</h2>
            ${features()}
        </section>

        <!-- Build -->
        <section id="build" class="scroll-mt-20 border-t border-white/[0.06] py-20 sm:py-28" aria-labelledby="build-title">
            <div class="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
                <div class="min-w-0">
                    ${eyebrow("For developers")}
                    <h2 id="build-title" class="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]">From a file to a live program.</h2>
                    <ol class="mt-10 space-y-7">
                        ${BUILD.map((s, i) => /*html*/`
                        <li class="grid grid-cols-[auto_1fr] gap-5">
                            <span class="font-mono text-[13px] text-brand-300/80">${String(i + 1).padStart(2, "0")}</span>
                            <span class="min-w-0 border-l border-white/[0.08] pl-5">
                                <span class="block text-[16px] font-semibold text-white">${s.title}</span>
                                <span class="mt-1.5 block text-[14px] leading-relaxed text-zinc-400">${s.text}</span>
                            </span>
                        </li>`).join("")}
                    </ol>
                    <a href="#/docs?p=first-program" class="mt-10 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/[0.06]">Write your first program ${svg(ICON.arrow, "size-4")}</a>
                </div>
                <div class="min-w-0 space-y-4">
                    ${codeBlock({ code: TIP_JAR, file: "tip-jar.js" })}
                    ${codeBlock({ code: CLIENT(d.rpcUrl.replace(/\/evm$/, "")), file: "app.js" })}
                </div>
            </div>
        </section>

        <!-- Apps, as a summary -->
        <section class="border-t border-white/[0.06] py-20 sm:py-28" aria-labelledby="apps-title" data-home-apps>
            <div class="grid gap-10 lg:grid-cols-2 lg:items-end">
                <div class="min-w-0">
                    ${eyebrow("Ecosystem")}
                    <h2 id="apps-title" class="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]">One chain, many apps.</h2>
                    <p class="mt-5 max-w-lg text-[15px] leading-relaxed text-zinc-400">Trade, bridge and stake with the chain's own tools, play games and use every project built on the network. Each app shows who made it, whether it was audited and how risky it is.</p>
                </div>
                <div class="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.06]">
                    <a href="#/apps" class="bg-ink-950 p-5 hover:bg-ink-900"><span class="block font-mono text-[34px] tracking-tight text-white">${APPS.length}</span><span class="text-[12px] text-zinc-500">apps and tools</span></a>
                    ${CATEGORIES.filter((c) => countIn(c.id) > 0).slice(0, 3).map((c) => `<a href="#/apps?c=${encodeURIComponent(c.id)}" class="bg-ink-950 p-5 hover:bg-ink-900" data-home-category="${escapeHtml(c.id)}"><span class="block font-mono text-[34px] tracking-tight text-white">${countIn(c.id)}</span><span class="text-[12px] text-zinc-500">${escapeHtml(c.label)}</span></a>`).join("")}
                </div>
            </div>
            <div class="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/[0.06] pt-8 text-[14px]">
                <span class="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Built in</span>
                ${tools.map((a) => `<a href="${escapeHtml(a.url)}" class="text-zinc-300 hover:text-white">${escapeHtml(a.name)}</a>`).join("")}
                <a href="#/apps" class="ml-auto inline-flex items-center gap-1.5 font-semibold text-brand-300 hover:text-brand-200">Browse all apps ${svg(ICON.arrow, "size-4")}</a>
            </div>
        </section>

        <!-- Connect -->
        <section class="border-t border-white/[0.06] py-20 sm:py-28" aria-labelledby="details-title">
            <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
                <div class="min-w-0">
                    ${eyebrow("Connect")}
                    <h2 id="details-title" class="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]">Add ${escapeHtml(d.name)} to a wallet.</h2>
                    <p class="mt-5 text-[15px] leading-relaxed text-zinc-400">You do not need it to use the apps: your wallet signs from any network. Add it to see your ${escapeHtml(d.symbol)} balance in the wallet, or point any EVM tool at the RPC URL.</p>
                    <button type="button" onclick="addNetwork()" class="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[13px] font-semibold text-white transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">${svg(ICON.wallet, "size-4")} Add automatically</button>
                </div>
                <dl class="surface min-w-0 divide-y divide-white/[0.06] rounded-3xl" data-network-details>
                    ${details.map(([ label, value ]) => /*html*/`
                    <div class="flex min-w-0 items-center gap-3 px-5 py-3.5">
                        <div class="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                            <dt class="text-[11px] text-zinc-500 sm:w-36 sm:shrink-0 sm:text-[13px]">${label}</dt>
                            <dd class="mt-0.5 min-w-0 break-all font-mono text-[13px] text-white sm:mt-0 sm:flex-1">${escapeHtml(value)}</dd>
                        </div>
                        ${copyButton(value, label)}
                    </div>`).join("")}
                </dl>
            </div>
        </section>

        <!-- Closing -->
        <section class="pb-24 sm:pb-32">
            <div class="glow-edge rounded-[28px]">
                <div class="relative overflow-hidden rounded-[28px] border border-white/[0.07] bg-ink-950/85 px-6 py-14 text-center sm:px-12 sm:py-20">
                    <h2 class="mx-auto max-w-2xl text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[44px]">Ship your first program today.</h2>
                    <p class="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-zinc-400">Everything you need is in the docs: the network, the program API, deploying and building an app around it.</p>
                    <div class="mt-9 flex flex-wrap justify-center gap-3">
                        <a href="#/docs" class="btn-brand inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold">Read the docs ${svg(ICON.arrow, "size-4")}</a>
                        ${d.explorerUrl ? `<a href="${escapeHtml(d.explorerUrl)}" target="_blank" rel="noopener" class="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 text-[14px] font-semibold text-white hover:bg-white/[0.07]">Open the explorer ${svg(ICON.out, "size-4")}</a>` : ""}
                    </div>
                </div>
            </div>
        </section>
    </main>
    `;
};

const homeLoading = pageLoading("the network");
const homeError = pageError;

export { home, homeLoading, homeError };
