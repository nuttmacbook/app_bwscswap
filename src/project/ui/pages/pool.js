/*
 * YOUR CODE (off-chain). Pools page, built for many pairs:
 *   - every pair in a searchable list (symbol, name or address), "My positions" filter, 20 at a time
 *   - one pair opened: your position, add liquidity (the second amount follows the price), take it out (25 … 100%);
 *     on a pair with wBWSC you can pay and receive the native coin directly
 *   - "New pair" for the owner (or anyone, when the owner opened it): any two coins, the native coin included
 * Previews use the page's read; the program checks again (minShares / minA / minB with the slippage below).
 */

import { icon } from "../icons";
import { depositPreview, withdrawPreview, pairedAmount, withSlippage, listedTokens, pairFor, HUB } from "../../chain";
import { formNumber, escapeHtml, toUnits, fromUnits, shortAmount } from "../../../engine/ui/helpers";
import { tradeSettings } from "../swapSettings";
import { openPicker } from "../componants/picker";
import { tradeTabs, tokenBadge, priceText, shareText, feeText, pageLoading, pageError, tabs } from "./shared";

const ZERO = "0x0000000000000000000000000000000000000000";
const PARTS = [ 25, 50, 75, 100 ];
const PAGE = 20;
const form = { open: "", query: "", filter: "all", shown: PAGE, textA: "", textB: "", percent: 50, useNative: true, newA: "", newB: "", newFee: "" };
let last = null;

const parse = (text, decimals) => {
    if (!String(text ?? "").trim()) return { amount: 0n, error: "" };
    try { return { amount: toUnits(text, decimals), error: "" }; } catch (err) { return { amount: 0n, error: err.message }; }
};
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ""));

/* ------------------------------------ one pair */

/** The open pair with both sides as the page shows them: the wBWSC side becomes the native coin when useNative */
function opened(data = last) {
    const p = data?.pairs.find((x) => x.id === form.open);
    if (!p) return null;
    const side = (t, reserve) => {
        const asNative = p.hasNative && form.useNative && t.address === data.wrapped;
        const coin = asNative ? data.native : t;
        return { ...coin, reserve, isNative: asNative, allowance: asNative ? reserve + coin.balance + 1n : t.allowance };
    };
    return { ...p, a: side(p.tokenA, p.reserveA), b: side(p.tokenB, p.reserveB) };
}

function depositState(p) {
    const a = parse(form.textA, p.a.decimals);
    const b = parse(form.textB, p.b.decimals);
    const plan = depositPreview({ amountA: a.amount, amountB: b.amount, reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares, minimumLiquidity: last.minimumLiquidity });
    return { plan, error: a.error || b.error };
}

function addAction(p) {
    const { plan, error } = depositState(p);
    if (!last.isConnected) return { label: "Connect wallet", onclick: "openWallet()", isDisabled: false };
    if (last.isPaused) return { label: "Paused: no new deposits", isDisabled: true };
    if (error) return { label: error, isDisabled: true };
    if (!form.textA.trim() || !form.textB.trim()) return { label: "Enter both amounts", isDisabled: true };
    if (plan.shares === 0n) return { label: p.totalShares === 0n ? "First deposit is too small" : "Amounts too small", isDisabled: true };
    if (plan.amountA > p.a.balance) return { label: `Not enough ${p.a.symbol}`, isDisabled: true };
    if (plan.amountB > p.b.balance) return { label: `Not enough ${p.b.symbol}`, isDisabled: true };
    const approvals = Number(!p.a.isNative && p.a.allowance < plan.amountA) + Number(!p.b.isNative && p.b.allowance < plan.amountB);
    return { label: approvals ? `Approve & add (${approvals + 1} steps)` : "Add liquidity", onclick: "doAddLiquidity()", isDisabled: false };
}

const sharesToRemove = (p) => (p.myShares * BigInt(form.percent)) / 100n;

function addSummary(p) {
    const { plan } = depositState(p);
    if (!plan.shares) return /*html*/`<p class="text-zinc-500">${p.totalShares === 0n ? "You set the starting price with the first deposit." : "The second amount follows the pair's price."}</p>`;
    const after = p.totalShares === 0n ? plan.shares + last.minimumLiquidity : p.totalShares + plan.shares;
    return /*html*/`
        <div class="flex justify-between gap-3"><dt class="text-zinc-500">The pair takes</dt><dd class="text-right font-mono tabular-nums text-white">${formNumber(plan.amountA, p.a.decimals, 6)} ${escapeHtml(p.a.symbol)} + ${formNumber(plan.amountB, p.b.decimals, 6)} ${escapeHtml(p.b.symbol)}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-zinc-500">Your share after</dt><dd class="font-mono tabular-nums text-zinc-200">${shareText(p.myShares + plan.shares, after)}</dd></div>`;
}

