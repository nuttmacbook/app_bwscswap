/*
 * YOUR CODE (off-chain, restyle freely). Multi transfer (#/send): one coin to many wallets.
 *
 * The list is typed, pasted or uploaded (CSV / text): one wallet per line, "address, amount". Every keystroke checks
 * the whole list in place (no repaint, so the box keeps focus): lines with a problem by number, wallets listed twice
 * (with a button to merge them), the total, the fee, and the transactions it takes (200 wallets each).
 * Sending goes batch by batch; if one stops, the ones sent stay marked and "Send the rest" carries on.
 */

import { icon } from "../icons";
import { getSendData, parseList, mergeDuplicates, batchesOf, feeEstimate, feeCeiling, listedTokens, nativeCoin, HUB } from "../../chain";
import { formNumber, escapeHtml, toUnits, fromUnits, shortAddress, txUrl } from "../../../engine/ui/helpers";
import { ZERO, isAddress } from "../../../engine/settings";
import { openPicker } from "../componants/picker";
import { tokenBadge, pageHead, pageLoading, pageError } from "./shared";

const MAX_PROBLEMS = 20;
const EXAMPLE = [
    "# One wallet per line: address, amount",
    "0x1111111111111111111111111111111111111111, 1.5",
    "0x2222222222222222222222222222222222222222, 20",
    "0x3333333333333333333333333333333333333333, 0.25",
].join("\n");

const state = {
    token: ZERO,
    text: "",
    same: false,         // everyone gets the same amount: lines need only the address
    sameText: "",
    done: new Map(),     // batch index → hash, for the list as it was sent (key)
    doneKey: "",
};

let last = null;

/* ------------------------------------ the list */

const sameAmount = (coin) => {
    if (!state.same) return null;
    try { const a = toUnits(state.sameText.trim() || "0", coin.decimals); return a > 0n ? a : 0n; } catch { return -1n; }
};

/** Everything the page shows about the list right now */
function review(data) {
    const coin = data.coin;
    const same = coin ? sameAmount(coin) : null;
    const list = coin ? parseList(state.text, coin.decimals, { sameAmount: same !== null && same > 0n ? same : state.same ? 1n : null }) : { rows: [], problems: [], total: 0n, duplicates: [] };
    if (state.same && !(same > 0n)) list.total = 0n;
    const batches = batchesOf(list.rows, data.maxTransfers ?? 200);
    const key = `${state.token}|${list.rows.map((r) => `${r.to}:${r.amount}`).join(",")}`;
    if (key !== state.doneKey) { state.done = new Map(); state.doneKey = key; }
    const left = batches.filter((b, i) => !state.done.has(i));
    const leftTotal = left.reduce((s, b) => s + b.reduce((x, r) => x + r.amount, 0n), 0n);
    const fee = coin ? feeEstimate(left, coin.isNative, data.baseFee) : 0n;
    const ceiling = coin ? feeCeiling(left, coin.isNative, data.baseFee) : 0n;
    return { coin, list, same, batches, left, leftTotal, fee, ceiling };
}

/** The button under the summary: what it does now, or why it cannot */
function action(data, r) {
    const { coin, list, same, batches, left, leftTotal, ceiling } = r;
    if (!data.isConnected) return { label: "Connect a wallet", onclick: "openWallet()" };
    if (!coin) return { label: "Pick a coin", disabled: true };
    if (state.same && same === -1n) return { label: "Check the amount for everyone", disabled: true };
    if (state.same && !(same > 0n)) return { label: "Enter the amount for everyone", disabled: true };
    if (!list.rows.length && !list.problems.length) return { label: "Add wallets to the list", disabled: true };
    if (list.problems.length) return { label: `Fix ${list.problems.length} line${list.problems.length === 1 ? "" : "s"} first`, disabled: true };
    if (!left.length) return { label: "All sent", disabled: true };
    if (leftTotal > coin.balance) return { label: `Not enough ${coin.symbol}`, disabled: true };
    if (coin.isNative && leftTotal + ceiling > coin.balance) return { label: `Keep some ${coin.symbol} for the fee`, disabled: true };
    if (!coin.isNative && ceiling > (data.gasBalance ?? 0n)) return { label: `Not enough ${nativeCoin(HUB).symbol} for the fee`, disabled: true };
    const wallets = left.reduce((s, b) => s + b.length, 0);
    const rest = state.done.size ? "the rest: " : "";
    const verb = !coin.isNative && coin.allowance < leftTotal ? "Approve and send" : "Send";
    return { label: `${verb} ${rest}${wallets.toLocaleString("en-US")} wallet${wallets === 1 ? "" : "s"}${left.length > 1 ? ` in ${left.length} transactions` : ""}`, onclick: "sendSubmit()", primary: true, batches: batches.length };
}

