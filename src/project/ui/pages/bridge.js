/*
 * YOUR CODE (off-chain). Bridge page. Bluewolfchain is the hub: every chain in settings/config.js `chains` bridges
 * with it, and new chains / coins appear here as soon as they are added (settings + setRoute on both bridges).
 * Pick From and To (any chain), then the coin. Coins and routes come from the bridges themselves, not from this file.
 * Two other chains never bridge directly: the page says to go through the hub (two steps).
 *
 *   1. Bridge   lock the coins on the source chain (from another chain the wallet switches there for one step)
 *   2. Arrive   the bridge signer's relayer delivers it on the other chain by itself (settings bridgeSigner.autoDeliver);
 *               "Claim now" stays as a fallback. With autoDeliver false, the user claims (one claim pays everything waiting)
 */

import { icon } from "../icons";
import { formNumber, escapeHtml, toUnits, fromUnits } from "../../../engine/ui/helpers";
import { openPicker } from "../componants/picker";
import { tokenBadge, chainBadge, pageHead, pageLoading, pageError, feeText } from "./shared";
import { AUTO_DELIVER } from "../../chain/bridge";

const GAS_RESERVE = toUnits("0.01", 18);   // native coins kept for gas when the native coin is sent
const form = { other: "", out: true, route: "", text: "", note: "" };   // out = from the hub to the other chain
let last = null;

const hubOf = (data = last) => data.chains.find((c) => c.isHub);
const otherChains = (data = last) => data.chains.filter((c) => !c.isHub);
const chainBy = (key, data = last) => data.chains.find((c) => c.key === key);
const routesOf = (data = last) => data.routes.filter((r) => r.chain.key === form.other);

/** Keeps the form on something that exists: a chain with routes, a route of that chain (the same hub coin if it can) */
function settle(data = last) {
    const usable = otherChains(data).filter((c) => data.routes.some((r) => r.chain.key === c.key));
    if (!usable.some((c) => c.key === form.other)) form.other = usable[0]?.key ?? otherChains(data)[0]?.key ?? "";
    if (!routesOf(data).some((r) => r.id === form.route)) {
        const hubCoin = String(form.route).split(":")[1];
        form.route = routesOf(data).find((r) => r.hub.address === hubCoin)?.id ?? routesOf(data)[0]?.id ?? "";
    }
}
const routeCount = (key, data = last) => data.routes.filter((r) => r.chain.key === key).length;
const routeOf = (data = last) => data.routes.find((r) => r.id === form.route) ?? null;
const source = (r) => (form.out ? r.hub : r.remote);
const dest = (r) => (form.out ? r.remote : r.hub);
const fromChain = (data = last) => (form.out ? hubOf(data) : chainBy(form.other, data));
const toChain = (data = last) => (form.out ? chainBy(form.other, data) : hubOf(data));
const pausedOn = (chain) => Boolean(chain?.paused);

/** What a coin is on its chain, in words */
const kindOf = (side, chain) => (side.isNative ? `${chain.name}'s own coin` : `token on ${chain.name}`);

/** When a deposit on `chain` can be claimed, in words (settings `confirmations`) */
const waitText = (chain) => {
    const n = chain?.confirmations;
    if (n === undefined || n === null || chain?.isHub) return "once the bridge signer has seen it";
    if (n === "finalized") return `once its block on ${chain.name} is final`;
    return Number(n) > 0 ? `after ${Number(n)} more block${Number(n) === 1 ? "" : "s"} on ${chain.name}` : "once the bridge signer has seen it";
};

/** How soon a deposit on `chain` can be claimed, in a few words (for the chains list) */
const waitShort = (chain) => {
    const n = chain?.confirmations;
    const verb = AUTO_DELIVER ? "arrives" : "claim";
    if (n === "finalized") return `${verb} once the block is final`;
    return Number(n) > 0 ? `${verb} after ${Number(n)} block${Number(n) === 1 ? "" : "s"}` : `${verb} right away`;
};

/** A chain's state for pickers and the routes list */
const chainStatus = (c, data = last) => {
    if (c.problem) return { tone: "off", text: `Not available: ${c.problem}` };
    if (c.paused) return { tone: "paused", text: "Paused by the owner" };
    if (!c.isHub && !routeCount(c.key, data)) return { tone: "off", text: "No coins yet" };
    return { tone: "on", text: c.isHub ? "Hub: bridges with every chain" : `${routeCount(c.key, data)} coin${routeCount(c.key, data) === 1 ? "" : "s"}` };
};

