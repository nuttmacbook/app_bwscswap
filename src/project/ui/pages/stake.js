/*
 * YOUR CODE (off-chain). Staking page, built for many pools: "stake X, earn Y" in any mix of the native coin and tokens.
 * Search, filters (All / My stakes / Earning now) and 12 pools at a time. The owner streams reward into a pool whenever
 * they decide (amount + days, never withdrawable); every second the running rate is shared by stake size.
 * "Earned" ticks up live from the page's read (no extra reads). The owner also gets "New pool" (phase 1) and
 * "Add reward" on each pool (phase 2).
 */

import { icon } from "../icons";
import { pendingAt, listedTokens, nativeCoin, HUB } from "../../chain";
import { formNumber, escapeHtml, toUnits, fromUnits } from "../../../engine/ui/helpers";
import { openPicker } from "../componants/picker";
import { tokenBadge, pageHead, pageLoading, pageError, tabs, timeText } from "./shared";

const ZERO = "0x0000000000000000000000000000000000000000";
const PAGE = 12;
const FILTERS = [ { id: "all", label: "All pools" }, { id: "mine", label: "My stakes" }, { id: "live", label: "Earning now" } ];
const view = { filter: "all", query: "", shown: PAGE, open: null, mode: "stake", text: "" };
// The owner's new pool form (phase 1)
const newPool = { id: "", stake: "", reward: "" };
// The owner's reward form (one pool at a time)
const reward = { open: null, amount: "", days: "30" };
let last = null;
let ticker = null;

const poolOf = (id, data = last) => data?.pools?.find((p) => p.id === id) ?? null;
const pct = (bps) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Pools for the current filter and search: yours first, then the ones paying, then the rest */
const shown = (data) => {
    const q = view.query.trim().toLowerCase();
    return data.pools
        .filter((p) => (view.filter === "mine" ? p.myStake > 0n || p.myPending > 0n : view.filter === "live" ? p.status === "live" : true))
        .filter((p) => !q || `${p.id} ${p.stake.symbol} ${p.reward.symbol} ${p.stake.name} ${p.reward.name} ${p.stake.address} ${p.reward.address}`.toLowerCase().includes(q))
        .sort((a, b) => Number(b.myStake > 0n || b.myPending > 0n) - Number(a.myStake > 0n || a.myPending > 0n) || Number(b.status === "live") - Number(a.status === "live"));
};
const dateText = (at) => new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Live "earned" numbers: recomputed every second from the read, patched in place */
function tick() {
    if (!last || typeof document === "undefined") return;
    const at = Math.floor(Date.now() / 1000);
    for (const el of document.querySelectorAll("[data-earned]")) {
        const p = poolOf(el.dataset.earned);
        if (p) el.textContent = formNumber(pendingAt(p, at, last.now), p.reward.decimals, 8);
    }
}

const stat = (label, value, attr = "") => /*html*/`
    <div class="min-w-0">
        <dt class="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">${label}</dt>
        <dd class="mt-1 truncate font-mono text-[14px] tabular-nums text-white" ${attr}>${value}</dd>
    </div>`;

const statusTag = (p) => ({
    live: `<span class="whitespace-nowrap rounded-full bg-mint-400/15 px-2 py-0.5 text-[11px] font-medium text-mint-300" title="Rewards are funded until ${dateText(p.rewardEndsAt)}">Paying · until ${timeText(p.rewardEndsAt).replace(/^in /, "")}</span>`,
    idle: `<span class="whitespace-nowrap rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-zinc-400">No reward running</span>`,
    new: `<span class="whitespace-nowrap rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium text-sky-200">Waiting for rewards</span>`,
}[p.status]);

