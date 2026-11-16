/*
 * YOUR CODE (off-chain). Small pieces the pages share: loading / error blocks, token badge, pool price.
 */

import { formNumber, escapeHtml } from "../../../engine/ui/helpers";
import { config } from "../../../engine/settings";

const TONES = [ "from-amber-200 to-amber-500", "from-mint-300 to-emerald-600", "from-sky-300 to-indigo-500", "from-rose-300 to-fuchsia-600", "from-orange-300 to-amber-600", "from-zinc-200 to-zinc-500" ];

/** Same color for the same symbol everywhere (a token keeps its badge color on every page) */
const toneOf = (symbol) => {
    const known = { USDT: 1, [`w${config.hub?.native?.symbol}`]: 2, [config.hub?.native?.symbol]: 2 };
    if (symbol in known) return known[symbol];
    return [ ...String(symbol) ].reduce((h, c) => h + c.charCodeAt(0), 0) % 6;
};

/** Round badge with the token's first letter (no outside images) */
const tokenBadge = (token, tone = null, size = "size-7") => /*html*/`
    <span class="grid ${size} shrink-0 place-items-center rounded-full bg-gradient-to-br ${TONES[(tone ?? toneOf(token?.symbol)) % TONES.length]} text-[11px] font-bold text-ink-950 ring-2 ring-ink-900" aria-hidden="true">${escapeHtml(String(token?.symbol ?? "?").replace(/^[tbw](?=[A-Z])/, "").slice(0, 1))}</span>`;

/** Chain badge: square, first letters of its short name */
const chainBadge = (chain, size = "size-7") => /*html*/`
    <span class="grid ${size} shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.06] text-[10px] font-bold text-zinc-200" aria-hidden="true">${escapeHtml(String(chain?.short ?? "?").slice(0, 4))}</span>`;

/** Section title used by every page */
const pageHead = (eyebrow, title, text = "") => /*html*/`
    <div class="mb-6" data-rise>
        <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300 sm:text-[11px]">${eyebrow}</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">${title}</h1>
        ${text ? `<p class="mt-2 max-w-2xl text-[14px] leading-relaxed text-zinc-400">${text}</p>` : ""}
    </div>`;

/** Tabs that switch a filter (onclick gets the id) */
const tabs = (items, current, onclick) => /*html*/`
    <div class="inline-flex flex-wrap gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 text-[13px] font-medium" role="tablist">
        ${items.map((i) => /*html*/`<button type="button" role="tab" aria-selected="${i.id === current}" onclick="${onclick}('${i.id}')"
            class="whitespace-nowrap rounded-lg px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${i.id === current ? "bg-white/[0.09] text-white" : "text-zinc-400 hover:text-white"}">${escapeHtml(i.label)}</button>`).join("")}
    </div>`;

/** Trade's three pages (Swap · Limit orders · Pool) as tabs at the top of each, so they read as one place */
const TRADE = [ { page: "swap", label: "Swap" }, { page: "limit", label: "Limit orders" }, { page: "pool", label: "Pool" } ];
const tradeTabs = (current, center = false) => /*html*/`
    <nav class="mb-6 flex ${center ? "justify-center" : ""}" aria-label="Trade" data-trade-tabs>
        <div class="inline-flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 text-[13px] font-medium">
            ${TRADE.map((t) => `<a href="#/${t.page}" ${t.page === current ? `aria-current="page"` : ""} class="whitespace-nowrap rounded-lg px-3.5 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${t.page === current ? "bg-white/[0.09] text-white" : "text-zinc-400 hover:text-white"}">${t.label}</a>`).join("")}
        </div>
    </nav>`;

/** Price of 1 `base` in `quote` units, as bigint with the quote token's decimals */
const priceOf = (base, quote) => (base?.reserve > 0n ? (quote.reserve * 10n ** BigInt(base.decimals)) / base.reserve : 0n);

const priceText = (base, quote, places = 4) => (base?.reserve > 0n
    ? `1 ${escapeHtml(base.symbol)} = ${formNumber(priceOf(base, quote), quote.decimals, places)} ${escapeHtml(quote.symbol)}`
    : "No price yet");

/** Share of the pool as a percentage string ("0.25%") */
const shareText = (shares, total) => {
    if (!(total > 0n) || !(shares > 0n)) return "0%";
    const bps = (shares * 1_000_000n) / total;   // 4 decimals of a percent
    const pct = Number(bps) / 10_000;
    return pct < 0.0001 ? "<0.0001%" : `${pct.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
};

const feeText = (feeBps) => `${(Number(feeBps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

const pageLoading = (title) => /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-10 sm:px-6" aria-busy="true">
        <p class="sr-only">Loading ${escapeHtml(title)}…</p>
        <div class="mx-auto max-w-lg space-y-3">
            <div class="skeleton h-8 w-40 rounded-lg"></div>
            <div class="skeleton h-40 rounded-3xl"></div>
            <div class="skeleton h-24 rounded-3xl"></div>
        </div>
    </main>`;

const pageError = (message) => /*html*/`
    <main class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <div class="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-5 text-sm text-rose-100" role="alert">
            <p class="font-semibold">Could not load this page</p>
            <p class="mt-1 text-rose-100/80">${escapeHtml(message)}</p>
            <button type="button" onclick="refreshPage()" class="mt-4 rounded-xl border border-white/15 px-3 py-2 text-[13px] font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Try again</button>
        </div>
    </main>`;

const pausedNote = (data) => (data?.isPaused ? /*html*/`
    <div class="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">
        The pool is paused by its owner: swaps and new deposits are off. Taking liquidity out still works.
    </div>` : "");

/** "2 h ago", "in 3 d" for a unix time in seconds */
const timeText = (at, now = Math.floor(Date.now() / 1000)) => {
    const diff = at - now;
    const abs = Math.abs(diff);
    const unit = abs < 60 ? `${abs}s` : abs < 3600 ? `${Math.floor(abs / 60)} min` : abs < 86_400 ? `${Math.floor(abs / 3600)} h` : `${Math.floor(abs / 86_400)} d`;
    return diff >= 0 ? `in ${unit}` : `${unit} ago`;
};

export { tradeTabs, tokenBadge, chainBadge, toneOf, priceOf, priceText, shareText, feeText, pageLoading, pageError, pausedNote, pageHead, tabs, timeText };