const paintAdd = () => {
    const p = opened();
    if (!p || typeof document === "undefined") return;
    const summary = document.querySelector("[data-add-summary]");
    if (summary) summary.innerHTML = addSummary(p);
    const button = document.querySelector("[data-add-button]");
    const state = addAction(p);
    if (button) {
        button.textContent = state.label;
        button.disabled = state.isDisabled;
        button.setAttribute("onclick", state.onclick ?? "");
    }
};

const field = ({ token, key, value }) => /*html*/`
    <label class="block rounded-2xl border border-white/[0.07] bg-ink-950/60 p-4 focus-within:border-brand-400/50">
        <span class="flex items-center justify-between gap-3 text-[12px] text-zinc-500">
            <span>${escapeHtml(token.symbol)}</span>
            <span class="whitespace-nowrap">Balance <span class="font-mono tabular-nums text-zinc-300">${formNumber(token.balance, token.decimals, 4)}</span></span>
        </span>
        <span class="mt-2 flex items-center gap-3">
            <input data-add-${key} oninput="poolInput('${key}', this.value)" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0" value="${escapeHtml(value)}"
                aria-label="Amount of ${escapeHtml(token.symbol)}" class="amount-input min-w-0 flex-1 bg-transparent font-mono text-[22px] tabular-nums text-white outline-none placeholder:text-zinc-600 sm:text-[26px]" />
            ${tokenBadge(token)}
        </span>
    </label>`;

const row = (label, value) => /*html*/`<div class="flex items-center justify-between gap-3 py-2"><dt class="min-w-0 text-zinc-500">${label}</dt><dd class="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-zinc-100">${value}</dd></div>`;