const amount = (value, coin, places = 6) => `${formNumber(value, coin?.decimals ?? 18, places)}`;

/* ------------------------------------ parts */

function coinCard(data) {
    const coin = data.coin;
    return /*html*/`
    <button type="button" onclick="sendPickCoin()" data-send-coin aria-label="Coin to send: ${escapeHtml(coin?.symbol ?? "pick a coin")}. Change"
        class="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        ${coin ? tokenBadge(coin, null, "size-9") : `<span class="size-9 rounded-full bg-white/10"></span>`}
        <span class="min-w-0 flex-1">
            <span class="block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Coin to send</span>
            <span class="block truncate text-[15px] font-semibold text-white">${escapeHtml(coin?.symbol ?? "Pick a coin")}<span class="ml-2 text-[12px] font-normal text-zinc-500">${coin ? (coin.isNative ? "native coin" : shortAddress(coin.address)) : ""}</span></span>
        </span>
        <span class="text-right">
            <span class="block text-[11px] uppercase tracking-[0.12em] text-zinc-500">Balance</span>
            <span class="block font-mono text-[13px] text-zinc-200" data-send-balance>${coin && data.isConnected ? amount(coin.balance, coin, 4) : "—"}</span>
        </span>
        ${icon("chevronDown", "size-4 text-zinc-500")}
    </button>`;
}

function listCard(data) {
    const coin = data.coin;
    return /*html*/`
    <section class="surface rounded-3xl p-4 sm:p-5" aria-label="Wallets to send to" data-send-list>
        <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <p class="text-[14px] font-semibold text-white">Wallets</p>
                <p class="mt-0.5 text-[12px] text-zinc-500">${state.same ? "One address per line." : "One per line: address, amount. A comma, space, tab or = between them."}</p>
            </div>
            <label class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.05] focus-within:ring-2 focus-within:ring-brand-400">
                ${icon("upload", "size-3.5")}Upload CSV
                <input type="file" accept=".csv,.txt,text/csv,text/plain" class="sr-only" onchange="sendFile(this)" data-send-file />
            </label>
            <button type="button" onclick="sendExample()" class="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Example</button>
            <button type="button" onclick="sendClear()" class="inline-flex min-h-9 items-center rounded-lg px-2.5 text-[12px] font-medium text-zinc-500 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-send-clear>Clear</button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-ink-950/40 px-3 py-2">
            <button type="button" role="switch" aria-checked="${state.same}" onclick="sendSame()" data-send-same
                class="inline-flex min-h-9 items-center gap-2 text-[13px] text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg">
                <span class="relative h-5 w-9 shrink-0 rounded-full ${state.same ? "bg-brand-500" : "bg-white/15"}"><span class="absolute top-0.5 size-4 rounded-full bg-white transition-all ${state.same ? "right-0.5" : "left-0.5"}"></span></span>
                Same amount for everyone
            </button>
            ${state.same ? /*html*/`
            <span class="ml-auto flex items-center gap-2">
                <input inputmode="decimal" autocomplete="off" placeholder="0" value="${escapeHtml(state.sameText)}" oninput="sendSameAmount(this.value)" data-send-same-amount aria-label="Amount for every wallet"
                    class="w-32 rounded-lg border border-white/10 bg-ink-950/70 px-2.5 py-1.5 text-right font-mono text-[16px] text-white outline-none placeholder:text-zinc-700 focus:border-brand-400/60" />
                <span class="text-[13px] text-zinc-400">${escapeHtml(coin?.symbol ?? "")}</span>
            </span>` : ""}
        </div>
        <textarea data-send-text oninput="sendText(this.value)" spellcheck="false" autocomplete="off" autocapitalize="off" rows="12" aria-label="Wallets to send to, one per line"
            placeholder="${state.same ? "0x…\n0x…" : "0x…, 1.5\n0x…, 20"}"
            class="code-scroll mt-3 block min-h-64 w-full resize-y rounded-2xl border border-white/10 bg-ink-950/70 px-3.5 py-3 font-mono text-[13px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-brand-400/60">${escapeHtml(state.text)}</textarea>
        <div data-send-problems>${problemsBox(review(data))}</div>
    </section>`;
}

