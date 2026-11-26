/*
 * YOUR CODE (off-chain). Swap page: pick any two coins, type an amount, see the result before you sign.
 * - Type in "You pay" (exact in: get at least …) or in "You get" (exact out: pay at most …).
 * - Coins: the native coin (BWSC) and every token in a pair; searchable, your balances first.
 * - The best route is found from the page's read (one pair or several in a row, up to settings swap.maxHops);
 *   BWSC ↔ wBWSC is a plain wrap / unwrap, 1 : 1. Two coins with no route say so; there are no made-up prices.
 * - Settings (gear): max slippage (presets or your own) and the transaction deadline, kept in this browser.
 * - Price impact: shown on every quote; from 5% a warning, from 15% the button asks you to confirm.
 * Typing never reads the chain. The form lives here, outside the page HTML, so a repaint does not lose it.
 */

import { icon } from "../icons";
import { bestRoute, bestRouteOut, coinIn, withSlippage, withSlippageUp, freeGasFor } from "../../chain";
import { formNumber, escapeHtml, toUnits, fromUnits, shortAmount } from "../../../engine/ui/helpers";
import { SLIPPAGE_CHOICES, MIN_DEADLINE_MINUTES, MAX_DEADLINE_MINUTES } from "../options";
import { tradeSettings, setSlippage, setDeadline, slippageWarning } from "../swapSettings";
import { openPicker } from "../componants/picker";
import { tradeTabs, tokenBadge, feeText, pageLoading, pageError } from "./shared";

const ZERO = "0x0000000000000000000000000000000000000000";
const WARN_IMPACT_BPS = 500;      // 5%: a warning under the quote
const CONFIRM_IMPACT_BPS = 1500;  // 15%: the button asks "Swap anyway"
const form = { from: null, to: null, text: "", mode: "in", settingsOpen: false, customSlippage: "" };
let last = null;   // the page's data, for previews while typing

/** Both coins of the form; first visit: BWSC → the first other coin of the first pair with it (or the first pair) */
function sides(data = last) {
    const ok = (a) => a !== null && coinIn(data, a);
    if (!ok(form.from) || !ok(form.to) || form.from === form.to) {
        const p = data.pairs.find((x) => x.hasNative) ?? data.pairs[0];
        if (p?.hasNative) [ form.from, form.to ] = [ ZERO, p.tokenA.address === data.wrapped ? p.tokenB.address : p.tokenA.address ];
        else if (p) [ form.from, form.to ] = [ p.tokenA.address, p.tokenB.address ];
    }
    return { from: coinIn(data, form.from), to: coinIn(data, form.to) };
}

/** What the form means right now → { amountIn, amountOut, route, limit, error } (limit = min out, or max in) */
function evaluate(data = last) {
    const { from, to } = sides(data);
    const { slippageBps } = tradeSettings();
    let typed = 0n;
    let error = "";
    if (form.text.trim()) {
        try { typed = toUnits(form.text, form.mode === "out" ? to.decimals : from.decimals); } catch (err) { error = err.message; }
    }
    if (form.mode === "out") {
        const route = bestRouteOut(data, from.address, to.address, typed);
        const limit = route.kind === "swap" ? withSlippageUp(route.in, slippageBps) : route.in;
        return { amountIn: route.in, amountOut: typed, route, limit, error: error || (route.tooMuch ? "Not enough liquidity for that amount" : "") };
    }
    const route = bestRoute(data, from.address, to.address, typed);
    const limit = route.kind === "swap" ? withSlippage(route.out, slippageBps) : route.out;
    return { amountIn: typed, amountOut: route.out, route, limit, error };
}