function pairView(p) {
    const a = p.a;
    const b = p.b;
    const mine = withdrawPreview({ shares: p.myShares, reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares });
    const out = withdrawPreview({ shares: sharesToRemove(p), reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares });
    const add = addAction(p);
    const wrappedSym = last.tokens.find((t) => t.address === last.wrapped)?.symbol ?? "wrapped";
    return /*html*/`
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3" data-rise>
            <button type="button" onclick="poolOpen('')" class="-mx-2 inline-flex min-h-10 items-center rounded-lg px-2 text-[13px] font-medium text-brand-300 hover:text-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 gap-1.5">${icon("arrowLeft")}All pools</button>
            ${p.hasNative ? /*html*/`
                <div class="flex items-center gap-2 text-[12px] text-zinc-400" role="group" aria-label="Native coin or wrapped token">
                    <span>Use</span>
                    ${tabs([ { id: "native", label: last.native.symbol }, { id: "wrapped", label: wrappedSym } ], form.useNative ? "native" : "wrapped", "poolNative")}
                </div>` : ""}
        </div>
        <div class="mb-6" data-rise>
            <h1 class="text-2xl font-semibold tracking-tight text-white">${escapeHtml(a.symbol)} / ${escapeHtml(b.symbol)}</h1>
            <p class="mt-2 max-w-2xl text-[14px] leading-relaxed text-zinc-400">Deposit both coins at the pair's price and receive shares. Every swap through this pair pays ${feeText(p.feeBps)} into it, which raises what each share is worth. Prices move, so what you take out can differ from what you put in.</p>
        </div>
        ${last.isPaused ? /*html*/`<div class="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">Paused by the owner: no swaps and no new deposits. Taking liquidity out still works.</div>` : ""}

        <div class="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <section class="surface min-w-0 rounded-3xl p-5 sm:p-6" data-rise="2" aria-label="Your position">
                <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Your position</p>
                <p class="mt-2 font-mono text-[26px] tabular-nums text-white">${shareText(p.myShares, p.totalShares)}</p>
                <p class="text-[12px] text-zinc-500">of the pair</p>
                <dl class="mt-4 divide-y divide-white/[0.06] border-y border-white/[0.06] text-[13px]">
                    ${row(`${escapeHtml(a.symbol)} you can take out`, formNumber(mine.amountA, a.decimals, 4))}
                    ${row(`${escapeHtml(b.symbol)} you can take out`, formNumber(mine.amountB, b.decimals, 4))}
                </dl>

                <p class="mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Pair</p>
                <dl class="mt-1 divide-y divide-white/[0.06] text-[13px]">
                    ${row("Price", priceText(a, b, 4))}
                    ${row(`${escapeHtml(a.symbol)} in the pair`, formNumber(p.reserveA, a.decimals, 2))}
                    ${row(`${escapeHtml(b.symbol)} in the pair`, formNumber(p.reserveB, b.decimals, 2))}
                    ${row("Fee to providers", feeText(p.feeBps))}
                </dl>

                ${p.myShares > 0n ? /*html*/`
                <div class="mt-6 rounded-2xl border border-white/[0.07] bg-ink-950/60 p-4">
                    <p class="text-[13px] font-semibold text-white">Take liquidity out</p>
                    <div class="mt-3 grid grid-cols-4 gap-1.5" role="group" aria-label="How much">
                        ${PARTS.map((x) => /*html*/`
                            <button type="button" onclick="poolPercent(${x})" aria-pressed="${x === form.percent}"
                                class="rounded-lg border py-1.5 font-mono text-[13px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                                ${x === form.percent ? "border-brand-400/60 bg-brand-400/10 text-brand-200" : "border-white/10 text-zinc-400 hover:text-white"}">${x}%</button>`).join("")}
                    </div>
                    <dl class="mt-3 space-y-1 text-[13px]">
                        <div class="flex justify-between gap-3"><dt class="text-zinc-500">You get about</dt><dd class="text-right font-mono tabular-nums text-zinc-100">${formNumber(out.amountA, a.decimals, 4)} ${escapeHtml(a.symbol)}<br />${formNumber(out.amountB, b.decimals, 4)} ${escapeHtml(b.symbol)}</dd></div>
                    </dl>
                    <button type="button" onclick="doRemoveLiquidity()" class="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Take out ${form.percent}%</button>
                </div>` : /*html*/`<p class="mt-6 text-[13px] text-zinc-500">${last.isConnected ? "You have no liquidity in this pair yet." : "Connect a wallet to see your position."}</p>`}
            </section>

            <section class="surface min-w-0 rounded-3xl p-3 sm:p-4" data-rise="3" aria-label="Add liquidity">
                <p class="px-1.5 pb-3 pt-1 text-[13px] font-semibold text-white">Add liquidity</p>
                <div class="space-y-2">
                    ${field({ token: a, key: "a", value: form.textA })}
                    ${field({ token: b, key: "b", value: form.textB })}
                </div>
                <dl class="space-y-2 px-1.5 pt-4 text-[13px]" data-add-summary>${addSummary(p)}</dl>
                <button type="button" data-add-button onclick="${add.onclick ?? ""}" ${add.isDisabled ? "disabled" : ""}
                    class="btn-brand mt-4 w-full rounded-2xl px-5 py-3.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900">${escapeHtml(add.label)}</button>
                <p class="px-1.5 pt-3 text-[12px] leading-relaxed text-zinc-500">Approvals are for exactly what the pair takes; one approval per coin covers every pair. If the price moves more than ${tradeSettings().slippageBps / 100}% before your deposit lands, or it waits more than ${tradeSettings().deadlineMinutes} minutes, the exchange refuses it (change both with the gear on the Swap page).</p>
            </section>
        </div>`;
}

/* ------------------------------------ the list of pairs */

const matches = (p, q) => !q || `${p.tokenA.symbol} ${p.tokenB.symbol} ${p.tokenA.name} ${p.tokenB.name} ${p.tokenA.address} ${p.tokenB.address} ${p.tokenA.symbol}/${p.tokenB.symbol} ${p.tokenB.symbol}/${p.tokenA.symbol}`.toLowerCase().includes(q);
/** The wBWSC side shows as the native coin in the list */
const shownSymbol = (t) => (t.address === last.wrapped ? last.native.symbol : t.symbol);

function filtered(data = last) {
    const q = form.query.trim().toLowerCase();
    return data.pairs
        .filter((p) => (form.filter === "mine" ? p.myShares > 0n : true))
        .filter((p) => matches(p, q) || (p.hasNative && String(data.native.symbol).toLowerCase().includes(q)))
        // Your positions first, then the pairs with the most liquidity shares, then by how old they are
        .sort((x, y) => Number(y.myShares > 0n) - Number(x.myShares > 0n) || (y.totalShares > x.totalShares ? 1 : y.totalShares < x.totalShares ? -1 : 0));
}