/** Main button of the open form → { label, isDisabled, onclick } */
function buttonFor(p, data = last) {
    const isStake = view.mode === "stake";
    const max = isStake ? p.walletBalance : p.myStake;
    const out = { label: isStake ? "Stake" : "Take out", isDisabled: false, onclick: `doStake('${p.id}')` };
    let amount = 0n;
    try { amount = view.text.trim() ? toUnits(view.text, p.stake.decimals) : 0n; } catch (err) { return { label: err.message, isDisabled: true }; }
    if (!data.isConnected) return { label: "Connect wallet", onclick: "openWallet()" };
    if (amount === 0n) return { label: "Enter an amount", isDisabled: true };
    if (amount > max) return { label: isStake ? `Not enough ${p.stake.symbol}` : "More than you staked", isDisabled: true };
    if (isStake && amount > max - (p.gasReserve ?? 0n)) return { label: `Keep some ${p.stake.symbol} for gas`, isDisabled: true };
    return out;
}

/** Stake / take out form inside an open card */
function formFor(p, data) {
    const isStake = view.mode === "stake";
    const max = isStake ? p.walletBalance : p.myStake;
    const { label, isDisabled, onclick } = buttonFor(p, data);
    return /*html*/`
        <div class="mt-4 rounded-2xl border border-white/[0.07] bg-ink-950/60 p-3">
            <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                ${tabs([ { id: "stake", label: "Stake" }, { id: "unstake", label: "Take out" } ], view.mode, "stakeMode")}
                <span class="whitespace-nowrap text-[12px] text-zinc-500">${isStake ? "Wallet" : "Staked"} <span class="font-mono tabular-nums text-zinc-300">${formNumber(max, p.stake.decimals, 4)}</span>
                    <button type="button" onclick="stakeMax('${p.id}')" class="-my-2 ml-1 inline-flex min-h-9 items-center rounded-md px-2.5 font-semibold text-brand-300 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Max</button></span>
            </div>
            <div class="mt-3 flex items-center gap-3">
                <input data-stake-in oninput="stakeInput(this.value)" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0" value="${escapeHtml(view.text)}"
                    aria-label="Amount of ${escapeHtml(p.stake.symbol)}" class="amount-input min-w-0 flex-1 bg-transparent font-mono text-[24px] tabular-nums text-white outline-none placeholder:text-zinc-600" />
                <span class="text-[14px] font-semibold text-zinc-300">${escapeHtml(p.stake.symbol)}</span>
            </div>
            <button type="button" data-stake-button onclick="${onclick ?? ""}" ${isDisabled ? "disabled" : ""} class="btn-brand mt-3 w-full rounded-xl px-4 py-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">${escapeHtml(label)}</button>
        </div>`;
}