function problemsBox(r) {
    const { list, coin } = r;
    const parts = [];
    if (list.problems.length) parts.push(/*html*/`
        <div class="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/[0.07] p-3" role="status" data-send-problem-list>
            <p class="text-[13px] font-semibold text-amber-100">${list.problems.length} line${list.problems.length === 1 ? "" : "s"} to fix</p>
            <ul class="mt-2 space-y-1 text-[12px]">
                ${list.problems.slice(0, MAX_PROBLEMS).map((p) => `<li class="flex gap-2" data-send-problem="${p.line}"><span class="w-14 shrink-0 font-mono text-amber-200/80">Line ${p.line}</span><span class="min-w-0 text-amber-50/90">${escapeHtml(p.reason)}<span class="block truncate font-mono text-amber-100/50">${escapeHtml(p.text)}</span></span></li>`).join("")}
            </ul>
            ${list.problems.length > MAX_PROBLEMS ? `<p class="mt-2 text-[12px] text-amber-100/70">and ${list.problems.length - MAX_PROBLEMS} more</p>` : ""}
        </div>`);
    if (list.duplicates.length) parts.push(/*html*/`
        <div class="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[12px]" data-send-duplicates>
            <p class="min-w-0 flex-1 text-zinc-300">${list.duplicates.length} wallet${list.duplicates.length === 1 ? " is" : "s are"} listed more than once and will get every amount${list.duplicates.length === 1 ? `: ${escapeHtml(shortAddress(list.duplicates[0].to))} (${list.duplicates[0].count} times)` : ""}.</p>
            <button type="button" onclick="sendMerge()" data-send-merge class="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 font-medium text-white hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Merge into one line each</button>
        </div>`);
    void coin;
    return parts.join("");
}

function summaryCard(data) {
    const r = review(data);
    const { coin, list, batches, left, leftTotal, fee } = r;
    const a = action(data, r);
    const after = coin && data.isConnected ? coin.balance - leftTotal - (coin.isNative ? fee : 0n) : null;
    const stat = (label, value, attr = "") => `<div class="rounded-2xl border border-white/[0.07] bg-ink-950/40 px-3 py-2.5"><dt class="text-[11px] uppercase tracking-[0.12em] text-zinc-500">${label}</dt><dd class="mt-0.5 truncate font-mono text-[15px] text-white" ${attr}>${value}</dd></div>`;
    return /*html*/`
    <section class="surface rounded-3xl p-4 sm:p-5" aria-label="Summary" data-send-summary>
        <p class="text-[14px] font-semibold text-white">Summary</p>
        <dl class="mt-3 grid grid-cols-2 gap-2">
            ${stat("Wallets", list.rows.length.toLocaleString("en-US"), "data-send-count")}
            ${stat("Transactions", batches.length ? `${batches.length}` : "0", "data-send-batches")}
            ${stat("Total", coin ? `${amount(list.total, coin, 6)} <span class="text-[12px] text-zinc-500">${escapeHtml(coin.symbol)}</span>` : "—", "data-send-total")}
            ${stat("Network fee", coin && left.length ? `about ${formNumber(fee, 18, 4)} <span class="text-[12px] text-zinc-500">${escapeHtml(nativeCoin(HUB).symbol)}</span>` : "—", "data-send-fee")}
        </dl>
        <dl class="mt-3 space-y-1.5 text-[12px]">
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">Your balance</dt><dd class="text-right font-mono text-zinc-300">${coin && data.isConnected ? `${amount(coin.balance, coin, 4)} ${escapeHtml(coin.symbol)}` : "—"}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-zinc-500">After sending</dt><dd class="text-right font-mono ${after !== null && after < 0n ? "text-rose-300" : "text-zinc-300"}" data-send-after>${after === null || !left.length ? "—" : after < 0n ? "not enough" : `${amount(after, coin, 4)} ${escapeHtml(coin.symbol)}`}</dd></div>
            ${coin && !coin.isNative ? `<div class="flex justify-between gap-3"><dt class="text-zinc-500">Approval</dt><dd class="text-right text-zinc-300">${coin.allowance >= leftTotal && leftTotal > 0n ? "done" : leftTotal > 0n ? "one approval for the total, first" : "—"}</dd></div>` : ""}
        </dl>
        <button type="button" ${a.disabled ? "disabled" : `onclick="${a.onclick}"`} data-send-submit
            class="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed ${a.disabled ? "bg-white/[0.06] text-zinc-500" : "bg-brand-500 text-white hover:bg-brand-400"}">${escapeHtml(a.label)}</button>
        ${batchList(r)}
        <p class="mt-3 text-[11px] leading-relaxed text-zinc-500">Each transaction pays up to ${data.maxTransfers ?? 200} wallets, all or none. ${coin?.isNative === false ? "Tokens go straight from your wallet to each wallet; the program never holds them." : "The coins pass through the program in the same transaction; it never keeps any."}</p>
    </section>`;
}