/** Label and state of the main button */
function action(data = last) {
    const { from, to } = sides(data);
    const { amountIn, amountOut, route, error, limit } = evaluate(data);
    if (!data.isConnected) return { label: "Connect wallet", onclick: "openWallet()", isDisabled: false };
    if (route.kind === "none") return { label: `No route from ${from.symbol} to ${to.symbol}`, isDisabled: true };
    if (route.kind === "swap" && data.isPaused) return { label: "Swaps are paused", isDisabled: true };
    if (error) return { label: error, isDisabled: true };
    if ((form.mode === "out" ? amountOut : amountIn) === 0n) return { label: "Enter an amount", isDisabled: true };
    if (amountIn > from.balance) return { label: `Not enough ${from.symbol}`, isDisabled: true };
    if (route.kind === "wrap") return { label: `Wrap ${from.symbol}`, onclick: "doSwap()", isDisabled: false };
    if (route.kind === "unwrap") return { label: `Unwrap to ${to.symbol}`, onclick: "doSwap()", isDisabled: false };
    if (!route.out || !route.in) return { label: "Amount too small", isDisabled: true };
    const approveFor = form.mode === "out" ? limit : amountIn;
    const base = !from.isNative && from.allowance < approveFor ? "Approve & swap" : "Swap";
    if (route.impactBps >= CONFIRM_IMPACT_BPS) {
        if (!form.confirmedImpact) return { label: `Price impact ${(route.impactBps / 100).toFixed(1)}%: tap to confirm`, onclick: "swapConfirmImpact()", isDisabled: false, danger: true };
        return { label: `${base} anyway`, onclick: "doSwap()", isDisabled: false, danger: true };
    }
    return { label: base, onclick: "doSwap()", isDisabled: false };
}