const card = (p, data) => {
    const isOpen = view.open === p.id;
    const share = p.totalStaked > 0n && p.myStake > 0n ? Number((p.myStake * 1_000_000n) / p.totalStaked) / 10_000 : 0;
    return /*html*/`
    <article class="surface flex min-w-0 flex-col rounded-3xl p-5" data-pool="${escapeHtml(p.id)}">
        <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div class="flex min-w-[10rem] flex-1 items-center gap-3">
                <span class="flex shrink-0">${tokenBadge(p.stake, null, "size-9")}<span class="-ml-2">${tokenBadge(p.reward, null, "size-9")}</span></span>
                <div class="min-w-0">
                    <p class="break-words text-[15px] font-semibold text-white">Stake ${escapeHtml(p.stake.symbol)}</p>
                    <p class="break-words text-[12px] text-zinc-500">${p.stake.isNative ? "Native coin · " : ""}Earn ${escapeHtml(p.reward.symbol)} · <span class="font-mono">${escapeHtml(p.id)}</span></p>
                </div>
            </div>
            ${statusTag(p)}
        </div>
        <dl class="mt-5 grid grid-cols-3 gap-3">
            ${stat("APR", p.aprBps === null ? "—" : pct(p.aprBps), "data-apr")}
            ${stat("Per day", `${formNumber(p.rewardPerDay, p.reward.decimals, 2)}`)}
            ${stat("Staked", formNumber(p.totalStaked, p.stake.decimals, 0))}
        </dl>
        <div class="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div class="min-w-0">
                <p class="text-[11px] text-zinc-500">Earned ${escapeHtml(p.reward.symbol)}</p>
                <p class="truncate font-mono text-[16px] tabular-nums text-brand-200" data-earned="${escapeHtml(p.id)}">${formNumber(p.myPending, p.reward.decimals, 8)}</p>
                <p class="text-[11px] text-zinc-500">You stake ${formNumber(p.myStake, p.stake.decimals, 4)}${share ? ` · ${share}% of pool` : ""}</p>
            </div>
            <button type="button" onclick="doStakeClaim('${p.id}')" ${p.myPending > 0n || p.myStake > 0n ? "" : "disabled"}
                class="shrink-0 rounded-xl border border-brand-400/40 px-3 py-2 text-[13px] font-semibold text-brand-200 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40">Claim</button>
        </div>
        <p class="mt-3 text-[11px] leading-relaxed text-zinc-500" data-reward-left="${escapeHtml(p.id)}">${p.status === "live"
            ? `${formNumber(p.scheduled, p.reward.decimals, 2)} ${escapeHtml(p.reward.symbol)} still to be paid out, funded until ${dateText(p.rewardEndsAt)}.`
            : p.status === "new" ? "No reward has been added yet. Staking already works; earning starts when the owner adds reward." : "The last reward stream has ended. Earning starts again when the owner adds more."}</p>
        ${isOpen ? formFor(p, data) : /*html*/`
            <button type="button" onclick="stakeOpen('${p.id}')" class="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                Stake / take out</button>`}
        ${data.isOwner ? ownerPanel(p) : ""}
    </article>`;
};

const notReady = /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-[13px] text-amber-100" role="status" data-stake-setup>
            <p class="font-semibold">Staking is not set up yet</p>
            <p class="mt-1 text-amber-100/90">The staking program's address goes in settings/config.js (programs.staking).</p>
        </div>
    </main>`;

function cards(data) {
    const list = shown(data);
    if (!list.length) return `<p class="col-span-full rounded-2xl border border-white/[0.06] py-10 text-center text-[13px] text-zinc-500">${view.filter === "mine" ? "You have no stakes yet." : data.pools.length ? "No pool matches." : "No pools yet."}</p>`;
    return list.slice(0, view.shown).map((p) => card(p, data)).join("") + (list.length > view.shown ? /*html*/`
        <div class="col-span-full text-center"><button type="button" onclick="stakeMore()" class="rounded-lg px-3 py-1.5 text-[13px] font-medium text-brand-300 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Show more (${list.length - view.shown} left)</button></div>` : "");
}

/** Coins a new pool can use: the native coin, listed tokens, every coin already in a pool */
function poolCoins(data = last) {
    const seen = new Map([ [ ZERO, nativeCoin(HUB) ] ]);
    for (const t of listedTokens(HUB)) seen.set(t.address, t);
    for (const p of data.pools) for (const t of [ p.stake, p.reward ]) if (!seen.has(t.address)) seen.set(t.address, t);
    return [ ...seen.values() ];
}
const coinLabel = (a) => {
    if (!a) return "Pick a coin";
    const c = poolCoins().find((x) => x.address === a.toLowerCase());
    return c ? c.symbol : `${a.slice(0, 6)}…${a.slice(-4)}`;
};

function newPoolCard(data) {
    if (!data.isOwner) return "";
    const ready = /^[a-z0-9][a-z0-9-]{0,39}$/.test(newPool.id) && newPool.stake && newPool.reward;
    return /*html*/`
        <section class="surface mt-6 rounded-3xl p-5 sm:p-6" data-rise="3" aria-label="New pool" data-new-pool>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-[15px] font-semibold text-white">New pool (owner)</p>
                <p class="text-[12px] text-zinc-500">Step 1: pick what people stake and what they earn. Step 2: add reward on the pool.</p>
            </div>
            <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] lg:grid-cols-[1.3fr_1fr_1fr_auto]">
                <label class="rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2 sm:col-span-3 lg:col-span-1">
                    <span class="block text-[10px] uppercase tracking-[0.14em] text-zinc-500">Name (a-z, 0-9, -)</span>
                    <input data-new-pool-id oninput="stakeNewId(this.value)" value="${escapeHtml(newPool.id)}" placeholder="bwsc-usdt" autocomplete="off" spellcheck="false" class="w-full bg-transparent font-mono text-[15px] text-white outline-none placeholder:text-zinc-600" />
                </label>
                ${[ [ "stake", "Stake" ], [ "reward", "Earn" ] ].map(([ k, label ]) => /*html*/`
                    <button type="button" onclick="stakeNewPick('${k}')" data-new-pool-${k} class="flex flex-col justify-center rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2 text-left hover:border-brand-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <span class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">${label}</span>
                        <span class="text-[15px] font-semibold text-white">${escapeHtml(coinLabel(newPool[k]))}</span><span class="text-zinc-500">${icon("chevronDown")}</span>
                    </button>`).join("")}
                <button type="button" onclick="doCreatePool()" ${ready ? "" : "disabled"} class="btn-brand rounded-xl px-4 py-2.5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">Create pool</button>
            </div>
            <p class="mt-3 text-[12px] leading-relaxed text-zinc-500">Any mix works: stake ${escapeHtml(nativeCoin(HUB).symbol)} and earn a token, stake a token and earn a token, or stake a token and earn ${escapeHtml(nativeCoin(HUB).symbol)}. The coins of a pool cannot change later.</p>
        </section>`;
}

const stakePage = (data) => {
    if (!data.isReady) return notReady;
    last = data;
    clearInterval(ticker);
    ticker = setInterval(() => { if (document.body.dataset.page === "stake") tick(); else clearInterval(ticker); }, 1000);
    const mine = data.pools.filter((p) => p.myStake > 0n || p.myPending > 0n).length;
    const filters = FILTERS.map((f) => (f.id === "mine" && mine ? { ...f, label: `${f.label} (${mine})` } : f));
    return /*html*/`
    <main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        ${pageHead("Stake", "Stake coins, earn rewards every second", `${data.pools.length} pool${data.pools.length === 1 ? "" : "s"}. The owner adds rewards to each pool and they are paid out evenly over time, shared by everyone staked by stake size. Rewards added can never be taken back. You can take your stake out at any time.`)}
        ${data.isOwner ? `<div class="mb-5 rounded-2xl border border-brand-400/30 bg-brand-500/10 px-4 py-3 text-[13px] text-brand-100" role="note" data-owner-note>You are the owner: create pools below, and each pool has an "Add reward" form. Reward you add is paid out over the days you choose and cannot be taken back.</div>` : ""}
        ${data.paused ? `<div class="mb-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">Staking is paused by its owner: no new stakes. Taking out and claiming still work.</div>` : ""}
        <div class="mb-5 flex flex-wrap items-center gap-3" data-rise="2">
            ${tabs(filters, view.filter, "stakeFilter")}
            <input data-stake-search oninput="stakeSearch(this.value)" value="${escapeHtml(view.query)}" type="search" placeholder="Search coin or pool" autocomplete="off" spellcheck="false"
                class="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60 sm:max-w-xs" aria-label="Search pools" />
        </div>
        <div class="grid gap-4 md:grid-cols-2" data-rise="3" data-stake-cards>${cards(data)}</div>
        ${newPoolCard(data)}
    </main>`;
};

/* ------------------------------------ actions (wired in ui/main.js) */

const stakeFilter = (id) => { view.filter = id; view.open = null; view.shown = PAGE; };
const stakeMore = () => { view.shown += PAGE; };
/** Search filters the cards in place, so the box keeps focus */
const stakeSearch = (value) => {
    view.query = String(value ?? "");
    view.shown = PAGE;
    const el = document.querySelector("[data-stake-cards]");
    if (el && last) { el.innerHTML = cards(last); tick(); }
};

/* ------------------------------------ owner: new pool (phase 1) */

const stakeNewId = (value) => {
    newPool.id = String(value ?? "").trim().toLowerCase();
    const button = document.querySelector("[data-new-pool] .btn-brand");
    if (button) button.disabled = !(/^[a-z0-9][a-z0-9-]{0,39}$/.test(newPool.id) && newPool.stake && newPool.reward);
};
function stakeNewPick(key, done = () => {}) {
    if (!last) return;
    openPicker({
        title: key === "stake" ? "People stake" : "People earn",
        placeholder: "Search, or paste a token address",
        items: poolCoins().map((t) => ({ id: t.address, label: t.symbol, sub: `${t.name}${t.address === ZERO ? " · native coin" : ` · ${t.address.slice(0, 6)}…${t.address.slice(-4)}`}`, search: t.address, badge: tokenBadge(t) })),
        onPick: (address) => { newPool[key] = address; done(); },
        onFree: (text) => (/^0x[0-9a-fA-F]{40}$/.test(text) ? (newPool[key] = text.toLowerCase(), done(), true) : false),
    });
}
function newPoolOrder() {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(newPool.id)) throw new Error("Name the pool with a-z, 0-9 and - (up to 40 characters), e.g. bwsc-usdt.");
    if (!newPool.stake || !newPool.reward) throw new Error("Pick the stake coin and the reward coin.");
    return { poolId: newPool.id, stakeToken: newPool.stake, rewardToken: newPool.reward, label: `stake ${coinLabel(newPool.stake)}, earn ${coinLabel(newPool.reward)}` };
}
const newPoolReset = () => { newPool.id = ""; newPool.stake = ""; newPool.reward = ""; };
const stakeOpen = (id) => { view.open = id; view.text = ""; view.mode = "stake"; };
const stakeMode = (mode) => { view.mode = mode; view.text = ""; };
function stakeInput(value) {
    view.text = String(value ?? "").replace(/,/g, ".");
    const p = poolOf(view.open);
    const button = document.querySelector("[data-stake-button]");
    if (!p || !button) return;
    const state = buttonFor(p);
    button.textContent = state.label;
    button.disabled = Boolean(state.isDisabled);
    button.setAttribute("onclick", state.onclick ?? "");
}
function stakeMax(id) {
    const p = poolOf(id);
    if (!p) return;
    const max = view.mode === "stake" ? p.walletBalance - (p.gasReserve ?? 0n) : p.myStake;
    view.text = fromUnits(max > 0n ? max : 0n, p.stake.decimals);
}
const stakeReset = () => { view.text = ""; };