function evaluate(data = last) {
    const r = routeOf(data);
    const side = source(r);
    const reserve = side.isNative ? GAS_RESERVE : 0n;
    if (!form.text.trim()) return { r, side, reserve, amount: 0n, fee: 0n, error: "" };
    try {
        const amount = toUnits(form.text, side.coin.decimals);
        return { r, side, reserve, amount, error: "", fee: (amount * BigInt(side.feeBps)) / 10_000n };
    } catch (err) {
        return { r, side, reserve, amount: 0n, fee: 0n, error: err.message };
    }
}

function action(data = last) {
    const { side, reserve, amount, error } = evaluate(data);
    const from = fromChain(data);
    if (!data.isConnected) return { label: "Connect wallet", onclick: "openWallet()" };
    if (pausedOn(from)) return { label: "The bridge is paused", isDisabled: true };
    if (!side.enabled) return { label: `${side.coin.symbol} is closed on ${from.short}`, isDisabled: true };
    if (error) return { label: error, isDisabled: true };
    if (amount === 0n) return { label: "Enter an amount", isDisabled: true };
    if (amount < side.min) return { label: `At least ${fromUnits(side.min, side.coin.decimals)} ${side.coin.symbol}`, isDisabled: true };
    if (amount > side.balance) return { label: `Not enough ${side.coin.symbol}`, isDisabled: true };
    if (amount > side.balance - reserve) return { label: `Keep some ${side.coin.symbol} for gas`, isDisabled: true };
    const needsApprove = !side.isNative && side.allowance < amount;
    return { label: `${needsApprove ? "Approve & bridge" : "Bridge"} to ${toChain(data).name}`, onclick: "doBridge()" };
}

function summary(data = last) {
    const { r, side, amount, fee } = evaluate(data);
    const to = toChain(data);
    const got = dest(r);
    const line = (k, v) => `<div class="flex justify-between gap-3"><dt class="text-zinc-500">${k}</dt><dd class="text-right font-mono tabular-nums text-zinc-200">${v}</dd></div>`;
    return [
        line("You receive", amount > 0n ? `${formNumber(amount - fee, side.coin.decimals, 6)} ${escapeHtml(got.coin.symbol)}` : "—"),
        line("Bridge fee", side.feeFree ? `<span data-bridge-fee-free>None: fee-free wallet</span>` : `${feeText(side.feeBps)}${amount > 0n ? ` · ${formNumber(fee, side.coin.decimals, 6)}` : ""}`),
        line("Arrives as", escapeHtml(kindOf(got, to))),
        line("Minimum", `${formNumber(side.min, side.coin.decimals, 6)} ${escapeHtml(side.coin.symbol)}`),
        `<p class="pt-1 text-[12px] leading-relaxed text-zinc-500" data-bridge-how>${AUTO_DELIVER
            ? `It arrives in your wallet on ${escapeHtml(to.name)} by itself, ${escapeHtml(waitText(fromChain(data)))}: nothing to claim, and no ${escapeHtml(to.native?.symbol ?? to.short)} needed there.`
            : `Then claim it on ${escapeHtml(to.name)} below, ${escapeHtml(waitText(fromChain(data)))}.`}${form.out ? "" : ` Your wallet switches to ${escapeHtml(fromChain(data).name)} for this step and needs a little ${escapeHtml(fromChain(data).native?.symbol ?? fromChain(data).short)} for gas.`} The coins arrive at the same address on the other chain: use a normal wallet, not a contract wallet (like a Safe).</p>`,
    ].join("");
}

const paint = () => {
    if (!last?.isReady || !routeOf()) return;
    const box = document.querySelector("[data-bridge-summary]");
    if (box) box.innerHTML = summary();
    const button = document.querySelector("[data-bridge-button]");
    const state = action();
    if (button) { button.textContent = state.label; button.disabled = Boolean(state.isDisabled); button.setAttribute("onclick", state.onclick ?? ""); }
};

const chainButton = (side, data) => {
    const chain = side === "from" ? fromChain(data) : toChain(data);
    return /*html*/`
        <button type="button" onclick="bridgeChain('${side}')" data-bridge-${side} aria-label="${side === "from" ? "From" : "To"} chain: ${escapeHtml(chain.name)}. Change" class="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-ink-950/60 p-3 text-left transition hover:border-brand-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <span class="hidden shrink-0 min-[400px]:block">${chainBadge(chain, "size-9")}</span>
            <span class="min-w-0 flex-1">
                <span class="block text-[11px] uppercase tracking-[0.14em] text-zinc-500">${side === "from" ? "From" : "To"}</span>
                <span class="block truncate text-[15px] font-semibold text-white"><span class="sm:hidden">${escapeHtml(chain.short)}</span><span class="hidden sm:inline">${escapeHtml(chain.name)}</span></span>
            </span>
            <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>`;
};