function batchList(r) {
    const { batches, coin } = r;
    if (batches.length < 2 && !state.done.size) return "";
    let from = 1;
    return /*html*/`
    <ol class="mt-4 space-y-1.5" aria-label="Transactions" data-send-batch-list>
        ${batches.map((b, i) => {
            const hash = state.done.get(i);
            const start = from;
            from += b.length;
            const total = b.reduce((s, x) => s + x.amount, 0n);
            return /*html*/`
            <li class="flex items-center gap-3 rounded-xl border px-3 py-2 text-[12px] ${hash ? "border-mint-400/25 bg-mint-400/[0.05]" : "border-white/[0.07]"}" data-send-batch="${i + 1}" data-sent="${hash ? "yes" : "no"}">
                <span class="grid size-6 shrink-0 place-items-center rounded-full ${hash ? "bg-mint-400 text-ink-950" : "border border-white/15 text-[10px] font-semibold text-zinc-400"}">${hash ? icon("check", "size-3.5") : i + 1}</span>
                <span class="min-w-0 flex-1"><span class="block text-zinc-200">Wallets ${start.toLocaleString("en-US")}–${(start + b.length - 1).toLocaleString("en-US")}</span><span class="block font-mono text-zinc-500">${coin ? `${amount(total, coin, 4)} ${escapeHtml(coin.symbol)}` : ""}</span></span>
                ${hash ? `<a href="${escapeHtml(txUrl(hash))}" target="_blank" rel="noopener" class="inline-flex min-h-9 items-center gap-1 text-mint-300 hover:text-mint-200">Sent ${icon("external", "size-3.5")}</a>` : `<span class="text-zinc-500">Waiting</span>`}
            </li>`;
        }).join("")}
    </ol>`;
}

const howItWorks = /*html*/`
    <section class="rounded-3xl border border-white/[0.06] p-4 text-[12px] leading-relaxed text-zinc-400 sm:p-5">
        <p class="text-[13px] font-semibold text-white">How it works</p>
        <ol class="mt-2 space-y-2">
            <li class="flex gap-3"><span class="font-mono text-brand-300">01</span><span>Pick ${escapeHtml(nativeCoin(HUB).symbol)} or a token, then paste, type or upload the list.</span></li>
            <li class="flex gap-3"><span class="font-mono text-brand-300">02</span><span>Every line is checked as you type. Lines with a problem are listed by number.</span></li>
            <li class="flex gap-3"><span class="font-mono text-brand-300">03</span><span>Long lists go in transactions of up to 200 wallets. Confirm each one in your wallet; tokens need one approval first.</span></li>
        </ol>
    </section>`;

/* ------------------------------------ page */

const notReady = /*html*/`
    <main class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        ${pageHead("Multi transfer", "Multi transfer is not set up yet", "Add the BwscMultiSend address to settings/config.js (programs.multisend) after deploying it (deploy-kit/README.md, step 4c).")}
    </main>`;

