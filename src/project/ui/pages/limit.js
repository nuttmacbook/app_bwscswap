/*
 * YOUR CODE (off-chain). Limit orders page: coin for coin at the maker's price, on Bluewolfchain.
 * Built for hundreds of coins, markets and orders:
 *   - coins are picked from a searchable list (with how many orders each has), never shown as one long row
 *   - markets ("get X · pay Y") have their own search, sort and "Show more"
 *   - a market's orders are sorted best rate first (or largest / newest), 20 at a time, ended ones hidden
 *   - My orders are read 50 at a time, newest first; the owner tab lists coins with search and paging
 * Every order shows its seller's address. A seller filter (or a link #/limit?seller=0x…, which "Share my orders"
 * copies) shows only that wallet's orders: all its open orders across markets, and in the market list only its
 * orders, so you can buy from a friend directly.
 * One pair choice drives the page: the order list shows people selling X for Y, and "Place an order" sells X for Y too,
 * so a new order's place in the list is shown before it is placed.
 */

import { icon } from "../icons";
import { getLimitData, getMyOrders, priceFor, amountForBudget, nativeCoin, HUB } from "../../chain";
import { formNumber, escapeHtml, toUnits, fromUnits, shortAddress } from "../../../engine/ui/helpers";
import { openPicker } from "../componants/picker";
import { tradeTabs, tokenBadge, pageHead, pageLoading, pageError, tabs, timeText } from "./shared";

const ORDERS_PAGE = 20;
const MARKETS_PAGE = 20;
const COINS_PAGE = 30;
const ENDS = [ { id: 86_400, label: "1 day" }, { id: 7 * 86_400, label: "7 days" }, { id: 30 * 86_400, label: "30 days" }, { id: 0, label: "No end" } ];

const state = {
    tab: "market",
    give: "", want: "",                                     // the market: people sell `give`, ask `want`
    marketQuery: "", marketSort: "orders", marketShown: MARKETS_PAGE,
    orderSort: "rate", orderShown: ORDERS_PAGE, showEnded: false,
    giveText: "", wantText: "", partial: true, ends: 7 * 86_400,
    buy: null, buyText: "",
    mineFilter: "open", mine: null,                         // { count, orders, loaded } (pages of 50)
    coinQuery: "", coinShown: COINS_PAGE, newCoin: "", newFee: "0.1", fees: {},
    seller: "", sellerText: "", sellerOrders: null,          // the seller filter: an address, and its open orders
};
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? "").trim());
let last = null;

/* ------------------------------------ numbers */

const lower = (a) => String(a ?? "").toLowerCase();
const amountOf = (text, decimals) => { try { return text ? toUnits(String(text).replace(/,/g, "."), decimals) : 0n; } catch { return null; } };
const pct = (bps) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const rateText = (rate, m) => formNumber(rate, m.want.decimals, rate >= 10n ** BigInt(m.want.decimals) * 1000n ? 2 : 6);
/** How far a rate is from the Swap price, for the taker (negative = cheaper than Swap) */
const vsSwap = (rate, swapRate) => (swapRate ? Number(((rate - swapRate) * 10_000n) / swapRate) : null);
const vsText = (bps) => (bps === null ? "" : `${bps > 0 ? "+" : bps < 0 ? "−" : "±"}${pct(Math.abs(bps))} vs Swap`);
const vsTone = (bps) => (bps === null ? "text-zinc-500" : bps <= 0 ? "text-emerald-300/90" : "text-zinc-500");

/* ------------------------------------ the data (one load per view; the pair and tab decide what is read) */

/** For the router: the page's data. Opens the busiest market the first time */
async function loadLimit(wallet) {
    // #/limit?seller=0x… (a shared link) opens with that seller's orders
    const linked = new URLSearchParams(String(window.location.hash.split("?")[1] ?? "")).get("seller");
    if (linked && isAddr(linked) && lower(linked) !== state.seller) { state.seller = lower(linked); state.sellerText = state.seller; state.sellerOrders = null; state.tab = "market"; }
    let data = await getLimitData(wallet, { give: state.give, want: state.want });
    if (data.isReady && !data.market && !state.give && data.markets.length) {
        const top = [ ...data.markets ].sort((a, b) => b.open - a.open)[0];
        state.give = top.give.address;
        state.want = top.want.address;
        data = await getLimitData(wallet, { give: state.give, want: state.want });
    }
    if (data.isReady && !state.give && data.coins.length > 1) {
        // No market yet: start the form on the first two listed coins
        state.give = data.coins[0].address;
        state.want = data.coins[1].address;
        data = await getLimitData(wallet, { give: state.give, want: state.want });
    }
    if (state.seller && data.isReady) {
        // All open orders of that wallet, across every market (its own list, newest first: up to 200)
        const page = await getMyOrders({ address: state.seller }, { offset: 0, limit: 200, fresh: true });
        state.sellerOrders = page.orders.filter((o) => o.status === "open" && !(o.expiresAt > 0n && Number(o.expiresAt) <= data.now));
        // Opening the page from a link: show the seller's first market when the current one has none of theirs
        if (state.sellerOrders.length && !state.sellerOrders.some((o) => o.give === state.give && o.want === state.want)) {
            state.give = state.sellerOrders[0].give;
            state.want = state.sellerOrders[0].want;
            data = await getLimitData(wallet, { give: state.give, want: state.want });
        }
    }
    const who = String(wallet?.address ?? "").toLowerCase();
    if (state.tab === "mine" && data.isConnected && (!state.mine || state.mine.account !== who)) {
        const page = await getMyOrders(wallet, { offset: 0 });
        state.mine = { account: who, count: page.count, orders: page.orders, now: page.now };
    }
    return data;
}

/** Open orders of the market in the chosen order (ended ones apart) */
function sortedOrders(m) {
    const bySeller = (o) => !state.seller || o.maker === state.seller;
    const live = m.orders.filter((o) => !o.ended && bySeller(o));
    const by = {
        rate: (a, b) => (a.rate < b.rate ? -1 : a.rate > b.rate ? 1 : Number(a.id - b.id)),
        size: (a, b) => (a.left > b.left ? -1 : a.left < b.left ? 1 : 0),
        new: (a, b) => b.createdAt - a.createdAt,
    }[state.orderSort];
    return { live: live.sort(by), ended: m.orders.filter((o) => o.ended && bySeller(o)) };
}

/** Open orders per coin (either side), for the coin picker */
const ordersPerCoin = (data) => {
    const count = new Map();
    for (const m of data.markets) for (const c of [ m.give.address, m.want.address ]) count.set(c, (count.get(c) ?? 0) + m.open);
    return count;
};

/* ------------------------------------ pieces */