function listRows(data = last) {
    const list = filtered(data);
    if (!list.length) return /*html*/`<p class="px-4 py-10 text-center text-[13px] text-zinc-500">${form.filter === "mine" ? "You have no liquidity yet." : "No pair matches."}</p>`;
    return list.slice(0, form.shown).map((p) => /*html*/`
        <button type="button" onclick="poolOpen('${p.id}')" data-pair="${escapeHtml(`${p.tokenA.symbol}/${p.tokenB.symbol}`)}"
            class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-white/[0.05] px-4 py-3 text-left transition first:border-t-0 hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-none sm:grid-cols-[auto_1.2fr_1.4fr_0.6fr_auto]">
            <span class="flex">${tokenBadge({ symbol: shownSymbol(p.tokenA) }, null, "size-7")}<span class="-ml-2">${tokenBadge({ symbol: shownSymbol(p.tokenB) }, null, "size-7")}</span></span>
            <span class="min-w-0">
                <span class="block truncate text-[14px] font-semibold text-white">${escapeHtml(shownSymbol(p.tokenA))} / ${escapeHtml(shownSymbol(p.tokenB))}</span>
                <span class="block truncate text-[12px] text-zinc-500">fee ${feeText(p.feeBps)}${p.tokenA.isListed && p.tokenB.isListed ? "" : " · not in the list"}</span>
            </span>
            <span class="hidden font-mono text-[12px] tabular-nums text-zinc-400 sm:block">${p.totalShares > 0n ? `${formNumber(p.reserveA, p.tokenA.decimals, 2)} / ${formNumber(p.reserveB, p.tokenB.decimals, 2)}` : "no liquidity yet"}</span>
            <span class="hidden font-mono text-[12px] tabular-nums sm:block ${p.myShares > 0n ? "text-mint-300" : "text-zinc-600"}">${p.myShares > 0n ? shareText(p.myShares, p.totalShares) : "—"}</span>
            <span class="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-300">Open${icon("arrowRight", "size-3.5")}</span>
        </button>`).join("") + (list.length > form.shown ? /*html*/`
        <div class="border-t border-white/[0.05] p-3 text-center"><button type="button" onclick="poolMore()" class="rounded-lg px-3 py-1.5 text-[13px] font-medium text-brand-300 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Show more (${list.length - form.shown} left)</button></div>` : "");
}

/** Coins a new pair can use: the native coin, listed tokens, every token already in a pair */
function pairCoins(data = last) {
    const seen = new Map([ [ ZERO, data.native ] ]);
    for (const t of listedTokens(HUB)) seen.set(t.address, data.tokens.find((x) => x.address === t.address) ?? { ...t, balance: 0n, decimals: 18 });
    for (const t of data.tokens) if (t.address !== data.wrapped && !seen.has(t.address)) seen.set(t.address, t);
    return [ ...seen.values() ];
}
const coinName = (a, data = last) => {
    if (!a) return "Pick a coin";
    const c = pairCoins(data).find((x) => x.address === a.toLowerCase());
    return c ? c.symbol : `${a.slice(0, 6)}…${a.slice(-4)}`;
};

function newPairCard(data) {
    const canCreate = data.isOwner || data.openPairs;
    if (!canCreate) return "";
    const wrappedOf = (a) => (a === ZERO ? data.wrapped : a);
    const same = form.newA && form.newB && wrappedOf(form.newA) === wrappedOf(form.newB);
    const exists = isAddress(form.newA) && isAddress(form.newB) && !same && Boolean(pairFor(data, form.newA, form.newB));
    const ready = isAddress(form.newA) && isAddress(form.newB) && !same && !exists;
    return /*html*/`
        <section class="surface mt-5 rounded-3xl p-5 sm:p-6" data-rise="3" aria-label="New pair">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-[15px] font-semibold text-white">New pair</p>
                <p class="text-[12px] text-zinc-500">${data.isOwner ? "You own the exchange" : "Anyone may add pairs"} · default fee ${feeText(data.defaultFeeBps)}</p>
            </div>
            <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                ${[ "A", "B" ].map((k) => /*html*/`
                    <button type="button" onclick="poolNewPick('${k}')" data-new-${k.toLowerCase()} class="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-left text-[14px] text-white hover:border-brand-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <span>${escapeHtml(coinName(form[`new${k}`]))}</span><span class="text-zinc-500">${icon("chevronDown")}</span>
                    </button>`).join("")}
                ${data.isOwner ? /*html*/`<label class="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-[13px] text-zinc-400">Fee
                    <input data-new-fee oninput="poolNewFee(this.value)" value="${escapeHtml(form.newFee)}" placeholder="${Number(data.defaultFeeBps) / 100}" inputmode="decimal" class="w-14 bg-transparent text-right font-mono text-white outline-none" aria-label="Fee in percent" />%</label>` : "<span></span>"}
                <button type="button" onclick="doCreatePair()" ${ready ? "" : "disabled"} class="btn-brand rounded-xl px-4 py-2.5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">Create pair</button>
            </div>
            <p class="mt-3 text-[12px] leading-relaxed text-zinc-500" data-new-note>${same ? `<span class="text-amber-200">Pick two different coins (${escapeHtml(data.native.symbol)} and its wrapped token are the same pair).</span> ` : exists ? `<span class="text-amber-200">This pair exists already: open it in the list to add liquidity.</span> ` : ""}${escapeHtml(data.native.symbol)} pairs hold ${escapeHtml(data.tokens.find((t) => t.address === data.wrapped)?.symbol ?? "the wrapped token")} inside; people still pay and receive ${escapeHtml(data.native.symbol)}. The first deposit sets the price.</p>
        </section>`;
}