const sendPage = (data) => {
    if (!data.isReady) return notReady;
    last = data;
    return /*html*/`
    <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 2xl:max-w-7xl" data-send>
        ${pageHead("Multi transfer", "Send to many wallets at once", `${escapeHtml(nativeCoin(HUB).symbol)} or any token on the chain, to hundreds of wallets. Up to ${data.maxTransfers ?? 200} in one transaction; longer lists are split for you.`)}
        ${data.problem ? `<div class="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-100" role="alert">${escapeHtml(data.problem)}</div>` : ""}
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-rise="2">
            <div class="min-w-0 space-y-4">${coinCard(data)}${listCard(data)}</div>
            <div class="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start" data-send-side>${summaryCard(data)}${howItWorks}</div>
        </div>
    </main>`;
};

const sendLoading = () => pageLoading("multi transfer");
const sendError = (message) => pageError(message);

/** Loads the chosen coin's numbers for this wallet (one read) */
const loadSend = (wallet) => getSendData(wallet, state.token);

/* ------------------------------------ actions (wired in ui/main.js) */

/** Redraws only the parts that depend on the list, so the box keeps focus and the caret stays put */
function patch() {
    if (!last) return;
    const side = document.querySelector("[data-send-side]");
    const problems = document.querySelector("[data-send-problems]");
    if (problems) problems.innerHTML = problemsBox(review(last));
    if (side) side.innerHTML = summaryCard(last) + howItWorks;
}

const sendText = (value) => { state.text = String(value ?? ""); patch(); };
const sendSameAmount = (value) => { state.sameText = String(value ?? ""); patch(); };
const sendSame = () => { state.same = !state.same; };
const sendClear = () => { state.text = ""; state.done = new Map(); };
const sendExample = () => { state.text = state.same ? EXAMPLE.split("\n").map((l) => l.split(",")[0]).join("\n") : EXAMPLE; };

/** Wallets listed twice: one line each with the amounts added up (switches off "same amount": amounts differ now) */
function sendMerge() {
    const r = last && review(last);
    if (!r?.coin) return;
    const merged = mergeDuplicates(r.list.rows);
    state.text = merged.map((x) => `${x.to}, ${fromUnits(x.amount, r.coin.decimals)}`).join("\n");
    state.same = false;
}

/** A CSV or text file: read it into the box (nothing is sent anywhere) */
async function sendFile(input, done = () => {}) {
    const file = input?.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error("That file is over 2 MB. Split the list into smaller files.");
    state.text = (await file.text()).replace(/^﻿/, "");
    input.value = "";
    done();
}

/** The coin list: the chain's coin, every listed token, or any token address pasted in the search */
function sendPickCoin(done = () => {}) {
    const coins = [ nativeCoin(HUB), ...listedTokens(HUB) ];
    openPicker({
        title: "Coin to send",
        placeholder: "Search, or paste a token address",
        items: coins.map((c) => ({ id: c.isNative ? ZERO : c.address, label: c.symbol, sub: `${c.name || c.symbol}${c.isNative ? " · native coin" : ` · ${shortAddress(c.address)}`}`, search: c.address, badge: tokenBadge(c) })),
        onPick: (address) => { state.token = String(address).toLowerCase(); done(); },
        onFree: (text) => { if (!isAddress(text)) return false; state.token = text.toLowerCase(); done(); return true; },
    });
}

/** What to send: the rows as checked now and the batches already sent (main.js runs it) */
function sendOrder() {
    if (!last) throw new Error("The page is still loading.");
    const r = review(last);
    const a = action(last, r);
    if (!a.primary) throw new Error(a.label);
    return { token: state.token, rows: r.list.rows, done: new Set(state.done.keys()) };
}

/** One batch went through: mark it (kept while the list stays the same) */
const sendBatchDone = (index, receipt) => { state.done.set(index, receipt?.transactionHash ?? receipt?.hash ?? "sent"); };

export { sendPage, sendLoading, sendError, loadSend, sendText, sendSameAmount, sendSame, sendClear, sendExample, sendMerge, sendFile, sendPickCoin, sendOrder, sendBatchDone };