const coinButton = (coin, label, side) => /*html*/`
    <button type="button" onclick="limitPickCoin('${side}')" data-limit-coin="${side}" aria-label="${label}: ${escapeHtml(coin?.symbol ?? "pick a coin")}. Change"
        class="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        ${coin ? tokenBadge(coin, null, "size-6") : `<span class="size-6 rounded-full bg-white/10"></span>`}
        <span class="min-w-0"><span class="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">${label}</span><span class="block truncate text-[14px] font-semibold text-white">${escapeHtml(coin?.symbol ?? "Pick")}</span></span>
        <svg viewBox="0 0 24 24" class="ml-auto size-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>`;

const pairBar = (data) => {
    const m = data.market;
    const give = m?.give ?? data.coins.find((c) => c.address === state.give);
    const want = m?.want ?? data.coins.find((c) => c.address === state.want);
    return /*html*/`
    <div class="surface flex flex-wrap items-center gap-2 rounded-2xl p-2" data-rise="2" data-limit-pair>
        <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:w-auto sm:flex-1 sm:max-w-md">
            ${coinButton(give, "You get", "give")}
            <button type="button" onclick="limitFlip()" aria-label="Switch the two coins" class="grid size-11 place-items-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">${icon("swapH")}</button>
            ${coinButton(want, "You pay", "want")}
        </div>
        <label class="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/10 px-3 text-[12px] text-zinc-400 sm:ml-auto sm:w-auto">Sort
            <select onchange="limitSort(this.value)" data-limit-sort class="bg-transparent text-[13px] text-white outline-none">
                ${[ [ "rate", "Best rate first" ], [ "size", "Largest first" ], [ "new", "Newest first" ] ].map(([ v, l ]) => `<option value="${v}" ${state.orderSort === v ? "selected" : ""} class="bg-ink-900">${l}</option>`).join("")}
            </select>
        </label>
        <form onsubmit="event.preventDefault(); limitSellerApply()" class="flex w-full min-w-0 gap-2" data-limit-seller-form>
            <label class="relative min-w-0 flex-1">
                <span class="sr-only">Seller address</span>
                <input value="${escapeHtml(state.sellerText)}" oninput="limitSellerInput(this.value)" placeholder="Seller address (0x…): only their orders" spellcheck="false" autocomplete="off" data-limit-seller-input
                    class="min-h-11 w-full rounded-xl border border-white/10 bg-ink-950/70 px-3 font-mono text-[13px] text-white outline-none placeholder:font-sans placeholder:text-zinc-600 focus:border-brand-400/60" />
            </label>
            <button type="submit" class="min-h-11 shrink-0 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-200 hover:bg-white/[0.06]">Find</button>
            ${state.seller ? `<button type="button" onclick="limitSeller('')" class="min-h-11 shrink-0 rounded-xl px-3 text-[13px] text-zinc-400 hover:text-white" data-limit-seller-clear>Clear</button>` : ""}
        </form>
    </div>`;
};

/** The seller filter: who, their open orders in every market (tap one to open its market) */
function sellerSection(data) {
    if (!state.seller) return "";
    const coin = (a) => data.coins.find((c) => c.address === lower(a)) ?? { symbol: shortAddress(a), decimals: 18, address: a };
    const list = state.sellerOrders ?? [];
    const isMe = lower(data.wallet?.address) === state.seller;
    return /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="Seller" data-limit-seller-panel>
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
                <p class="text-[11px] uppercase tracking-[0.12em] text-zinc-500">${isMe ? "Your orders" : "Orders from"}</p>
                <p class="mt-0.5 break-all font-mono text-[13px] text-white">${escapeHtml(state.seller)}</p>
            </div>
            <span class="text-[12px] text-zinc-500">${list.length} open order${list.length === 1 ? "" : "s"}</span>
        </div>
        <ul class="mt-3 grid gap-2 sm:grid-cols-2">${list.map((o) => {
            const g = coin(o.give);
            const w = coin(o.want);
            const here = o.give === state.give && o.want === state.want;
            return `<li><button type="button" onclick="limitMarket('${o.give}', '${o.want}')" class="flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${here ? "border-brand-400/40 bg-brand-500/10" : "border-white/[0.07] hover:bg-white/[0.04]"}" data-limit-seller-order="${o.id}">
                <span class="flex shrink-0 -space-x-2">${tokenBadge(g, null, "size-6")}${tokenBadge(w, null, "size-6")}</span>
                <span class="min-w-0 flex-1 text-[12px]"><span class="block truncate text-white">${formNumber(o.left, g.decimals, 6)} ${escapeHtml(g.symbol)} for ${escapeHtml(w.symbol)}</span><span class="block text-zinc-500">order #${o.id}${here ? " · shown below" : ""}</span></span>
            </button></li>`;
        }).join("") || `<li class="col-span-full py-4 text-center text-[13px] text-zinc-500">No open orders from this wallet.</li>`}</ul>
    </section>`;
}

const tag = (text, tone) => {
    const t = { green: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200", brand: "border-brand-400/40 bg-brand-500/15 text-brand-100", zinc: "border-white/10 bg-white/[0.04] text-zinc-300", amber: "border-amber-400/30 bg-amber-500/10 text-amber-100" };
    return `<span class="inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${t[tone]}">${text}</span>`;
};

const orderAction = (o, data) => (o.mine
    ? `<button type="button" onclick="limitCancel('${o.id}')" class="min-h-10 rounded-xl border border-white/15 px-3 text-[13px] text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Cancel</button>`
    : `<button type="button" onclick="limitBuyOpen('${o.id}')" ${data.paused || !data.market.give.enabled || !data.market.want.enabled ? "disabled" : ""} data-limit-buy="${o.id}" class="min-h-10 rounded-xl bg-brand-500 px-4 text-[13px] font-semibold text-white hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-40">Buy</button>`);