function stakeOrder(id) {
    const p = poolOf(id);
    if (!p) throw new Error("That pool is gone.");
    return { poolId: id, mode: view.mode, amount: toUnits(view.text || "0", p.stake.decimals) };
}

/* ------------------------------------ owner: add reward (phase 2) */

/** The owner's "Add reward" button → { label, isDisabled, onclick } */
function rewardButton(p) {
    let amount = 0n;
    try { amount = reward.amount.trim() ? toUnits(reward.amount, p.reward.decimals) : 0n; } catch (err) { return { label: err.message, isDisabled: true }; }
    const days = Number(reward.days);
    if (amount === 0n) return { label: "Enter an amount", isDisabled: true };
    if (!(days > 0)) return { label: "Enter the days", isDisabled: true };
    if (days * 86_400 < 60) return { label: "At least 1 minute", isDisabled: true };
    if (days > 5 * 366) return { label: "At most 5 years", isDisabled: true };
    if (amount > p.reward.balance) return { label: `Not enough ${p.reward.symbol}`, isDisabled: true };
    return { label: `Add ${fromUnits(amount, p.reward.decimals)} ${p.reward.symbol} over ${days} day${days === 1 ? "" : "s"}`, onclick: `doAddReward('${p.id}')` };
}

const rewardSummary = (p) => {
    let perDay = "—";
    try {
        const amount = reward.amount.trim() ? toUnits(reward.amount, p.reward.decimals) : 0n;
        const seconds = BigInt(Math.round(Number(reward.days) * 86_400));
        if (amount > 0n && seconds >= 60n) perDay = `+${formNumber((amount * 86_400n) / seconds, p.reward.decimals, 4)} ${escapeHtml(p.reward.symbol)}/day`;
    } catch { /* shown on the button */ }
    return perDay;
};