function listView(data) {
    const mineCount = data.pairs.filter((p) => p.myShares > 0n).length;
    return /*html*/`
        <div class="mb-6 flex flex-wrap items-end justify-between gap-4" data-rise>
            <div>
                <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300 sm:text-[11px]">Pools</p>
                <h1 class="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">Provide liquidity, earn fees</h1>
                <p class="mt-2 max-w-2xl text-[14px] leading-relaxed text-zinc-400">${data.pairs.length} pair${data.pairs.length === 1 ? "" : "s"}. Every swap pays the pair's fee to the people who provide its liquidity.</p>
            </div>
        </div>
        <section class="surface overflow-hidden rounded-3xl" data-rise="2" aria-label="Pairs">
            <div class="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-3 sm:p-4">
                ${tabs([ { id: "all", label: `All pairs` }, { id: "mine", label: `My positions${mineCount ? ` (${mineCount})` : ""}` } ], form.filter, "poolFilter")}
                <input data-pool-search oninput="poolSearch(this.value)" value="${escapeHtml(form.query)}" type="search" placeholder="Search symbol, name or address" autocomplete="off" spellcheck="false"
                    class="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60 sm:max-w-xs" aria-label="Search pairs" />
            </div>
            <div class="hidden grid-cols-[auto_1.2fr_1.4fr_0.6fr_auto] gap-3 px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 sm:grid">
                <span class="w-12"></span><span>Pair</span><span>In the pair</span><span>Your share</span><span class="w-12"></span>
            </div>
            <div data-pair-list>${listRows(data)}</div>
        </section>
        ${newPairCard(data)}`;
}

const notOpen = (title, text) => /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">${tradeTabs("pool")}
        <div class="surface mx-auto max-w-[480px] rounded-3xl p-6 text-center" data-rise>
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300 sm:text-[11px]">Pools</p>
            <h1 class="mt-2 text-xl font-semibold text-white">${title}</h1>
            <p class="mt-2 text-[14px] leading-relaxed text-zinc-400">${text}</p>
        </div>
    </main>`;

const poolPage = (data) => {
    last = data;
    if (!data.isReady) return notOpen("Pools are not set up yet", "The exchange address goes in settings/config.js (programs.dex).");
    const p = opened(data);
    if (form.open && !p) form.open = "";
    return /*html*/`<main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">${tradeTabs("pool")}${p ? pairView(p) : listView(data)}</main>`;
};

/* ------------------------------------ form actions (wired in ui/main.js) */

/** Typing one amount fills the other at the pair's price (when it has one) */
function poolInput(key, value) {
    const p = opened();
    if (!p) return;
    const text = String(value ?? "").replace(/,/g, ".");
    const hasPrice = p.reserveA > 0n && p.reserveB > 0n;
    if (key === "a") form.textA = text; else form.textB = text;
    if (hasPrice) {
        const typed = parse(text, key === "a" ? p.a.decimals : p.b.decimals);
        const exact = typed.error || !text.trim() ? "" : fromUnits(key === "a" ? pairedAmount(typed.amount, p.reserveA, p.reserveB) : pairedAmount(typed.amount, p.reserveB, p.reserveA), key === "a" ? p.b.decimals : p.a.decimals);
        // Readable: at most 6 decimals, cut down (the pair then takes a hair less of the typed coin; the summary shows both)
        const other = shortAmount(exact);
        if (key === "a") form.textB = other; else form.textA = other;
        const otherInput = document.querySelector(`[data-add-${key === "a" ? "b" : "a"}]`);
        if (otherInput) otherInput.value = key === "a" ? form.textB : form.textA;
    }
    paintAdd();
}