const impactTone = (bps) => (bps >= WARN_IMPACT_BPS ? "text-rose-300" : bps >= 100 ? "text-amber-300" : "text-zinc-300");
const row = (label, value, tone = "text-zinc-300") => /*html*/`<div class="flex justify-between gap-3"><dt class="text-zinc-500">${label}</dt><dd class="text-right font-mono tabular-nums ${tone}">${value}</dd></div>`;
const pct = (bps) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : Number(bps) % 10 === 0 ? 1 : 2)}%`;

/** "1 A = x B" from the route itself (works over several pairs) */
function rateText(data, from, to) {
    const one = 10n ** BigInt(from.decimals);
    const r = bestRoute(data, from.address, to.address, one);
    return r.kind === "none" || !r.out ? "No price yet" : `1 ${escapeHtml(from.symbol)} = ${formNumber(r.out, to.decimals, 6)} ${escapeHtml(to.symbol)}`;
}

const routeText = (route) => route.symbols.map(escapeHtml).join(`<span class="mx-1 inline-flex align-middle text-zinc-600">${icon("chevronRight", "size-3.5")}</span>`);

/** The parts that change while typing (patched in place, so the field you type in keeps focus) */
function liveParts(data = last) {
    const { from, to } = sides(data);
    const { amountIn, amountOut, route, limit } = evaluate(data);
    const button = action(data);
    const { slippageBps, deadlineMinutes } = tradeSettings();
    const fill = (amount, decimals) => (amount ? shortAmount(fromUnits(amount, decimals)) : "");
    // The field you did not type in shows the other side
    const other = form.mode === "out" ? { in: fill(amountIn, from.decimals) } : { out: fill(amountOut, to.decimals) };
    if (route.kind === "none") {
        return { ...other, button, details: /*html*/`<p class="text-zinc-500">There is no pair (or chain of pairs) between ${escapeHtml(from.symbol)} and ${escapeHtml(to.symbol)} yet.</p>` };
    }
    if (route.kind !== "swap") {
        return { ...other, button, details: [
            row("Rate", `1 ${escapeHtml(from.symbol)} = 1 ${escapeHtml(to.symbol)}`, "text-zinc-200"),
            row("Fee", "none (only gas)"),
        ].join("") };
    }
    const fees = route.pairs.map((p) => feeText(p.feeBps)).join(" + ");
    const ready = form.mode === "out" ? amountOut > 0n && amountIn > 0n : amountIn > 0n && amountOut > 0n;
    // Free gas (chain/gasSponsor.js): a wallet nearly out of BWSC buying BWSC with enough USDT
    const free = freeGasFor(data, from.address, to.address, amountIn);
    const gas = free.free
        ? row("Network fee", `<span data-swap-free-gas>Free: paid by Bluewolfchain</span>`, "text-emerald-300")
        : free.reason === "min" ? row("Network fee", `<span data-swap-free-gas-min>Free from ${formNumber(free.minIn, from.decimals, 2)} ${escapeHtml(free.symbol)}</span>`, "text-zinc-400") : "";
    const warn = route.impactBps >= WARN_IMPACT_BPS
        ? /*html*/`<p class="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100" role="alert" data-impact-warning>Large price impact (${(route.impactBps / 100).toFixed(2)}%): this trade moves the price a lot. Consider a smaller amount.</p>`
        : "";
    return {
        ...other,
        details: ready ? [
            row("Rate", rateText(data, from, to), "text-zinc-200"),
            row("Route", routeText(route), "text-zinc-300"),
            row("Price impact", `${(route.impactBps / 100).toFixed(2)}%`, impactTone(route.impactBps)),
            row(route.hops > 1 ? "Pair fees" : "Pair fee", fees),
            form.mode === "out"
                ? row("You pay at most", `${formNumber(limit, from.decimals, 6)} ${escapeHtml(from.symbol)}`, "text-white")
                : row("You get at least", `${formNumber(limit, to.decimals, 6)} ${escapeHtml(to.symbol)}`, "text-white"),
            row("Slippage · deadline", `${pct(slippageBps)} · ${deadlineMinutes} min`),
            gas,
            warn,
        ].join("") : /*html*/`<p class="text-zinc-500">${rateText(data, from, to)} · ${route.hops > 1 ? `via ${routeText(route)}` : `fee ${fees}`}</p>`,
        button,
    };
}

const paintButton = (button, state) => {
    button.textContent = state.label;
    button.disabled = state.isDisabled;
    button.setAttribute("onclick", state.onclick ?? "");
    button.classList.toggle("btn-danger", Boolean(state.danger));
};

const paintLive = () => {
    if (!last || typeof document === "undefined") return;
    const parts = liveParts();
    if (parts.out !== undefined) { const el = document.querySelector("[data-swap-out]"); if (el) el.value = parts.out; }
    if (parts.in !== undefined) { const el = document.querySelector("[data-swap-in]"); if (el) el.value = parts.in; }
    document.querySelectorAll("[data-swap-label]").forEach((el) => { el.textContent = labelFor(el.dataset.swapLabel); });
    const details = document.querySelector("[data-swap-details]");
    if (details) details.innerHTML = parts.details;
    const button = document.querySelector("[data-swap-button]");
    if (button) paintButton(button, parts.button);
};

const labelFor = (side) => (side === "from" ? (form.mode === "out" ? "You pay (estimate)" : "You pay") : (form.mode === "out" ? "You get" : "You get (estimate)"));

const tokenField = ({ token, side, value, isInput }) => /*html*/`
    <div class="rounded-2xl border border-white/[0.07] bg-ink-950/60 p-4 focus-within:border-brand-400/50">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-zinc-500">
            <span class="whitespace-nowrap" data-swap-label="${side}">${labelFor(side)}</span>
            <span class="whitespace-nowrap">Balance <span class="font-mono tabular-nums text-zinc-300">${formNumber(token.balance, token.decimals, 4)}</span>
                ${isInput && token.balance > 0n ? `<button type="button" onclick="swapMax()" class="-my-2 ml-1 inline-flex min-h-9 items-center rounded-md px-2.5 font-semibold text-brand-300 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Max</button>` : ""}
            </span>
        </div>
        <div class="mt-2 flex items-center gap-3">
            <input ${isInput ? `data-swap-in oninput="swapInput(this.value)" aria-label="Amount of ${escapeHtml(token.symbol)} to pay"`
                // Exact out needs BwscDex v2 (swapExactOut); on v1 the field only shows the estimate
                : last?.version >= 2n ? `data-swap-out oninput="swapOutInput(this.value)" aria-label="Amount of ${escapeHtml(token.symbol)} to get"` : `data-swap-out readonly tabindex="-1" aria-label="Estimated ${escapeHtml(token.symbol)} you get"`}
                type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0" value="${escapeHtml(value)}"
                class="amount-input min-w-0 flex-1 bg-transparent font-mono text-[22px] tabular-nums min-[360px]:text-[26px] text-white outline-none placeholder:text-zinc-600 sm:text-[30px]" />
            <button type="button" onclick="swapPick('${side}')" data-pick-${side} aria-label="Choose the coin you ${side === "from" ? "pay" : "get"}"
                class="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-2.5 transition hover:border-brand-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                ${tokenBadge(token)}
                <span class="text-[14px] font-semibold text-white">${escapeHtml(token.symbol)}</span>
                <svg viewBox="0 0 24 24" class="size-4 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
        </div>
    </div>`;

/** Gear panel: max slippage (presets or your own) and the deadline */
function settingsPanel() {
    const { slippageBps, deadlineMinutes } = tradeSettings();
    const isPreset = SLIPPAGE_CHOICES.includes(slippageBps);
    const warning = slippageWarning(slippageBps);
    return /*html*/`
    <div class="mb-3 rounded-2xl border border-white/[0.08] bg-ink-950/60 p-4" data-swap-settings>
        <p class="text-[13px] font-semibold text-white">Max slippage</p>
        <p class="mt-1 text-[12px] leading-relaxed text-zinc-500">The most the price may move against you before the exchange refuses the swap.</p>
        <div class="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Max slippage">
            ${SLIPPAGE_CHOICES.map((bps) => /*html*/`
            <button type="button" onclick="swapSlippage(${bps})" aria-pressed="${bps === slippageBps}"
                class="min-h-9 rounded-lg border px-3 font-mono text-[13px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                ${bps === slippageBps ? "border-brand-400/60 bg-brand-400/10 text-brand-200" : "border-white/10 text-zinc-400 hover:text-white"}">${pct(bps)}</button>`).join("")}
            <label class="flex min-h-9 items-center gap-1 rounded-lg border px-3 ${isPreset ? "border-white/10" : "border-brand-400/60 bg-brand-400/10"}">
                <input data-slippage-custom type="text" inputmode="decimal" autocomplete="off" placeholder="Custom" aria-label="Your own slippage in percent"
                    value="${escapeHtml(isPreset ? form.customSlippage : String(slippageBps / 100))}" onchange="swapSlippageCustom(this.value)"
                    class="w-16 bg-transparent font-mono text-[13px] text-white outline-none placeholder:text-zinc-600" />
                <span class="text-[13px] text-zinc-500">%</span>
            </label>
        </div>
        ${warning ? `<p class="mt-2 text-[12px] text-amber-200" data-slippage-warning>${warning}</p>` : ""}
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <div>
                <p class="text-[13px] font-semibold text-white">Transaction deadline</p>
                <p class="mt-0.5 text-[12px] text-zinc-500">Refused if it waits longer than this.</p>
            </div>
            <label class="flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3">
                <input data-deadline type="number" inputmode="numeric" min="${MIN_DEADLINE_MINUTES}" max="${MAX_DEADLINE_MINUTES}" step="1" value="${deadlineMinutes}" aria-label="Deadline in minutes"
                    onchange="swapDeadline(this.value)" class="w-16 bg-transparent font-mono text-[13px] text-white outline-none" />
                <span class="text-[13px] text-zinc-500">minutes</span>
            </label>
        </div>
    </div>`;
}

/** Nothing to trade yet: the exchange is not set, or it has no pairs */
const notOpen = (title, text) => /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">${tradeTabs("swap", true)}
        <div class="surface mx-auto max-w-[480px] rounded-3xl p-6 text-center" data-rise>
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300 sm:text-[11px]">Swap</p>
            <h1 class="mt-2 text-xl font-semibold text-white">${title}</h1>
            <p class="mt-2 text-[14px] leading-relaxed text-zinc-400">${text}</p>
        </div>
    </main>`;