function ownerPanel(p) {
    if (reward.open !== p.id) {
        return /*html*/`<button type="button" onclick="rewardOpen('${p.id}')" data-reward-open="${escapeHtml(p.id)}" class="mt-2 w-full rounded-xl border border-brand-400/30 px-4 py-2 text-[13px] font-semibold text-brand-200 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Add reward (owner)</button>`;
    }
    const state = rewardButton(p);
    return /*html*/`
        <div class="mt-3 rounded-2xl border border-brand-400/25 bg-brand-500/[0.06] p-3" data-reward-form="${escapeHtml(p.id)}">
            <div class="flex items-center justify-between text-[12px]">
                <span class="font-semibold text-brand-100">Add reward</span>
                <span class="text-zinc-500">Wallet <span class="font-mono tabular-nums text-zinc-300">${formNumber(p.reward.balance, p.reward.decimals, 2)}</span> ${escapeHtml(p.reward.symbol)}</span>
            </div>
            <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <label class="min-w-0 rounded-xl border border-white/[0.08] bg-ink-950/60 px-3 py-2">
                    <span class="block text-[10px] uppercase tracking-[0.14em] text-zinc-500">Amount (${escapeHtml(p.reward.symbol)})</span>
                    <input data-reward-amount oninput="rewardInput('amount', this.value)" type="text" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${escapeHtml(reward.amount)}" class="amount-input w-full min-w-0 bg-transparent font-mono text-[18px] tabular-nums text-white outline-none placeholder:text-zinc-600" />
                </label>
                <label class="w-24 rounded-xl border border-white/[0.08] bg-ink-950/60 px-3 py-2">
                    <span class="block text-[10px] uppercase tracking-[0.14em] text-zinc-500">Days</span>
                    <input data-reward-days oninput="rewardInput('days', this.value)" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(reward.days)}" class="amount-input w-full bg-transparent font-mono text-[18px] tabular-nums text-white outline-none" />
                </label>
            </div>
            <p class="mt-2 text-[12px] text-zinc-400">Rate: <span class="font-mono tabular-nums text-zinc-200" data-reward-rate>${rewardSummary(p)}</span> on top of what is running. Paid in now; it can never be taken back out.</p>
            ${p.unallocated > 0n ? `<p class="mt-1 text-[11px] text-zinc-500">Unallocated (seconds nobody was staked): <span class="font-mono tabular-nums text-zinc-300">${formNumber(p.unallocated, p.reward.decimals, 4)}</span> ${escapeHtml(p.reward.symbol)} — the owner can stream it again (restream).</p>` : ""}
            <button type="button" data-reward-button onclick="${state.onclick ?? ""}" ${state.isDisabled ? "disabled" : ""} class="btn-brand mt-2 w-full rounded-xl px-4 py-2.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">${escapeHtml(state.label)}</button>
        </div>`;
}