function ordersSection(data) {
    const m = data.market;
    if (!m) return `<section class="surface rounded-3xl p-6 text-center text-[13px] text-zinc-500">Pick the coin you want and the coin you pay with.</section>`;
    const { live, ended } = sortedOrders(m);
    const bestId = [ ...live ].sort((a, b) => (a.rate < b.rate ? -1 : a.rate > b.rate ? 1 : 0))[0]?.id;
    const best = live.find((o) => o.id === bestId);
    const list = state.showEnded ? [ ...live, ...ended ] : live;
    const shown = list.slice(0, state.orderShown);
    const unit = `${escapeHtml(m.want.symbol)} per ${escapeHtml(m.give.symbol)}`;
    const available = live.reduce((s, o) => s + o.left, 0n);
    const row = (o) => {
        const vs = vsSwap(o.rate, m.swapRate);
        return /*html*/`
        <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-white/[0.06] px-3 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] ${o.id === bestId ? "bg-emerald-500/[0.05]" : ""}" data-limit-order="${o.id}">
            <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-1.5"><span class="font-mono text-[15px] tabular-nums text-white">${rateText(o.rate, m)}</span>${o.id === bestId ? tag("Best rate", "green") : ""}${o.mine ? tag("Yours", "brand") : ""}${o.ended ? tag("Ended", "amber") : ""}</p>
                <p class="text-[11px] ${vsTone(vs)}">${vsText(vs) || `#${o.id}`}${o.expiresAt ? ` · ${o.ended ? "ended" : `ends ${timeText(o.expiresAt, data.now)}`}` : ""}${o.partial ? "" : " · all at once"}</p>
                <p class="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">Seller
                    <button type="button" onclick="limitSeller('${o.maker}')" title="Only this seller's orders: ${o.maker}" class="inline-flex min-h-9 items-center rounded-md px-1.5 font-mono text-zinc-300 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-limit-seller="${o.maker}">${escapeHtml(shortAddress(o.maker))}</button>
                </p>
            </div>
            <p class="hidden text-right font-mono text-[13px] tabular-nums text-zinc-200 sm:block">${formNumber(o.left, m.give.decimals, 6)} <span class="text-zinc-500">${escapeHtml(m.give.symbol)}</span></p>
            <p class="hidden text-right font-mono text-[13px] tabular-nums text-zinc-200 sm:block">${formNumber(o.costLeft, m.want.decimals, 6)} <span class="text-zinc-500">${escapeHtml(m.want.symbol)}</span></p>
            <div class="row-span-2 self-center text-right sm:row-span-1">${orderAction(o, data)}</div>
            <p class="text-[12px] text-zinc-400 sm:hidden">${formNumber(o.left, m.give.decimals, 6)} ${escapeHtml(m.give.symbol)} for ${formNumber(o.costLeft, m.want.decimals, 6)} ${escapeHtml(m.want.symbol)}</p>
        </li>`;
    };
    return /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="Orders" data-limit-orders>
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div class="min-w-0">
                <p class="text-[14px] font-semibold text-white">Get ${escapeHtml(m.give.symbol)} · pay ${escapeHtml(m.want.symbol)}</p>
                <p class="text-[12px] text-zinc-500">${live.length} open order${live.length === 1 ? "" : "s"} · rate = ${unit}${state.orderSort === "rate" ? ", best first" : ""}</p>
            </div>
            <dl class="flex gap-4 text-right text-[12px]">
                <div><dt class="text-zinc-500">Best</dt><dd class="font-mono text-emerald-200" data-limit-best>${best ? rateText(best.rate, m) : "—"}</dd></div>
                <div><dt class="text-zinc-500">Swap now</dt><dd class="font-mono text-zinc-200">${m.swapRate ? rateText(m.swapRate, m) : "—"}</dd></div>
                <div><dt class="text-zinc-500">Available</dt><dd class="font-mono text-zinc-200">${formNumber(available, m.give.decimals, 2)} ${escapeHtml(m.give.symbol)}</dd></div>
            </dl>
        </div>
        <div class="mt-3 hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 px-3 text-[11px] uppercase tracking-[0.1em] text-zinc-500 sm:grid">
            <span>Rate</span><span class="text-right">Available</span><span class="text-right">Costs</span><span class="w-[72px]"></span>
        </div>
        <ul class="mt-1 overflow-hidden rounded-2xl border border-white/[0.06]">${shown.map(row).join("") || `<li class="px-3 py-8 text-center text-[13px] text-zinc-500">No open orders for this pair yet. Place the first one.</li>`}</ul>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span class="text-zinc-500">${shown.length} of ${list.length}${ended.length ? ` · <button type="button" onclick="limitShowEnded()" class="inline-flex min-h-9 items-center underline-offset-2 hover:text-white hover:underline">${state.showEnded ? "hide" : "show"} ${ended.length} ended</button>` : ""}</span>
            ${list.length > shown.length ? `<button type="button" onclick="limitMoreOrders()" class="min-h-10 rounded-xl border border-white/10 px-4 text-zinc-200 hover:bg-white/[0.05]">Show ${Math.min(ORDERS_PAGE, list.length - shown.length)} more</button>` : ""}
        </div>
    </section>`;
}

/** Markets that match the search, sorted */
function marketsShown(data) {
    const q = state.marketQuery.trim().toLowerCase();
    const list = data.markets.filter((m) => !q || `${m.give.symbol} ${m.want.symbol} ${m.give.name} ${m.want.name} ${m.give.address} ${m.want.address}`.toLowerCase().includes(q));
    return state.marketSort === "name"
        ? list.sort((a, b) => a.give.symbol.localeCompare(b.give.symbol) || a.want.symbol.localeCompare(b.want.symbol))
        : list.sort((a, b) => b.open - a.open);
}

const marketRows = (data) => {
    const list = marketsShown(data);
    const shown = list.slice(0, state.marketShown);
    return `${shown.map((m) => {
        const on = m.give.address === state.give && m.want.address === state.want;
        return /*html*/`
        <li><button type="button" onclick="limitMarket('${m.give.address}', '${m.want.address}')" data-limit-market="${m.give.symbol}-${m.want.symbol}"
            class="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${on ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <span class="flex shrink-0 -space-x-2">${tokenBadge(m.give, null, "size-6")}${tokenBadge(m.want, null, "size-6")}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-semibold text-white">Get ${escapeHtml(m.give.symbol)} · pay ${escapeHtml(m.want.symbol)}</span><span class="block text-[11px] text-zinc-500">${m.open} open order${m.open === 1 ? "" : "s"}</span></span>
            <span class="shrink-0 text-right font-mono text-[12px] text-emerald-200">${m.best ? formNumber(m.best.rate, m.want.decimals, 6) : "—"}<span class="block font-sans text-[10px] text-zinc-500">${m.best ? `${escapeHtml(m.want.symbol)} per ${escapeHtml(m.give.symbol)}` : "no orders"}</span></span>
        </button></li>`;
    }).join("") || `<li class="px-2 py-6 text-center text-[13px] text-zinc-500">${data.markets.length ? "No market matches." : "No orders yet."}</li>`}
    ${list.length > shown.length ? `<li class="pt-2 text-center"><button type="button" onclick="limitMoreMarkets()" class="min-h-10 rounded-xl border border-white/10 px-4 text-[12px] text-zinc-200 hover:bg-white/[0.05]">Show ${Math.min(MARKETS_PAGE, list.length - shown.length)} more of ${list.length}</button></li>` : ""}`;
};

const marketsSection = (data) => /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="All markets">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-[14px] font-semibold text-white">All markets <span class="font-normal text-zinc-500">(${data.markets.length})</span></p>
            <div class="flex gap-1 text-[12px]">${[ [ "orders", "Most orders" ], [ "name", "A–Z" ] ].map(([ v, l ]) => `<button type="button" onclick="limitMarketSort('${v}')" class="min-h-9 rounded-lg px-2.5 ${state.marketSort === v ? "bg-white/[0.09] text-white" : "text-zinc-400 hover:text-white"}">${l}</button>`).join("")}</div>
        </div>
        <input type="search" oninput="limitMarketSearch(this.value)" value="${escapeHtml(state.marketQuery)}" placeholder="Search a coin (symbol or address)" autocomplete="off" spellcheck="false" aria-label="Search markets" data-limit-market-search
            class="mt-3 w-full rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60" />
        <ul class="mt-2 space-y-0.5" data-limit-markets>${marketRows(data)}</ul>
    </section>`;

/** The new order as typed → { giveAmount, wantAmount, rate, rank, vs, button } */
function draft(data) {
    const m = data.market;
    if (!m) return { button: { label: "Pick two coins", isDisabled: true } };
    const giveAmount = amountOf(state.giveText, m.give.decimals);
    const wantAmount = amountOf(state.wantText, m.want.decimals);
    const out = { giveAmount, wantAmount };
    if (giveAmount > 0n && wantAmount > 0n) {
        out.rate = (wantAmount * 10n ** BigInt(m.give.decimals)) / giveAmount;
        const live = m.orders.filter((o) => !o.ended);
        out.rank = live.filter((o) => o.rate < out.rate || (o.rate === out.rate)).length + 1;
        out.total = live.length + 1;
        out.vs = vsSwap(out.rate, m.swapRate);
    }
    const reserve = m.give.isNative ? data.gasReserve : 0n;
    out.button = !data.isConnected ? { label: "Connect wallet", onclick: "openWallet()" }
        : data.paused ? { label: "Paused by the owner", isDisabled: true }
        : !m.give.enabled || !m.want.enabled ? { label: "Coin turned off", isDisabled: true }
        : giveAmount === null || wantAmount === null ? { label: "Check the amounts", isDisabled: true }
        : !(giveAmount > 0n) ? { label: `Enter ${m.give.symbol} to give`, isDisabled: true }
        : !(wantAmount > 0n) ? { label: `Enter ${m.want.symbol} you want`, isDisabled: true }
        : giveAmount > m.give.balance - reserve ? { label: `Not enough ${m.give.symbol}`, isDisabled: true }
        : { label: `${!m.give.isNative && m.give.allowance < giveAmount ? "Approve & place" : "Place"} order`, onclick: "limitPlace()" };
    return out;
}

function placeCard(data) {
    const m = data.market;
    const d = draft(data);
    const give = m?.give;
    const want = m?.want;
    return /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="Place an order" data-limit-place>
        <p class="text-[14px] font-semibold text-white">Place an order</p>
        <p class="mt-0.5 text-[12px] text-zinc-500">Name your price. Anyone can buy it; you can cancel any time and get back what was not sold.</p>
        <div class="mt-3 rounded-2xl border border-white/[0.07] bg-ink-950/40 p-3">
            <p class="text-[11px] uppercase tracking-[0.12em] text-zinc-500">You give</p>
            <div class="mt-1 flex items-center gap-2">
                <input inputmode="decimal" autocomplete="off" placeholder="0" value="${escapeHtml(state.giveText)}" oninput="limitGiveInput(this.value)" data-limit-give aria-label="Amount you give"
                    class="amount-input min-w-0 flex-1 bg-transparent font-mono text-2xl text-white outline-none placeholder:text-zinc-700" />
                ${coinButton(give, "coin", "give")}
            </div>
            <p class="mt-1 text-[11px] text-zinc-500">${give && data.isConnected ? `Balance ${formNumber(give.balance, give.decimals, 4)} ${escapeHtml(give.symbol)} · <button type="button" onclick="limitMax()" class="inline-flex min-h-9 items-center text-brand-300 hover:text-brand-200">Max</button>` : "&nbsp;"}</p>
        </div>
        <div class="my-1 grid place-items-center"><span class="grid size-8 place-items-center rounded-full border border-white/10 bg-ink-900 text-zinc-400" aria-hidden="true">${icon("arrowDown")}</span></div>
        <div class="rounded-2xl border border-white/[0.07] bg-ink-950/40 p-3">
            <p class="text-[11px] uppercase tracking-[0.12em] text-zinc-500">You want</p>
            <div class="mt-1 flex items-center gap-2">
                <input inputmode="decimal" autocomplete="off" placeholder="0" value="${escapeHtml(state.wantText)}" oninput="limitWantInput(this.value)" data-limit-want aria-label="Amount you want"
                    class="amount-input min-w-0 flex-1 bg-transparent font-mono text-2xl text-white outline-none placeholder:text-zinc-700" />
                ${coinButton(want, "coin", "want")}
            </div>
            <p class="mt-1 text-[11px] text-zinc-500">${m?.swapRate && d.giveAmount > 0n ? `At the Swap price: <button type="button" onclick="limitAtSwap()" class="inline-flex min-h-9 items-center text-brand-300 hover:text-brand-200">${formNumber((d.giveAmount * m.swapRate) / 10n ** BigInt(give.decimals), want.decimals, 6)} ${escapeHtml(want.symbol)}</button>` : "&nbsp;"}</p>
        </div>
        <dl class="mt-3 space-y-1.5 text-[12px]" data-limit-draft>
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">Your rate</dt><dd class="text-right font-mono text-white">${d.rate ? `1 ${escapeHtml(give.symbol)} = ${rateText(d.rate, m)} ${escapeHtml(want.symbol)}` : "—"}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">vs Swap now</dt><dd class="text-right ${d.vs === null || d.vs === undefined ? "text-zinc-400" : d.vs < 0 ? "text-amber-200" : "text-zinc-300"}">${d.vs === null || d.vs === undefined ? "—" : d.vs < 0 ? `you ask ${pct(-d.vs)} less than Swap` : d.vs > 0 ? `you ask ${pct(d.vs)} more than Swap` : "same as Swap"}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">Place in the list</dt><dd class="text-zinc-300" data-limit-rank>${d.rank ? `#${d.rank} of ${d.total}` : "—"}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">Buyers pay a fee of</dt><dd class="text-zinc-300">${give ? `${pct(give.feeBps)} of the ${escapeHtml(give.symbol)} they get` : "—"}</dd></div>
        </dl>
        <div class="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <button type="button" role="switch" aria-checked="${state.partial}" onclick="limitPartial()" data-limit-partial class="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/10 px-3 text-left hover:bg-white/[0.04]">
                <span class="text-zinc-300">Sell in parts</span>
                <span class="relative h-5 w-9 shrink-0 rounded-full ${state.partial ? "bg-brand-500" : "bg-white/15"}"><span class="absolute top-0.5 size-4 rounded-full bg-white transition-all ${state.partial ? "right-0.5" : "left-0.5"}"></span></span>
            </button>
            <label class="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/10 px-3"><span class="text-zinc-300">Ends</span>
                <select onchange="limitEnds(this.value)" data-limit-ends class="bg-transparent text-right text-white outline-none">${ENDS.map((e) => `<option value="${e.id}" ${state.ends === e.id ? "selected" : ""} class="bg-ink-900">${e.label}</option>`).join("")}</select>
            </label>
        </div>
        <button type="button" data-limit-place-button ${d.button.isDisabled ? "disabled" : ""} onclick="${d.button.onclick ?? ""}" class="btn-brand mt-4 min-h-12 w-full rounded-2xl text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">${escapeHtml(d.button.label)}</button>
        <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">Your ${escapeHtml(give?.symbol ?? "coins")} wait in the limit-order program until someone buys or you cancel. ${state.partial ? "Buyers may take part of it; each part pays you at your rate." : "It is sold all at once or not at all."}</p>
    </section>`;
}

/** The buy window for one order */
function buyDialog(data) {
    const m = data.market;
    const o = m?.orders.find((x) => String(x.id) === String(state.buy));
    if (!o) return "";
    const amount = amountOf(state.buyText, m.give.decimals);
    const p = amount > 0n ? priceFor(o, amount, m.give.feeBps) : null;
    const reserve = m.want.isNative ? data.gasReserve : 0n;
    const vs = p && m.swapRate ? (p.cost * 10_000n) / ((amount * m.swapRate) / 10n ** BigInt(m.give.decimals) || 1n) : null;
    const button = amount === null ? { label: "Check the amount", isDisabled: true }
        : !(amount > 0n) ? { label: `Enter the ${m.give.symbol} you want`, isDisabled: true }
        : amount > o.left ? { label: `Only ${formNumber(o.left, m.give.decimals, 6)} left`, isDisabled: true }
        : !o.partial && amount !== o.left ? { label: "This order is sold all at once", isDisabled: true }
        : p.cost > m.want.balance - reserve ? { label: `Not enough ${m.want.symbol}`, isDisabled: true }
        : { label: `${!m.want.isNative && m.want.allowance < p.cost ? "Approve & buy" : "Buy"} ${formNumber(amount, m.give.decimals, 6)} ${m.give.symbol}`, onclick: "limitBuy()" };
    return /*html*/`
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 backdrop-blur-sm sm:items-center sm:p-4" onclick="if (event.target === this) limitBuyClose()" data-limit-dialog>
        <div class="surface w-full max-w-md rounded-t-3xl p-5 sm:rounded-3xl" role="dialog" aria-modal="true" aria-label="Buy from order ${o.id}">
            <div class="flex items-center justify-between gap-3"><p class="text-[15px] font-semibold text-white">Buy from order #${o.id}</p><button type="button" onclick="limitBuyClose()" class="grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-white" aria-label="Close">${icon("close")}</button></div>
            <p class="mt-1 text-[12px] text-zinc-500">1 ${escapeHtml(m.give.symbol)} = ${rateText(o.rate, m)} ${escapeHtml(m.want.symbol)} · ${o.partial ? "buy any part" : "all at once"}</p>
            <p class="mt-3 rounded-xl border border-white/[0.07] px-3 py-2 text-[11px] text-zinc-500">Seller <span class="block break-all font-mono text-[12px] text-zinc-200" data-limit-buy-seller>${escapeHtml(o.maker)}</span></p>
            <div class="mt-3 rounded-2xl border border-white/[0.07] bg-ink-950/40 p-3">
                <p class="text-[11px] uppercase tracking-[0.12em] text-zinc-500">You get</p>
                <div class="mt-1 flex items-center gap-2">
                    <input inputmode="decimal" autocomplete="off" placeholder="0" value="${escapeHtml(state.buyText)}" oninput="limitBuyInput(this.value)" ${o.partial ? "" : "readonly"} data-limit-buy-amount aria-label="Amount to buy"
                        class="amount-input min-w-0 flex-1 bg-transparent font-mono text-2xl text-white outline-none placeholder:text-zinc-700" />
                    <span class="flex shrink-0 items-center gap-2 text-white">${tokenBadge(m.give, null, "size-6")}${escapeHtml(m.give.symbol)}</span>
                </div>
                <p class="mt-1 text-[11px] text-zinc-500">Up to ${formNumber(o.left, m.give.decimals, 6)} · <button type="button" onclick="limitBuyAll()" class="inline-flex min-h-9 items-center text-brand-300 hover:text-brand-200">All</button>${data.isConnected ? ` · <button type="button" onclick="limitBuyBudget()" class="inline-flex min-h-9 items-center text-brand-300 hover:text-brand-200">All my ${escapeHtml(m.want.symbol)}</button>` : ""}</p>
            </div>
            <dl class="mt-3 space-y-1.5 text-[13px]" data-limit-buy-summary>
                <div class="flex justify-between gap-3"><dt class="text-zinc-500">You pay</dt><dd class="font-mono text-white">${p ? `${formNumber(p.cost, m.want.decimals, 6)} ${escapeHtml(m.want.symbol)}` : "—"}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-zinc-500">Fee (${pct(m.give.feeBps)})</dt><dd class="font-mono text-zinc-300">${p ? `${formNumber(p.fee, m.give.decimals, 6)} ${escapeHtml(m.give.symbol)}` : "—"}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-zinc-500">You receive</dt><dd class="font-mono text-emerald-200">${p ? `${formNumber(p.receive, m.give.decimals, 6)} ${escapeHtml(m.give.symbol)}` : "—"}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-zinc-500">vs Swap</dt><dd class="${vs !== null && vs < 10_000n ? "text-emerald-200" : "text-zinc-300"}">${vs === null ? "—" : vs < 10_000n ? `${pct(Number(10_000n - vs))} cheaper` : vs > 10_000n ? `${pct(Number(vs - 10_000n))} dearer` : "same"}</dd></div>
                ${data.isConnected ? `<div class="flex justify-between gap-3"><dt class="text-zinc-500">Your ${escapeHtml(m.want.symbol)}</dt><dd class="font-mono text-zinc-400">${formNumber(m.want.balance, m.want.decimals, 4)}</dd></div>` : ""}
            </dl>
            ${data.isConnected
                ? `<button type="button" data-limit-buy-button ${button.isDisabled ? "disabled" : ""} onclick="${button.onclick ?? ""}" class="btn-brand mt-4 min-h-12 w-full rounded-2xl text-[15px] font-semibold">${escapeHtml(button.label)}</button>`
                : `<button type="button" onclick="openWallet()" class="btn-brand mt-4 min-h-12 w-full rounded-2xl text-[15px] font-semibold">Connect wallet</button>`}
            <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">One transaction: your ${escapeHtml(m.want.symbol)} goes to the seller, the ${escapeHtml(m.give.symbol)} comes to you. If someone buys it first, nothing is taken.</p>
        </div>
    </div>`;
}

/* ------------------------------------ My orders */

function mineSection(data) {
    if (!data.isConnected) return `<section class="surface rounded-3xl p-6 text-center text-[13px] text-zinc-400">Connect a wallet to see your orders. <button type="button" onclick="openWallet()" class="ml-1 inline-flex min-h-9 items-center text-brand-300 hover:text-brand-200">Connect</button></section>`;
    const mine = state.mine ?? { count: 0, orders: [] };
    const coin = (a) => data.coins.find((c) => c.address === lower(a)) ?? { symbol: shortAddress(a), decimals: 18, address: a };
    const list = mine.orders.filter((o) => state.mineFilter === "all" || o.status === "open");
    const now = data.now;
    const row = (o) => {
        const g = coin(o.give);
        const w = coin(o.want);
        const ended = o.status === "open" && o.expiresAt > 0n && Number(o.expiresAt) <= now;
        const sold = o.giveAmount - o.left;
        const percent = Number((sold * 1000n) / o.giveAmount) / 10;
        const status = o.status === "open" ? (ended ? tag("Ended", "amber") : tag("Open", "green")) : o.status === "filled" ? tag("Sold", "brand") : tag(o.status === "expired" ? "Returned" : "Cancelled", "zinc");
        return /*html*/`
        <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-limit-mine="${o.id}">
            <span class="flex shrink-0 -space-x-2">${tokenBadge(g, null, "size-7")}${tokenBadge(w, null, "size-7")}</span>
            <span class="min-w-0 flex-1"><span class="block text-[14px] text-white">Give <b>${formNumber(o.giveAmount, g.decimals, 6)} ${escapeHtml(g.symbol)}</b> for <b>${formNumber(o.wantAmount, w.decimals, 6)} ${escapeHtml(w.symbol)}</b></span>
                <span class="block text-[11px] text-zinc-500">order #${o.id} · ${o.partial ? "in parts" : "all at once"}${o.expiresAt > 0n && o.status === "open" ? ` · ${ended ? "ended" : `ends ${timeText(Number(o.expiresAt), now)}`}` : ""}</span></span>
            <span class="w-full sm:w-44"><span class="block h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span class="block h-full bg-brand-400" style="width:${Math.min(100, percent)}%"></span></span><span class="mt-1 block text-[11px] text-zinc-500">${percent}% sold${o.received > 0n ? ` · ${formNumber(o.received, w.decimals, 4)} ${escapeHtml(w.symbol)} received` : ""}</span></span>
            ${status}
            ${o.status === "open" ? `<button type="button" onclick="limitCancel('${o.id}')" class="min-h-10 rounded-xl border border-white/15 px-3 text-[13px] text-zinc-200 hover:bg-white/[0.06]">${ended ? "Take back" : "Cancel"}</button>` : ""}
        </li>`;
    };
    return /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="My orders" data-limit-mine-list>
        <div class="flex flex-wrap items-center justify-between gap-2">${tabs([ { id: "open", label: "Open" }, { id: "all", label: "All" } ], state.mineFilter, "limitMineFilter")}<span class="text-[12px] text-zinc-500">${mine.count} order${mine.count === 1 ? "" : "s"} in all</span></div>
        <ul class="mt-2 divide-y divide-white/[0.06]">${list.map(row).join("") || `<li class="py-8 text-center text-[13px] text-zinc-500">${state.mineFilter === "open" ? "No open orders." : "No orders yet."}</li>`}</ul>
        ${mine.orders.length < mine.count ? `<div class="mt-3 text-center"><button type="button" onclick="limitMoreMine()" class="min-h-10 rounded-xl border border-white/10 px-4 text-[12px] text-zinc-200 hover:bg-white/[0.05]">Load ${Math.min(50, mine.count - mine.orders.length)} older</button></div>` : ""}
        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] p-3 text-[12px] text-zinc-400">
            <span class="min-w-0 flex-1">Send friends a link to only your orders, so they can buy from you directly.</span>
            <button type="button" onclick="limitShare(this)" class="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3 font-semibold text-zinc-200 hover:bg-white/[0.06]" data-limit-share>${icon("link")}Copy my link</button>
        </div>
        <p class="mt-3 text-[12px] text-zinc-500">What sells goes straight to your wallet. Cancel, or Take back after the end: the unsold coins come back to you.</p>
    </section>`;
}