const swapPage = (data) => {
    last = data;
    if (!data.isReady) return notOpen("Swapping is not set up yet", "The exchange address goes in settings/config.js (programs.dex).");
    if (!data.pairs.length) return notOpen("No pairs yet", `Swapping opens when the first pair is added.${data.isOwner ? ` <a href="#/pool" class="text-brand-300 hover:text-brand-200">Add one on the Pool page</a>` : ""}`);
    const { from, to } = sides(data);
    const parts = liveParts(data);
    const { slippageBps } = tradeSettings();

    return /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">${tradeTabs("swap", true)}
        <div class="mx-auto w-full max-w-[480px]">
            <div class="mb-5 flex items-end justify-between gap-3" data-rise>
                <div>
                    <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300 sm:text-[11px]">Swap</p>
                    <h1 class="mt-1 text-2xl font-semibold tracking-tight text-white">Trade coins</h1>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" onclick="swapSettingsToggle()" aria-expanded="${form.settingsOpen}" aria-label="Slippage and deadline settings" data-swap-gear
                        class="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-300 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <span class="font-mono tabular-nums text-zinc-400">${pct(slippageBps)}</span>
                        <svg viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                    </button>
                    <a href="#/pool" class="inline-flex min-h-10 items-center rounded-lg px-2 text-[13px] font-medium text-brand-300 hover:text-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 gap-1">Pools${icon("arrowRight", "size-3.5")}</a>
                </div>
            </div>
            ${data.isPaused ? /*html*/`<div class="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">Swaps are paused by the owner. Wrapping and taking liquidity out still work.</div>` : ""}

            <div class="surface rounded-3xl p-3 shadow-[0_40px_120px_-50px_rgb(59_130_246/0.3)] sm:p-4" data-rise="2">
                ${form.settingsOpen ? settingsPanel() : ""}
                ${tokenField({ token: from, side: "from", value: form.mode === "in" ? form.text : (parts.in ?? ""), isInput: true })}

                <div class="relative z-10 -my-3 flex justify-center">
                    <button type="button" onclick="swapFlip()" aria-label="Switch direction"
                        class="grid size-10 place-items-center rounded-xl border-4 border-ink-900 bg-ink-800 text-zinc-300 transition hover:rotate-180 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none">
                        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>
                    </button>
                </div>

                ${tokenField({ token: to, side: "to", value: form.mode === "out" ? form.text : (parts.out ?? ""), isInput: false })}

                <dl class="space-y-2 px-1.5 pb-1 pt-4 text-[13px]" data-swap-details>${parts.details}</dl>

                <button type="button" data-swap-button onclick="${parts.button.onclick ?? ""}" ${parts.button.isDisabled ? "disabled" : ""}
                    class="btn-brand ${parts.button.danger ? "btn-danger" : ""} mt-4 w-full rounded-2xl px-5 py-3.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900">${escapeHtml(parts.button.label)}</button>
            </div>

            <p class="mt-4 px-1 text-[12px] leading-relaxed text-zinc-500" data-rise="3">
                Type in either field. The exchange refuses the swap if you would get less than "you get at least" (or pay more than "you pay at most"),
                or if it is still waiting after your deadline. Approvals are for the exact amount of this swap.
                ${escapeHtml(data.native.symbol)} goes through the ${escapeHtml(coinIn(data, data.wrapped)?.symbol ?? "wrapped")} pairs; the exchange wraps and unwraps it for you.
            </p>
        </div>
    </main>`;
};

/* ------------------------------------ form actions (wired in ui/main.js) */

const clean = (value) => String(value ?? "").replace(/,/g, ".");
const swapInput = (value) => { form.text = clean(value); form.mode = "in"; form.confirmedImpact = false; paintLive(); };
const swapOutInput = (value) => { form.text = clean(value); form.mode = "out"; form.confirmedImpact = false; paintLive(); };
const swapMax = () => {
    if (!last) return;
    const { from } = sides();
    // The native coin keeps a little for gas
    const max = from.isNative ? (from.balance > 10n ** 16n ? from.balance - 10n ** 16n : 0n) : from.balance;
    form.text = fromUnits(max, from.decimals);
    form.mode = "in";
    form.confirmedImpact = false;
    const input = document.querySelector("[data-swap-in]");
    if (input) input.value = form.text;
    paintLive();
};
const swapConfirmImpact = () => { form.confirmedImpact = true; paintLive(); };
const swapSettingsToggle = () => { form.settingsOpen = !form.settingsOpen; };
const swapSlippage = (bps) => { setSlippage(Number(bps)); form.customSlippage = ""; };
/** Your own slippage in percent ("0.3" = 0.3%) */
const swapSlippageCustom = (value) => {
    const n = Number(clean(value));
    if (!Number.isFinite(n) || n <= 0) return;
    form.customSlippage = String(value);
    setSlippage(Math.round(n * 100));
};
const swapDeadline = (value) => { setDeadline(Number(value)); };
const swapFlip = () => {
    [ form.from, form.to ] = [ form.to, form.from ];
    // The amount you typed stays on the side you typed it, which is now the other coin: start again
    form.text = "";
    form.mode = "in";
};
const swapReset = () => { form.text = ""; form.mode = "in"; form.confirmedImpact = false; };

/** Opens the coin list for one side; `done` repaints the page after a pick */
function swapPick(side, done = () => {}) {
    if (!last) return;
    const other = side === "from" ? form.to : form.from;
    // Coins you hold first (by balance shown), then listed coins in settings order, then the rest
    const coins = [ ...last.coins ].sort((a, b) => Number(b.balance > 0n) - Number(a.balance > 0n) || a.order - b.order || a.symbol.localeCompare(b.symbol));
    openPicker({
        title: side === "from" ? "You pay" : "You get",
        placeholder: "Search name, symbol or address",
        items: coins.map((t) => {
            const reachable = t.address === other || bestRoute(last, side === "from" ? t.address : other, side === "from" ? other : t.address, 0n).kind !== "none";
            return {
                id: t.address,
                label: t.symbol,
                sub: `${t.name}${t.isListed ? "" : " · not in the list"} · ${t.isNative ? "native coin" : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}`,
                search: t.address,
                badge: tokenBadge(t),
                note: reachable ? "" : "no route",
                right: formNumber(t.balance, t.decimals, 4),
            };
        }),
        onPick: (address) => {
            if (address === other) [ form.from, form.to ] = [ form.to, form.from ];   // picking the other side's coin swaps them
            else form[side] = address;
            form.text = "";
            form.mode = "in";
            done();
        },
    });
}

/** The order for chain/dex.js swapCoins from the form (throws a readable error when the amount is wrong) */
function swapOrder() {
    if (!last) throw new Error("The exchange is still loading.");
    const { from, to } = sides();
    const { amountIn, amountOut, route, error } = evaluate();
    if (route.kind === "none") throw new Error(`There is no route from ${from.symbol} to ${to.symbol}.`);
    if (error) throw new Error(error);
    const { slippageBps, deadlineMinutes } = tradeSettings();
    // Wrap / unwrap is 1 : 1, so an amount typed in "You get" is the amount to send
    const mode = route.kind === "swap" ? form.mode : "in";
    return { from: from.address, to: to.address, mode, amountIn: mode === "in" ? amountIn : 0n, amountOut: mode === "out" ? amountOut : 0n,
        slippageBps, deadlineMinutes, symbol: from.symbol, kind: route.kind, toSymbol: to.symbol };
}

const swapLoading = pageLoading("the swap");
const swapError = pageError;

export { swapPage, swapLoading, swapError, swapInput, swapOutInput, swapMax, swapConfirmImpact, swapSettingsToggle, swapSlippage, swapSlippageCustom, swapDeadline, swapFlip, swapPick, swapReset, swapOrder };