const rewardOpen = (id) => { reward.open = reward.open === id ? null : id; reward.amount = ""; };
function rewardInput(field, value) {
    reward[field === "days" ? "days" : "amount"] = String(value ?? "").replace(/,/g, ".");
    const p = poolOf(reward.open);
    if (!p) return;
    const state = rewardButton(p);
    const button = document.querySelector("[data-reward-button]");
    if (button) { button.textContent = state.label; button.disabled = Boolean(state.isDisabled); button.setAttribute("onclick", state.onclick ?? ""); }
    const rate = document.querySelector("[data-reward-rate]");
    if (rate) rate.innerHTML = rewardSummary(p);
}
function rewardOrder(id) {
    const p = poolOf(id);
    if (!p) throw new Error("That pool is gone.");
    return { poolId: id, amount: toUnits(reward.amount || "0", p.reward.decimals), days: Number(reward.days), symbol: p.reward.symbol };
}
const rewardReset = () => { reward.amount = ""; reward.open = null; };

export { stakePage, stakeFilter, stakeMore, stakeSearch, stakeNewId, stakeNewPick, newPoolOrder, newPoolReset, stakeOpen, stakeMode, stakeInput, stakeMax, stakeReset, stakeOrder, rewardOpen, rewardInput, rewardOrder, rewardReset, pageLoading as stakeLoadingOf, pageError as stakeError };