/** Everything waiting to be claimed, on every route and in both directions */
const waitingRows = (data) => data.routes.flatMap((r) => [
    { r, to: "hub", amount: r.waitingIn, coin: r.hub.coin, chain: hubOf(data), from: chainBy(r.chain.key, data) },
    { r, to: "remote", amount: r.waitingOut, coin: r.remote.coin, chain: chainBy(r.chain.key, data), from: hubOf(data) },
]).filter((w) => w.amount > 0n);

const waitingRow = (data, { r, to, amount, coin, chain, from }) => /*html*/`
            <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[13px]" data-waiting="${escapeHtml(r.id)}-${to}">
                <span class="flex min-w-0 items-center gap-2.5">
                    ${tokenBadge(coin, null, "size-6")}
                    <span class="min-w-0">
                        <span class="block font-mono tabular-nums text-white">${formNumber(amount, coin.decimals, 6)} ${escapeHtml(coin.symbol)}</span>
                        <span class="block truncate text-[11px] text-zinc-500">from ${escapeHtml(from.name)}</span>
                    </span>
                </span>
                ${AUTO_DELIVER ? /*html*/`
                <span class="flex items-center gap-3">
                    <span class="inline-flex items-center gap-1.5 text-[12px] text-brand-200" data-arriving><span class="size-1.5 animate-pulse rounded-full bg-brand-300" aria-hidden="true"></span>Arriving on ${escapeHtml(chain.short)}</span>
                    <button type="button" onclick="doClaim('${escapeHtml(r.id)}', '${to}')" ${data.isConnected && !pausedOn(chain) && !chain.problem ? "" : "disabled"} title="Only if it takes too long: claim it yourself (you pay the gas)"
                        class="min-h-9 rounded-lg px-2 text-[12px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40">Claim now</button>
                </span>` : /*html*/`
                <button type="button" onclick="doClaim('${escapeHtml(r.id)}', '${to}')" ${data.isConnected && !pausedOn(chain) && !chain.problem ? "" : "disabled"}
                    class="min-h-9 rounded-xl border border-brand-400/40 px-3 py-1.5 text-[13px] font-semibold text-brand-200 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40">Claim on ${escapeHtml(chain.short)}</button>`}
            </li>`;

const waitingSection = (data) => {
    const rows = waitingRows(data);
    // Grouped by the chain the coins are claimed on (hub first, then settings order)
    const groups = data.chains.map((c) => ({ chain: c, rows: rows.filter((w) => w.chain.key === c.key) })).filter((g) => g.rows.length);
    return /*html*/`
    <section class="mt-8" data-rise="3" aria-label="${AUTO_DELIVER ? "On the way" : "Waiting to claim"}" data-waiting-count="${rows.length}" ${AUTO_DELIVER && rows.length ? "data-bridge-watch" : ""}>
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="text-[13px] font-semibold text-white">${AUTO_DELIVER ? "On the way" : "Waiting to claim"}${rows.length ? ` (${rows.length})` : ""}</p>
            <p class="text-[11px] text-zinc-500">${AUTO_DELIVER ? "Delivered to your wallet by itself" : "One claim pays everything that arrived"}</p>
        </div>
        <div class="mt-2" data-bridge-waiting>
            ${groups.map((g) => /*html*/`
            <div data-waiting-chain="${escapeHtml(g.chain.key)}">
                <p class="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">On ${escapeHtml(g.chain.name)}</p>
                <ul class="mt-1 divide-y divide-white/[0.06] border-y border-white/[0.06]">${g.rows.map((w) => waitingRow(data, w)).join("")}</ul>
            </div>`).join("") || `<p class="border-y border-white/[0.06] py-6 text-center text-[13px] text-zinc-500">${data.isConnected ? (AUTO_DELIVER ? "Nothing on the way. A transfer shows here until it arrives." : "Nothing waiting. Bridged coins show up here until you claim them.") : "Connect a wallet to see your transfers."}</p>`}
        </div>
    </section>`;
};

