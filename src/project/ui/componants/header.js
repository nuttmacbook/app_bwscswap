import { shortAddress, escapeHtml, fromUnits } from "../../../engine/ui/helpers";
import { settings, config } from "../../../engine/settings";
import { icon as line } from "../icons";
import { coinPrice, loadCoinPrice } from "../../chain/coinPrice";

/*
 * YOUR CODE (off-chain). Top bar (logo, pages, search, wallet) and, on phones, a tab bar at the bottom.
 * Pages: Apps (the chain's directory) · Trade (Swap, Limit orders, Pool: tabs on those pages) · Bridge · Stake · Send · Docs.
 * The logo goes home. Under the chain's name: the coin's price from the exchange (chain/coinPrice.js); the line stays
 * hidden until there is a price (no pool yet, or an empty one).
 */

/**
 * Exact price → short text. 1 and above: 2 decimals with commas ($1,234.56). Below 1: 4 significant digits
 * ($0.0003024). Dollar sign when the unit is a dollar stablecoin (USDT, USDC …), else the unit after the number.
 */
function priceText(p) {
    const [ whole, frac = "" ] = fromUnits(p.value, p.decimals).split(".");
    let text;
    if (whole !== "0") text = `${BigInt(whole).toLocaleString("en-US")}.${(frac + "00").slice(0, 2)}`;
    else {
        const lead = frac.match(/^0*/)[0].length;
        text = `0.${frac.slice(0, lead + 4).replace(/0+$/, "") || "0"}`;
    }
    return /USD/i.test(p.unit) ? `$${text}` : `${text} ${p.unit}`;
}

const SYMBOL = config.hub?.native?.symbol ?? "";

/** The price line's inside (or nothing yet) */
const priceInner = (p) => (p ? `<span class="text-zinc-500">${escapeHtml(SYMBOL)}</span><span class="font-mono text-brand-200">${escapeHtml(priceText(p))}</span>` : "");

/** Fills every price line on the page (after a read; nothing is redrawn) */
function paintPrice(p) {
    for (const el of document.querySelectorAll("[data-coin-price]")) {
        el.innerHTML = priceInner(p);
        el.classList.toggle("hidden", !p);
        el.setAttribute("title", p ? `${SYMBOL} price from the ${SYMBOL} / ${p.unit} pool` : "");
    }
}

/** Reads the price when it is older than 30 s (one shared read, never per page) and fills the line */
const refreshPrice = (opts) => loadCoinPrice(opts).then(paintPrice);

const ICONS = {
    docs: `<path d="M6 4h9l3 3v13H6zM14 4v4h4M9 12h6M9 16h6"/>`,
    apps: `<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>`,
    trade: `<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>`,
    search: `<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>`,
    home: `<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>`,
    swap: `<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>`,
    bridge: `<path d="M3 17h18M5 17V9M19 17V9M3 9c3 0 6-3 9-3s6 3 9 3M9 17v-5M15 17v-5"/>`,
    stake: `<path d="M12 3l8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/>`,
    pool: `<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>`,
    limit: `<path d="M4 7h13l-3-3M20 17H7l3 3"/>`,
    send: `<circle cx="5" cy="12" r="2"/><path d="M7 12h3c2 0 3-6 6-6h4M10 12c2 0 3 6 6 6h4M10 12h10M17 3l3 3-3 3M17 15l3 3-3 3"/>`,
};

// pages: the routes that light up this link (Trade = Swap, Limit orders and Pool)
const LINKS = [
    { page: "apps", pages: [ "apps", "app" ], href: "#/apps", label: "Apps" },
    { page: "trade", pages: [ "swap", "limit", "pool" ], href: "#/swap", label: "Trade" },
    { page: "bridge", pages: [ "bridge" ], href: "#/bridge", label: "Bridge" },
    { page: "stake", pages: [ "stake" ], href: "#/stake", label: "Stake" },
    // Multi transfer: in the top bar from 1024 px (no room for six links on tablets); otherwise in Apps and the search
    { page: "send", pages: [ "send" ], href: "#/send", label: "Send", isDesktopOnly: true, isWideOnly: true },
    { page: "docs", pages: [ "docs" ], href: "#/docs", label: "Docs" },
];