const poolPercent = (percent) => { form.percent = Number(percent); };
/** Opens a pair ('' = back to the list) */
const poolOpen = (id) => { form.open = String(id ?? ""); form.textA = ""; form.textB = ""; window.scrollTo?.({ top: 0 }); };
const poolNative = (id) => { form.useNative = id === "native"; form.textA = ""; form.textB = ""; };
const poolFilter = (id) => { form.filter = id; form.shown = PAGE; };
const poolMore = () => { form.shown += PAGE; };
/** Search filters the list in place, so the box keeps focus */
const poolSearch = (value) => {
    form.query = String(value ?? "");
    form.shown = PAGE;
    const list = document.querySelector("[data-pair-list]");
    if (list && last) list.innerHTML = listRows();
};
const poolReset = () => { form.textA = ""; form.textB = ""; };
const poolNewFee = (value) => { form.newFee = String(value ?? "").replace(/,/g, "."); };

/** Pick a coin for a new pair: the list, or any token address pasted in the search box */
function poolNewPick(key, done = () => {}) {
    if (!last) return;
    const coins = pairCoins();
    openPicker({
        title: `New pair: coin ${key}`,
        placeholder: "Search, or paste a token address",
        items: coins.map((t) => ({ id: t.address, label: t.symbol, sub: `${t.name}${t.isNative ? " · native coin" : ` · ${t.address.slice(0, 6)}…${t.address.slice(-4)}`}`, search: t.address, badge: tokenBadge(t) })),
        onPick: (address) => { form[`new${key}`] = address; done(); },
        onFree: (text) => (isAddress(text) ? (form[`new${key}`] = text.toLowerCase(), done(), true) : false),
    });
}

/** Orders for chain/dex.js from the form (throw readable errors) */
function addOrder() {
    const p = opened();
    if (!p) throw new Error("Open a pair first.");
    const { plan, error } = depositState(p);
    if (error) throw new Error(error);
    return { pairId: p.id, amountA: plan.amountA, amountB: plan.amountB, useNative: p.hasNative && form.useNative, minShares: withSlippage(plan.shares, tradeSettings().slippageBps), deadlineMinutes: tradeSettings().deadlineMinutes, label: `${p.a.symbol} / ${p.b.symbol}` };
}
function removeOrder() {
    const p = opened();
    if (!p) throw new Error("Open a pair first.");
    const shares = sharesToRemove(p);
    const out = withdrawPreview({ shares, reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares });
    return { pairId: p.id, shares, useNative: p.hasNative && form.useNative, minA: withSlippage(out.amountA, tradeSettings().slippageBps), minB: withSlippage(out.amountB, tradeSettings().slippageBps), deadlineMinutes: tradeSettings().deadlineMinutes, label: `${p.a.symbol} and ${p.b.symbol}` };
}
function newPairOrder() {
    if (!last) throw new Error("The exchange is still loading.");
    if (!isAddress(form.newA) || !isAddress(form.newB)) throw new Error("Pick both coins.");
    if (form.newA === form.newB) throw new Error("Pick two different coins.");
    if (pairFor(last, form.newA, form.newB)) throw new Error("This pair exists already.");
    let feeBps;
    if (last.isOwner && form.newFee.trim()) {
        const pct = Number(form.newFee);
        if (!(pct >= 0 && pct <= Number(last.maxFeeBps) / 100)) throw new Error(`The fee must be between 0 and ${Number(last.maxFeeBps) / 100}%.`);
        feeBps = BigInt(Math.round(pct * 100));
    }
    return { tokenA: form.newA, tokenB: form.newB, feeBps, label: `${coinName(form.newA)} / ${coinName(form.newB)}` };
}
const newPairReset = () => { form.newA = ""; form.newB = ""; form.newFee = ""; };

const poolLoading = pageLoading("the pools");
const poolError = pageError;

export { poolPage, poolLoading, poolError, poolInput, poolPercent, poolOpen, poolNative, poolFilter, poolMore, poolSearch, poolReset,
    poolNewPick, poolNewFee, addOrder, removeOrder, newPairOrder, newPairReset };