/** Every chain and every coin the bridge carries, with its state (works without a wallet) */
const routesSection = (data) => {
    const hub = hubOf(data);
    const tone = { on: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200", paused: "border-amber-400/30 bg-amber-500/10 text-amber-100", off: "border-white/10 bg-white/[0.04] text-zinc-400" };
    const side = (s) => (s.enabled ? `${feeText(s.feeBps)} fee` : "closed");
    return /*html*/`
    <section class="mt-8" data-rise="4" aria-label="Chains and coins" data-bridge-routes>
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="text-[13px] font-semibold text-white">Chains and coins</p>
            <p class="text-[11px] text-zinc-500">${otherChains(data).length} chain${otherChains(data).length === 1 ? "" : "s"} bridge with ${escapeHtml(hub.name)}</p>
        </div>
        <div class="mt-2 space-y-2">
            ${otherChains(data).map((c) => {
                const st = chainStatus(c, data);
                const list = data.routes.filter((r) => r.chain.key === c.key);
                return /*html*/`
            <div class="rounded-2xl border border-white/[0.06] p-3" data-route-chain="${escapeHtml(c.key)}">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                    ${chainBadge(c, "size-8")}
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-[14px] font-semibold text-white">${escapeHtml(c.name)}</span>
                        <span class="block text-[11px] text-zinc-500">Chain ${escapeHtml(String(c.chainId))}${c.isHub ? "" : ` · ${escapeHtml(waitShort(c))}`}</span>
                    </span>
                    <span class="rounded-full border px-2.5 py-0.5 text-[11px] ${tone[st.tone]}" data-route-status="${st.tone}">${escapeHtml(st.text)}</span>
                </div>
                ${list.length ? `<ul class="mt-2 space-y-1">${list.map((r) => /*html*/`
                    <li><button type="button" onclick="bridgeUse('${escapeHtml(r.id)}')" data-route="${escapeHtml(r.id)}" class="flex min-h-10 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <span class="flex min-w-0 items-center gap-2 text-zinc-200">${tokenBadge(r.hub.coin, null, "size-5")}<span class="font-semibold text-white">${escapeHtml(r.hub.coin.symbol)}</span><span class="text-zinc-500">${icon("pair", "size-3.5")}</span>${tokenBadge(r.remote.coin, null, "size-5")}<span class="font-semibold text-white">${escapeHtml(r.remote.coin.symbol)}</span></span>
                        <span class="text-zinc-500">to ${escapeHtml(c.short)}: ${side(r.hub)} · to ${escapeHtml(hub.short)}: ${side(r.remote)}</span>
                    </button></li>`).join("")}</ul>` : ""}
            </div>`;
            }).join("")}
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">Every chain bridges with ${escapeHtml(hub.name)}. To move coins between two other chains, bridge to ${escapeHtml(hub.name)} first, then from ${escapeHtml(hub.name)} to the other chain. New chains and coins show up here as they are added.</p>
    </section>`;
};

const totalsSection = (data) => {
    const used = data.routes.filter((r) => r.remote.bridgedIn > 0n || r.hub.bridgedOut > 0n);
    if (!data.isConnected || !used.length) return "";
    const hub = hubOf(data);
    return /*html*/`
    <section class="mt-8" data-rise="4" aria-label="Your bridge totals">
        <p class="text-[13px] font-semibold text-white">Your totals</p>
        <div class="mt-2 overflow-x-auto rounded-2xl border border-white/[0.06]">
            <table class="w-full min-w-[480px] text-[12px]">
                <thead class="text-zinc-500"><tr class="border-b border-white/[0.06]">
                    <th class="px-3 py-2 text-left font-medium">Coin · chain</th>
                    <th class="px-3 py-2 text-right font-medium">Sent to ${escapeHtml(hub.short)}</th>
                    <th class="px-3 py-2 text-right font-medium">Claimed on ${escapeHtml(hub.short)}</th>
                    <th class="px-3 py-2 text-right font-medium">Sent from ${escapeHtml(hub.short)}</th>
                    <th class="px-3 py-2 text-right font-medium">Claimed there</th>
                </tr></thead>
                <tbody class="font-mono tabular-nums text-zinc-300">
                    ${used.map((r) => /*html*/`<tr>
                        <td class="px-3 py-2 font-sans text-white">${escapeHtml(r.hub.coin.symbol)} <span class="text-zinc-500">and ${escapeHtml(r.remote.coin.symbol)} · ${escapeHtml(r.chain.name)}</span></td>
                        <td class="px-3 py-2 text-right">${formNumber(r.remote.bridgedIn, r.remote.coin.decimals, 4)}</td>
                        <td class="px-3 py-2 text-right">${formNumber(r.hub.claimedIn, r.hub.coin.decimals, 4)}</td>
                        <td class="px-3 py-2 text-right">${formNumber(r.hub.bridgedOut, r.hub.coin.decimals, 4)}</td>
                        <td class="px-3 py-2 text-right">${formNumber(r.remote.claimedOut, r.remote.coin.decimals, 4)}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">Running totals on each chain (after fees). The signer signs the total; a claim pays total − claimed, so a signature can never pay twice. Anyone may send a claim for you (the relayer does it automatically): the coins always go to your address.</p>
    </section>`;
};

const setupNote = (lines) => /*html*/`
    <div class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-[13px] text-amber-100" role="status" data-bridge-setup>
        <p class="font-semibold">The bridge is not set up here yet</p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">${lines.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
    </div>`;

const bridgePage = (data) => {
    last = data;
    const hubName = hubOf(data)?.name ?? "the hub";
    const count = otherChains(data).length;
    const head = pageHead("Bridge", `Move coins between ${escapeHtml(hubName)} and ${count === 1 ? escapeHtml(otherChains(data)[0].name) : `${count || "other"} chains`}`, `${AUTO_DELIVER ? "Send coins from one chain and they arrive on the other by itself, less the bridge fee: no claim, no gas on the other side." : "Lock coins on one chain, then claim the same amount on the other, less the bridge fee."} The bridge signer checks the source chain and signs your total. Every chain bridges with ${escapeHtml(hubName)}, and more chains join as they are added.`);
    const wrap = (body) => `<main class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><div class="mx-auto w-full max-w-[560px]">${head}${body}</div></main>`;
    if (!data.isReady) return wrap(setupNote(data.missing));
    const problems = otherChains(data).filter((c) => c.problem).map((c) => `${c.name}: ${c.problem}`);
    settle(data);
    if (!data.routes.length) return wrap(setupNote(problems.length ? problems : [ "No route is listed on both bridges yet (setRoute on BWSC and on the other chain)." ]));
    const r = routeOf(data);
    const side = source(r);
    const state = action(data);
    const paused = data.chains.filter((c) => c.paused).map((c) => c.short);
    return wrap(/*html*/`
            ${paused.length ? `<div class="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100" role="status">The bridge is paused on ${escapeHtml(paused.join(" and "))} by its owner. Your coins are safe; try again later.</div>` : ""}
            ${problems.length ? `<p class="mb-4 text-[12px] text-zinc-500" data-bridge-problems>Not available right now: ${escapeHtml(problems.join(" · "))}</p>` : ""}
            <div class="surface rounded-3xl p-3 sm:p-4" data-rise="2">
                <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    ${chainButton("from", data)}
                    <button type="button" onclick="bridgeFlip()" aria-label="Switch direction" data-bridge-flip class="grid size-9 place-items-center rounded-xl border border-white/10 bg-ink-800 text-zinc-300 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>
                    </button>
                    ${chainButton("to", data)}
                </div>
                ${form.note ? `<p class="mt-2 rounded-xl border border-brand-400/20 bg-brand-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-brand-100" role="status" data-bridge-note>${escapeHtml(form.note)}</p>` : ""}

                <div class="mt-2 rounded-2xl border border-white/[0.07] bg-ink-950/60 p-4 focus-within:border-brand-400/50">
                    <div class="flex items-center justify-between gap-3 text-[12px] text-zinc-500">
                        <span>You send</span>
                        <span class="whitespace-nowrap">On ${escapeHtml(fromChain(data).short)}: <span class="font-mono tabular-nums text-zinc-300" data-bridge-balance>${formNumber(side.balance, side.coin.decimals, 4)}</span>
                            <button type="button" onclick="bridgeMax()" class="-my-2 ml-1 inline-flex min-h-9 items-center rounded-md px-2.5 font-semibold text-brand-300 hover:bg-brand-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Max</button></span>
                    </div>
                    <div class="mt-2 flex items-center gap-3">
                        <input data-bridge-in oninput="bridgeInput(this.value)" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0" value="${escapeHtml(form.text)}"
                            aria-label="Amount to bridge" class="amount-input min-w-0 flex-1 bg-transparent font-mono text-[26px] tabular-nums text-white outline-none placeholder:text-zinc-600 sm:text-[30px]" />
                        <button type="button" onclick="bridgePick()" data-bridge-token class="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-2.5 hover:border-brand-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                            ${tokenBadge(side.coin)}<span class="text-[14px] font-semibold text-white">${escapeHtml(side.coin.symbol)}</span>
                            <svg viewBox="0 0 24 24" class="size-4 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                        </button>
                    </div>
                </div>

                <dl class="space-y-2 px-1.5 pt-4 text-[13px]" data-bridge-summary>${summary(data)}</dl>
                <button type="button" data-bridge-button onclick="${state.onclick ?? ""}" ${state.isDisabled ? "disabled" : ""}
                    class="btn-brand mt-4 w-full rounded-2xl px-5 py-3.5 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">${escapeHtml(state.label)}</button>
            </div>
            ${waitingSection(data)}
            ${routesSection(data)}
            ${totalsSection(data)}`);
};

/* ------------------------------------ form actions (wired in ui/main.js) */

const bridgeInput = (value) => { form.text = String(value ?? "").replace(/,/g, "."); paint(); };
const bridgeFlip = () => { form.out = !form.out; form.text = ""; form.note = ""; };
const bridgeReset = () => { form.text = ""; };
function bridgeMax() {
    if (!last?.isReady || !routeOf()) return;
    const { side, reserve } = evaluate();
    const max = side.balance - reserve;
    form.text = max > 0n ? fromUnits(max, side.coin.decimals) : "0";
}

/**
 * Sets one side to chain `key`. One side is always the hub: picking another chain for one side puts the hub on the
 * other side (with a note when that replaced a chain: two other chains do not bridge directly). Picking the chain
 * that is already on the other side swaps the two.
 */
function setChain(side, key) {
    const hub = hubOf();
    const from = fromChain();
    const to = toChain();
    const there = side === "from" ? to : from;
    form.text = "";
    form.note = "";
    if (key === there?.key) { form.out = !form.out; return; }
    if (key === hub.key) { form.out = side === "from"; return; }
    const replaced = side === "from" ? to : from;
    if (!replaced.isHub && replaced.key !== key) {
        form.note = `${chainBy(key).name} and ${replaced.name} do not bridge directly: every chain bridges with ${hub.name}. Bridge to ${hub.name} first, then from ${hub.name} to ${replaced.name}.`;
    }
    form.other = key;
    form.out = side === "to";
}

/** Opens the list of every chain for one side */
function bridgeChain(side, done = () => {}) {
    if (!last?.isReady) return;
    const current = side === "from" ? fromChain() : toChain();
    openPicker({
        title: side === "from" ? "From chain" : "To chain",
        placeholder: "Search chain",
        items: last.chains.map((c) => {
            const st = chainStatus(c);
            return { id: c.key, label: c.name, sub: `${st.text} · chain ${c.chainId}`, search: `${c.short} ${c.chainId}`, badge: chainBadge(c), right: c.key === current?.key ? "Selected" : "", isDisabled: !c.isHub && (Boolean(c.problem) || !routeCount(c.key)) };
        }),
        onPick: (key) => { setChain(side, key); settle(); done(); },
    });
}

/** Picks a route from the "Chains and coins" list: from the hub to that chain, unless the hub side is closed */
function bridgeUse(id) {
    const r = last?.routes.find((x) => x.id === id);
    if (!r) return;
    form.other = r.chain.key;
    form.route = id;
    form.out = r.hub.enabled || !r.remote.enabled;
    form.text = "";
    form.note = "";
}

function bridgePick(done = () => {}) {
    if (!last?.isReady) return;
    const from = fromChain();
    const to = toChain();
    openPicker({
        title: `Coin from ${from.short} to ${to.short}`,
        placeholder: "Search coin",
        items: routesOf().map((r) => ({ id: r.id, label: source(r).coin.symbol, sub: `${kindOf(source(r), from)}, arrives as ${dest(r).coin.symbol}, ${kindOf(dest(r), to)}`, search: `${source(r).address} ${dest(r).address}`, badge: tokenBadge(source(r).coin), right: formNumber(source(r).balance, source(r).coin.decimals, 4) })),
        onPick: (id) => { form.route = id; form.text = ""; done(); },
    });
}

function bridgeOrder() {
    if (!last?.isReady || !routeOf()) throw new Error("Still loading.");
    const { r, side, amount, error } = evaluate();
    if (error) throw new Error(error);
    return { route: r.id, direction: form.out ? "out" : "in", amount, symbol: side.coin.symbol, to: toChain().name };
}

export { bridgePage, bridgeInput, bridgeFlip, bridgeChain, bridgeUse, bridgePick, bridgeMax, bridgeOrder, bridgeReset, pageLoading as bridgeLoadingOf, pageError as bridgeError };