/* ------------------------------------ Owner */

function ownerSection(data) {
    const q = state.coinQuery.trim().toLowerCase();
    const list = data.coins.filter((c) => !q || `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(q));
    const shown = list.slice(0, state.coinShown);
    return /*html*/`
    <section class="surface rounded-3xl p-4" aria-label="Owner" data-limit-owner>
        <p class="text-[14px] font-semibold text-white">Coins people can trade</p>
        <p class="mt-0.5 text-[12px] text-zinc-500">Only listed coins can be put up or asked for. Each coin has its own fee, taken from what buyers receive (at most ${pct(data.maxFeeBps)}). A coin turned off stops new orders and buying; people can still cancel and get their coins back.</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <input oninput="limitNewCoin(this.value)" value="${escapeHtml(state.newCoin)}" placeholder="Token address (0x…), or 0x0…0 for ${escapeHtml(nativeCoin(HUB).symbol)}" spellcheck="false" autocomplete="off" aria-label="Token address" data-limit-new-coin
                class="min-h-11 rounded-xl border border-white/10 bg-ink-950/70 px-3 font-mono text-[13px] text-white outline-none placeholder:font-sans placeholder:text-zinc-600 focus:border-brand-400/60" />
            <label class="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-ink-950/70 px-3 text-[13px]"><input oninput="limitNewFee(this.value)" value="${escapeHtml(state.newFee)}" inputmode="decimal" aria-label="Fee in percent" data-limit-new-fee class="w-full bg-transparent text-right text-white outline-none" /><span class="text-zinc-500">%</span></label>
            <button type="button" onclick="limitAddCoin()" class="btn-brand min-h-11 rounded-xl px-4 text-[14px] font-semibold">Add coin</button>
        </div>
        <input type="search" oninput="limitCoinSearch(this.value)" value="${escapeHtml(state.coinQuery)}" placeholder="Search ${data.coins.length} listed coins" aria-label="Search listed coins" data-limit-coin-search
            class="mt-4 w-full rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60" />
        <ul class="mt-2 divide-y divide-white/[0.06]" data-limit-owner-coins>
            ${shown.map((c) => /*html*/`
            <li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-limit-owner-coin="${c.symbol}">
                ${tokenBadge(c, null, "size-7")}
                <span class="min-w-0 flex-1"><span class="block text-[14px] font-semibold text-white">${escapeHtml(c.symbol)} ${c.enabled ? "" : tag("Off", "amber")}</span><span class="block truncate font-mono text-[11px] text-zinc-500">${escapeHtml(c.address)}</span></span>
                <span class="text-right text-[11px] text-zinc-500">Fees here<span class="block font-mono text-[13px] text-zinc-200">${formNumber(c.fees, c.decimals, 4)}</span></span>
                <label class="flex min-h-10 w-24 items-center gap-1 rounded-xl border border-white/10 px-2 text-[13px]"><input value="${escapeHtml(state.fees[c.address] ?? String(c.feeBps / 100))}" oninput="limitFeeInput('${c.address}', this.value)" inputmode="decimal" aria-label="${escapeHtml(c.symbol)} fee in percent" class="w-full bg-transparent text-right text-white outline-none" /><span class="text-zinc-500">%</span></label>
                <button type="button" onclick="limitSaveCoin('${c.address}', ${c.enabled})" class="min-h-10 rounded-xl border border-white/15 px-3 text-[12px] text-zinc-200 hover:bg-white/[0.06]">Save fee</button>
                <button type="button" onclick="limitSaveCoin('${c.address}', ${!c.enabled})" class="min-h-10 rounded-xl border border-white/15 px-3 text-[12px] ${c.enabled ? "text-amber-100" : "text-emerald-200"} hover:bg-white/[0.06]">${c.enabled ? "Turn off" : "Turn on"}</button>
                <button type="button" onclick="limitWithdraw('${c.address}')" ${c.fees > 0n ? "" : "disabled"} class="min-h-10 rounded-xl border border-white/15 px-3 text-[12px] text-zinc-200 hover:bg-white/[0.06] disabled:opacity-40">Withdraw</button>
            </li>`).join("") || `<li class="py-6 text-center text-[13px] text-zinc-500">No coin matches.</li>`}
        </ul>
        ${list.length > shown.length ? `<div class="mt-3 text-center"><button type="button" onclick="limitMoreCoins()" class="min-h-10 rounded-xl border border-white/10 px-4 text-[12px] text-zinc-200 hover:bg-white/[0.05]">Show ${Math.min(COINS_PAGE, list.length - shown.length)} more of ${list.length}</button></div>` : ""}
    </section>`;
}

/* ------------------------------------ page */

const notReady = /*html*/`
    <main class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        ${tradeTabs("limit")}
        ${pageHead("Limit orders", "Limit orders are not set up yet", "Add the BwscLimit address to settings/config.js (programs.limit) after deploying it (deploy-kit/README.md, step 4b).")}
    </main>`;

const limitPage = (data) => {
    if (!data.isReady) return notReady;
    last = data;
    const mineCount = state.mine?.orders.filter((o) => o.status === "open").length;
    const items = [ { id: "market", label: "Market" }, { id: "mine", label: `My orders${mineCount ? ` (${mineCount})` : ""}` }, ...(data.isOwner ? [ { id: "owner", label: "Owner" } ] : []) ];
    return /*html*/`
    <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 2xl:max-w-7xl">
        ${tradeTabs("limit")}
        ${pageHead("Limit orders", "Trade coin for coin, at your price", `Put up one coin and ask for another, or buy from someone else's order. Everything stays on ${escapeHtml(HUB === "bwsc" ? "Bluewolfchain" : HUB)}: ${escapeHtml(nativeCoin(HUB).symbol)} and every listed token. ${data.coins.length} coins, ${data.markets.length} markets.`)}
        ${data.paused ? `<div class="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">Limit orders are paused by the owner: no new orders and no buying. Cancelling still works.</div>` : ""}
        <div class="mb-4" data-rise>${tabs(items, state.tab, "limitTab")}</div>
        ${state.tab === "mine" ? mineSection(data) : state.tab === "owner" && data.isOwner ? ownerSection(data) : /*html*/`
        ${pairBar(data)}
        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-rise="3">
            <div class="min-w-0 space-y-4">${sellerSection(data)}${ordersSection(data)}${marketsSection(data)}</div>
            <div class="min-w-0">${placeCard(data)}</div>
        </div>`}
        ${state.buy !== null ? buyDialog(data) : ""}
    </main>`;
};

/* ------------------------------------ actions (wired in ui/main.js) */

const limitTab = (id) => { state.tab = id; state.buy = null; if (id === "mine") state.mine = null; };
const setMarket = (give, want) => { state.give = lower(give); state.want = lower(want); state.orderShown = ORDERS_PAGE; state.showEnded = false; state.buy = null; state.wantText = ""; };
const limitMarket = (give, want) => { setMarket(give, want); state.tab = "market"; };
const limitFlip = () => setMarket(state.want, state.give);

/** Coin list for one side: searchable, with how many open orders each coin has; picking the other side's coin swaps */
function limitPickCoin(side, done = () => {}) {
    if (!last) return;
    const counts = ordersPerCoin(last);
    const items = [ ...last.coins ]
        .sort((a, b) => (counts.get(b.address) ?? 0) - (counts.get(a.address) ?? 0) || a.symbol.localeCompare(b.symbol))
        .map((c) => ({ id: c.address, label: c.symbol, sub: `${c.name || c.symbol}${c.isNative ? " · native coin" : ` · ${c.address.slice(0, 6)}…${c.address.slice(-4)}`}${c.enabled ? "" : " · off"}`, search: c.address, badge: tokenBadge(c), right: counts.get(c.address) ? `${counts.get(c.address)} order${counts.get(c.address) === 1 ? "" : "s"}` : "", note: c.enabled ? "" : "off" }));
    openPicker({
        title: side === "give" ? "Coin you get" : "Coin you pay with",
        placeholder: `Search ${last.coins.length} coins (symbol, name or address)`,
        items,
        onPick: (address) => {
            const other = side === "give" ? state.want : state.give;
            if (address === other) setMarket(state.want, state.give);
            else if (side === "give") setMarket(address, state.want);
            else setMarket(state.give, address);
            done();
        },
    });
}

const limitSort = (value) => { state.orderSort = value; state.orderShown = ORDERS_PAGE; };
const limitMoreOrders = () => { state.orderShown += ORDERS_PAGE; };
const limitShowEnded = () => { state.showEnded = !state.showEnded; };
const limitMarketSort = (value) => { state.marketSort = value; state.marketShown = MARKETS_PAGE; };
const limitMoreMarkets = () => { state.marketShown += MARKETS_PAGE; };
/** Search patches the list in place, so the box keeps focus */
const limitMarketSearch = (value) => {
    state.marketQuery = String(value ?? "");
    state.marketShown = MARKETS_PAGE;
    const el = document.querySelector("[data-limit-markets]");
    if (el && last) el.innerHTML = marketRows(last);
};

/** Typing in the form: only the summary and the button change (the input keeps focus) */
function patchDraft() {
    if (!last) return;
    const card = document.querySelector("[data-limit-place]");
    if (!card) return;
    const fresh = document.createElement("div");
    fresh.innerHTML = placeCard(last);
    const next = fresh.firstElementChild;
    for (const sel of [ "[data-limit-draft]", "[data-limit-place-button]" ]) card.querySelector(sel)?.replaceWith(next.querySelector(sel));
    const hint = card.querySelector("[data-limit-want]")?.parentElement?.nextElementSibling;
    const nextHint = next.querySelector("[data-limit-want]")?.parentElement?.nextElementSibling;
    if (hint && nextHint) hint.innerHTML = nextHint.innerHTML;
}
const limitGiveInput = (value) => { state.giveText = String(value ?? ""); patchDraft(); };
const limitWantInput = (value) => { state.wantText = String(value ?? ""); patchDraft(); };
const limitPartial = () => { state.partial = !state.partial; };
const limitEnds = (value) => { state.ends = Number(value); };
function limitMax() {
    const g = last?.market?.give;
    if (!g) return;
    const max = g.balance - (g.isNative ? last.gasReserve : 0n);
    state.giveText = fromUnits(max > 0n ? max : 0n, g.decimals);
}
function limitAtSwap() {
    const m = last?.market;
    const give = amountOf(state.giveText, m?.give.decimals ?? 18);
    if (!m?.swapRate || !(give > 0n)) return;
    state.wantText = fromUnits((give * m.swapRate) / 10n ** BigInt(m.give.decimals), m.want.decimals);
}
function limitPlaceOrder() {
    const m = last?.market;
    if (!m) throw new Error("Pick two coins.");
    const d = draft(last);
    if (!(d.giveAmount > 0n) || !(d.wantAmount > 0n)) throw new Error("Enter both amounts.");
    return { give: m.give.address, want: m.want.address, giveAmount: d.giveAmount, wantAmount: d.wantAmount, partial: state.partial, endsInSeconds: state.ends,
        label: `${formNumber(d.giveAmount, m.give.decimals, 6)} ${m.give.symbol} for ${formNumber(d.wantAmount, m.want.decimals, 6)} ${m.want.symbol}` };
}
const limitPlaceReset = () => { state.giveText = ""; state.wantText = ""; };

/* buying */
const limitBuyOpen = (id) => {
    state.buy = String(id);
    const o = last?.market?.orders.find((x) => String(x.id) === String(id));
    state.buyText = o && !o.partial ? fromUnits(o.left, last.market.give.decimals) : "";
};
const limitBuyClose = () => { state.buy = null; state.buyText = ""; };
function limitBuyInput(value) {
    state.buyText = String(value ?? "");
    const box = document.querySelector("[data-limit-dialog]");
    if (!box || !last) return;
    const fresh = document.createElement("div");
    fresh.innerHTML = buyDialog(last);
    for (const sel of [ "[data-limit-buy-summary]", "[data-limit-buy-button]" ]) box.querySelector(sel)?.replaceWith(fresh.querySelector(sel));
}
const buyOrder = () => last?.market?.orders.find((x) => String(x.id) === String(state.buy)) ?? null;
const limitBuyAll = () => { const o = buyOrder(); if (o) state.buyText = fromUnits(o.left, last.market.give.decimals); };
function limitBuyBudget() {
    const o = buyOrder();
    const m = last?.market;
    if (!o || !m) return;
    const budget = m.want.balance - (m.want.isNative ? last.gasReserve : 0n);
    const most = budget > 0n ? amountForBudget(o, budget) : 0n;
    state.buyText = fromUnits(most < o.left ? most : o.left, m.give.decimals);
}
function limitBuyOrder() {
    const o = buyOrder();
    const m = last?.market;
    if (!o || !m) throw new Error("This order is no longer open.");
    const amount = amountOf(state.buyText, m.give.decimals);
    if (!(amount > 0n)) throw new Error("Enter how much you want.");
    return { give: m.give.address, want: m.want.address, id: o.id, amount, label: `${formNumber(amount, m.give.decimals, 6)} ${m.give.symbol}` };
}

/* my orders */
const limitMineFilter = (id) => { state.mineFilter = id; };
async function limitMoreMine(wallet) {
    if (!state.mine) return;
    const page = await getMyOrders(wallet, { offset: state.mine.orders.length });
    state.mine = { ...state.mine, count: page.count, orders: [ ...state.mine.orders, ...page.orders ] };
}
const limitMineReset = () => { state.mine = null; };

/* seller filter */
const setSellerHash = () => history.replaceState(null, "", `#/limit${state.seller ? `?seller=${state.seller}` : ""}`);
const limitSeller = (address) => { state.seller = isAddr(address) ? lower(address) : ""; state.sellerText = state.seller; state.sellerOrders = null; state.tab = "market"; state.orderShown = ORDERS_PAGE; setSellerHash(); };
const limitSellerInput = (value) => { state.sellerText = String(value ?? "").trim(); };
function limitSellerApply() {
    if (!state.sellerText) return limitSeller("");
    if (!isAddr(state.sellerText)) throw new Error("Paste a wallet address (0x + 40 characters).");
    limitSeller(state.sellerText);
}
/** The link to only the connected wallet's orders */
const limitShareLink = (wallet) => `${window.location.origin}${window.location.pathname}#/limit?seller=${lower(wallet?.address)}`;

/* owner */
const limitNewCoin = (value) => { state.newCoin = String(value ?? "").trim(); };
const limitNewFee = (value) => { state.newFee = String(value ?? "").trim(); };
const bpsOf = (text) => { const n = Number(String(text).replace(/,/g, ".")); if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error("The fee is 0% to 5%."); return Math.round(n * 100); };
const limitAddCoinOrder = () => ({ token: state.newCoin, feeBps: bpsOf(state.newFee) });
const limitAddCoinReset = () => { state.newCoin = ""; };
const limitFeeInput = (address, value) => { state.fees[address] = String(value ?? ""); };
const limitSaveCoinOrder = (address, enabled) => {
    const c = last?.coins.find((x) => x.address === address);
    return { token: address, enabled, feeBps: bpsOf(state.fees[address] ?? String((c?.feeBps ?? 0) / 100)), symbol: c?.symbol ?? "" };
};
const limitCoinSearch = (value) => {
    state.coinQuery = String(value ?? "");
    state.coinShown = COINS_PAGE;
    const el = document.querySelector("[data-limit-owner-coins]");
    if (el && last) {
        const fresh = document.createElement("div");
        fresh.innerHTML = ownerSection(last);
        el.replaceWith(fresh.querySelector("[data-limit-owner-coins]"));
    }
};
const limitMoreCoins = () => { state.coinShown += COINS_PAGE; };

export {
    loadLimit, limitPage, pageLoading as limitLoadingOf, pageError as limitError,
    limitTab, limitMarket, limitFlip, limitPickCoin, limitSort, limitMoreOrders, limitShowEnded, limitMarketSort, limitMoreMarkets, limitMarketSearch,
    limitGiveInput, limitWantInput, limitPartial, limitEnds, limitMax, limitAtSwap, limitPlaceOrder, limitPlaceReset,
    limitBuyOpen, limitBuyClose, limitBuyInput, limitBuyAll, limitBuyBudget, limitBuyOrder,
    limitMineFilter, limitMoreMine, limitMineReset, limitSeller, limitSellerInput, limitSellerApply, limitShareLink,
    limitNewCoin, limitNewFee, limitAddCoinOrder, limitAddCoinReset, limitFeeInput, limitSaveCoinOrder, limitCoinSearch, limitMoreCoins,
};