const icon = (name, size = "size-5") => /*html*/`<svg viewBox="0 0 24 24" class="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const header = (data) => {
    const address = data?.wallet?.address;
    const isConnected = Boolean(address);
    const isDemo = Boolean(data?.wallet?.isDemo);
    const isWrongChain = isConnected && !isDemo && data?.wallet?.isRightChain === false;
    const label = isConnected ? shortAddress(address) : "Connect wallet";
    // The price: shown from memory now, read again in the background when older than 30 s
    queueMicrotask(() => refreshPrice());
    const page = data?.page ?? "home";

    return /*html*/`
    <header class="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
        <div class="mx-auto flex w-full max-w-6xl 2xl:max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <!-- Brand -->
            <a href="#/" class="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <img src="/logo.svg" alt="" class="h-8 w-[30px] shrink-0 object-contain" />
                <span class="flex min-w-0 flex-col leading-tight">
                    <span class="truncate text-[15px] font-semibold tracking-tight text-white sm:text-base">${escapeHtml(settings.appName)}</span>
                    <span data-coin-price class="flex items-center gap-1.5 text-[11px] ${coinPrice() ? "" : "hidden"}" ${coinPrice() ? `title="${escapeHtml(SYMBOL)} price from the ${escapeHtml(SYMBOL)} / ${escapeHtml(coinPrice().unit)} pool"` : ""}>${priceInner(coinPrice())}</span>
                </span>
            </a>

            <!-- Pages (computer) -->
            <nav class="hidden items-center gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1 text-[13px] font-medium md:flex" aria-label="Pages">
                ${LINKS.filter((l) => !l.isPhoneOnly).map((l) => /*html*/`
                    <a href="${l.href}" ${l.pages.includes(page) ? `aria-current="page"` : ""}
                        class="${l.isWideOnly ? "hidden lg:block" : ""} rounded-lg px-3.5 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                        ${l.pages.includes(page) ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-white"}">${l.label}</a>`).join("")}
                ${settings.explorerUrl ? /*html*/`<a href="${escapeHtml(settings.explorerUrl)}" target="_blank" rel="noopener"
                    class="inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Explorer${line("external", "size-3.5")}</a>` : ""}
            </nav>

            <!-- Search + wallet -->
            <div class="flex shrink-0 items-center gap-2">
            <button type="button" onclick="openSearch()" aria-label="Search apps" data-search-open
                class="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 text-[13px] text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:px-3">
                ${icon("search", "size-4")}<span class="hidden lg:inline">Search</span><kbd class="hidden rounded border border-white/10 px-1.5 font-mono text-[10px] text-zinc-500 lg:inline">/</kbd>
            </button>
            <button type="button" onclick="openWallet()" data-wallet-button
                class="inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:px-3.5
                ${isWrongChain ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : isConnected ? "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]" : "btn-brand border-transparent"}"
                aria-label="${isConnected ? "Wallet menu" : "Connect wallet"}">
                ${isConnected ? /*html*/`<span class="size-2 rounded-full ${isWrongChain ? "bg-amber-400" : "bg-mint-400"}" aria-hidden="true"></span>` : ""}
                <span class="hidden sm:inline ${isConnected ? "font-mono tabular-nums" : ""}">${isWrongChain ? "Wrong network" : label}${isDemo ? " · demo" : ""}</span>
                <span class="sm:hidden ${isConnected ? "font-mono tabular-nums" : ""}">${isConnected ? (isWrongChain ? "Switch" : shortAddress(address, 4, 3)) : "Connect"}</span>
            </button>
            </div>
        </div>
    </header>

    <!-- Pages (phone): tab bar at the bottom, in thumb reach -->
    <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-ink-950/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Pages">
        <div class="mx-auto grid max-w-md grid-cols-5">
            ${LINKS.filter((l) => !l.isDesktopOnly).map((l) => /*html*/`
                <a href="${l.href}" ${l.pages.includes(page) ? `aria-current="page"` : ""}
                    class="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400
                    ${l.pages.includes(page) ? "text-brand-300" : "text-zinc-500"}">${icon(l.page)}${l.label}</a>`).join("")}
        </div>
    </nav>
    `;
};

export { header, refreshPrice };
