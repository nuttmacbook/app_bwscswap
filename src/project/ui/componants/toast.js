import { txUrl, isUserReject, escapeHtml as escape } from "../../../engine/ui/helpers";
import { icon as line } from "../icons";

/*
 * YOUR CODE (off-chain, restyle freely). Transaction toasts. Lives in its own #toast element, so a page repaint never removes it.
 * The wrapper ignores pointer events so it never covers buttons underneath; only the card takes clicks.
 *
 * What it shows:
 *   pending  spinner, the step tracker (Approve → Confirm), where we are waiting (your wallet or the chain), seconds so far
 *   success  check mark, the transaction hash with copy and explorer buttons, a bar that counts down to closing (pauses on hover)
 *   error    the reason in plain words; "Cancelled" when the wallet prompt was closed
 */

/** where: "wallet" = waiting for the person to confirm, "chain" = sent, waiting for the block */
const STAGES = {
    checking:  { title: "Checking", desc: "Reading the latest numbers.", where: "app" },
    preview:   { title: "Preview", desc: "Simulating the transaction. Nothing is signed or sent to the chain.", where: "app" },
    approve:   { title: "Approve the amount", desc: "Confirm in your wallet. It allows exactly this amount to be taken, nothing more.", where: "wallet" },
    approving: { title: "Approving", desc: "Approval sent. Waiting for the next block.", where: "chain" },
    wrap:      { title: "Confirm wrap", desc: "Confirm in your wallet: the coin becomes the same amount of its wrapped token.", where: "wallet" },
    wrapping:  { title: "Wrapping", desc: "Sent. Waiting for the next block.", where: "chain" },
    unwrap:    { title: "Confirm unwrap", desc: "Confirm in your wallet: the wrapped token becomes the same amount of the coin.", where: "wallet" },
    unwrapping:{ title: "Unwrapping", desc: "Sent. Waiting for the next block.", where: "chain" },
    create:    { title: "Confirm new pair", desc: "Confirm in your wallet to create the pair.", where: "wallet" },
    creating:  { title: "Creating the pair", desc: "Sent. Waiting for the next block.", where: "chain" },
    pool:      { title: "Confirm new pool", desc: "Confirm in your wallet to create the stake pool.", where: "wallet" },
    pooling:   { title: "Creating the pool", desc: "Sent. Waiting for the next block.", where: "chain" },
    swap:      { title: "Confirm swap", desc: "Check the amounts in your wallet and confirm.", where: "wallet" },
    swapping:  { title: "Swapping", desc: "Swap sent. Waiting for the next block.", where: "chain" },
    add:       { title: "Confirm deposit", desc: "Confirm adding liquidity in your wallet.", where: "wallet" },
    adding:    { title: "Adding liquidity", desc: "Sent. Waiting for the next block.", where: "chain" },
    remove:    { title: "Confirm withdrawal", desc: "Confirm taking your liquidity out in your wallet.", where: "wallet" },
    removing:  { title: "Taking liquidity out", desc: "Sent. Waiting for the next block.", where: "chain" },
    bridge:    { title: "Confirm bridge", desc: "Confirm in your wallet. The coins are locked in the bridge.", where: "wallet" },
    bridging:  { title: "Bridging", desc: "Sent. Waiting for the block.", where: "chain" },
    signature: { title: "Getting the signature", desc: "The bridge signer checks your total on the other chain.", where: "app" },
    claim:     { title: "Confirm claim", desc: "Confirm in your wallet to receive the coins.", where: "wallet" },
    claiming:  { title: "Claiming", desc: "Sent. Waiting for the block.", where: "chain" },
    stake:     { title: "Confirm stake", desc: "Confirm in your wallet to stake.", where: "wallet" },
    staking:   { title: "Staking", desc: "Sent. Waiting for the block.", where: "chain" },
    unstake:   { title: "Confirm take out", desc: "Confirm in your wallet to take your stake out.", where: "wallet" },
    unstaking: { title: "Taking out", desc: "Sent. Waiting for the block.", where: "chain" },
    reward:    { title: "Confirm reward", desc: "Confirm in your wallet. This reward is streamed to stakers and cannot be taken back.", where: "wallet" },
    rewarding: { title: "Adding reward", desc: "Sent. Waiting for the block.", where: "chain" },
    place:     { title: "Confirm order", desc: "Confirm in your wallet. Your coins wait in the limit-order program until the order is filled or you cancel it.", where: "wallet" },
    placing:   { title: "Placing the order", desc: "Sent. Waiting for the block.", where: "chain" },
    fill:      { title: "Confirm buy", desc: "Confirm in your wallet: you pay the order's price and receive its coins in the same transaction.", where: "wallet" },
    filling:   { title: "Buying", desc: "Sent. Waiting for the block.", where: "chain" },
    cancel:    { title: "Confirm cancel", desc: "Confirm in your wallet. What was not sold comes back to you.", where: "wallet" },
    cancelling:{ title: "Cancelling", desc: "Sent. Waiting for the block.", where: "chain" },
    coin:      { title: "Confirm change", desc: "Confirm the owner change in your wallet.", where: "wallet" },
    saving:    { title: "Saving", desc: "Sent. Waiting for the block.", where: "chain" },
};

const WHERE = {
    app: "Preparing",
    wallet: "Waiting for your wallet",
    chain: "Confirming on chain",
};

const TONES = {
    pending: { edge: "border-white/10", glow: "from-brand-300/0 via-brand-300/70 to-mint-400/0", bar: "bg-brand-300" },
    success: { edge: "border-mint-400/40", glow: "from-mint-400/0 via-mint-400/80 to-mint-400/0", bar: "bg-mint-400" },
    error: { edge: "border-rose-400/50", glow: "from-rose-400/0 via-rose-400/70 to-rose-400/0", bar: "bg-rose-400" },
};

const CLOSE_AFTER = 7000;

let closeTimer;
let tickTimer;
let flowStart = 0;
let remaining = CLOSE_AFTER;
let closeAt = 0;

const root = () => {
    let el = document.getElementById("toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "toast";
        el.className = "pointer-events-none fixed inset-x-0 bottom-16 z-50 md:bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:p-6";
        el.setAttribute("aria-live", "polite");
        document.body.appendChild(el);
    }
    return el;
};

/* ------------------------------------ pieces */

const icon = (tone) => {
    if (tone === "pending") return /*html*/`
        <span class="toast-spinner relative grid size-10 shrink-0 place-items-center rounded-full" aria-hidden="true">
            <span class="size-2 rounded-full bg-brand-300 shadow-[0_0_10px] shadow-brand-300"></span>
        </span>`;
    if (tone === "success") return /*html*/`
        <span class="toast-pop relative grid size-10 shrink-0 place-items-center rounded-full bg-mint-400/15 ring-1 ring-mint-400/50" aria-hidden="true">
            <span class="absolute inset-0 animate-ping rounded-full bg-mint-400/20 [animation-iteration-count:2] motion-reduce:animate-none"></span>
            <svg viewBox="0 0 24 24" class="toast-check size-5 text-mint-300" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7" pathLength="1" /></svg>
        </span>`;
    return /*html*/`
        <span class="toast-pop grid size-10 shrink-0 place-items-center rounded-full bg-rose-400/12 ring-1 ring-rose-400/45" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="size-5 text-rose-300" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6" /><path d="M12 17h.01" /></svg>
        </span>`;
};

/** Approve → Confirm, each done / now / next */
const tracker = (index, total) => {
    if (total < 2) return "";
    const labels = total > 2 ? [ "Approve", "Approve", "Confirm" ] : [ "Approve", "Confirm" ];
    return /*html*/`
        <ol class="mt-3 flex items-center gap-2 text-[11px]">
            ${labels.map((label, i) => {
                const n = i + 1;
                const state = n < index ? "done" : n === index ? "now" : "next";
                const dot = {
                    done: `<span class="grid size-4 place-items-center rounded-full bg-mint-400 text-ink-950">${line("check", "size-3")}</span>`,
                    now: `<span class="grid size-4 place-items-center rounded-full border border-brand-300 text-[9px] font-bold text-brand-200 shadow-[0_0_10px_-2px] shadow-brand-300">${n}</span>`,
                    next: `<span class="grid size-4 place-items-center rounded-full border border-white/10 text-[9px] font-bold text-zinc-500">${n}</span>`,
                }[state];
                const text = { done: "text-mint-300", now: "text-white", next: "text-zinc-500" }[state];
                return /*html*/`
                    <li class="flex items-center gap-1.5 ${text}">${dot}<span class="font-medium">${label}</span></li>
                    ${n < labels.length ? `<li class="h-px flex-1 ${n < index ? "bg-mint-400/60" : "bg-zinc-700"}" aria-hidden="true"></li>` : ""}
                `;
            }).join("")}
        </ol>
    `;
};

const shortHash = (hash) => `${hash.slice(0, 10)}…${hash.slice(-8)}`;

const hashRow = (hash, explorerUrl = null) => {
    if (!hash) return "";
    const link = explorerUrl ?? txUrl(hash);
    return /*html*/`
        <div class="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 py-1.5 pl-3 pr-1.5">
            <span class="text-[11px] text-zinc-500">Tx</span>
            <span class="figure min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-300">${escape(shortHash(hash))}</span>
            <button type="button" onclick="copyToastHash('${escape(hash)}', this)" class="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400">Copy</button>
            ${link ? /*html*/`<a href="${link}" target="_blank" rel="noopener" class="rounded-lg bg-mint-400/10 px-2 py-1 text-[11px] font-semibold text-mint-300 hover:bg-mint-400/20 hover:text-mint-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 inline-flex items-center gap-1">Explorer${line("external", "size-3")}</a>` : ""}
        </div>
    `;
};

/* ------------------------------------ render */

const stopTimers = () => {
    clearTimeout(closeTimer);
    clearInterval(tickTimer);
};

const close = () => {
    stopTimers();
    const card = root().firstElementChild;
    if (!card) return;
    card.classList.add("toast-out");
    setTimeout(() => { if (card.isConnected) card.remove(); }, 220);
};

const scheduleClose = (ms) => {
    clearTimeout(closeTimer);
    remaining = ms;
    closeAt = Date.now() + ms;
    closeTimer = setTimeout(close, ms);
};

const show = ({ tone, title, desc, step = null, where = "", hash = "", explorerUrl = null, isSticky = false }) => {
    stopTimers();
    const look = TONES[tone] ?? TONES.pending;
    const isNew = !root().firstElementChild;
    root().innerHTML = /*html*/`
        <div class="toast-card ${isNew ? "toast-in" : ""} pointer-events-auto relative w-full max-w-[400px] overflow-hidden rounded-2xl border ${look.edge} bg-ink-900/95 shadow-[0_30px_70px_-24px_rgb(0_0_0/0.95)] backdrop-blur-xl"
            role="${tone === "error" ? "alert" : "status"}" onmouseenter="holdToast(true)" onmouseleave="holdToast(false)">
            <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r ${look.glow}" aria-hidden="true"></div>
            <div class="pointer-events-none absolute -top-16 left-1/2 h-24 w-56 -tranzinc-x-1/2 rounded-full bg-gradient-to-r ${look.glow} opacity-20 blur-2xl" aria-hidden="true"></div>
            <div class="relative flex items-start gap-3.5 p-4">
                ${icon(tone)}
                <div class="min-w-0 flex-1 pt-0.5">
                    <div class="flex items-center gap-2">
                        <p class="min-w-0 flex-1 truncate text-[14px] font-semibold text-white">${escape(title)}</p>
                        ${step ? /*html*/`<span class="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-300">Step ${step.index} of ${step.total}</span>` : ""}
                    </div>
                    <p class="mt-1 break-words text-[13px] leading-relaxed text-zinc-300">${escape(desc)}</p>
                    ${step ? tracker(step.index, step.total) : ""}
                    ${tone === "pending" && where ? /*html*/`
                        <p class="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                            <span class="relative flex size-1.5"><span class="absolute inline-flex size-full animate-ping rounded-full bg-brand-300/70 motion-reduce:animate-none"></span><span class="relative inline-flex size-1.5 rounded-full bg-brand-300"></span></span>
                            <span>${escape(WHERE[where] ?? where)}</span>
                            <span class="figure ml-auto" data-toast-clock>${Math.max(0, Math.round((Date.now() - flowStart) / 1000))}s</span>
                        </p>` : ""}
                    ${hashRow(hash, explorerUrl)}
                </div>
                <button type="button" onclick="closeToast()" class="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400" aria-label="Close">
                    <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
            </div>
            ${isSticky ? "" : /*html*/`<div class="h-0.5 bg-white/[0.04]"><div class="toast-countdown h-full ${look.bar}" style="animation-duration:${CLOSE_AFTER}ms"></div></div>`}
        </div>
    `;

    if (tone === "pending") {
        tickTimer = setInterval(() => {
            const clock = root().querySelector("[data-toast-clock]");
            if (clock) clock.textContent = `${Math.round((Date.now() - flowStart) / 1000)}s`;
        }, 1000);
    }
    if (!isSticky) scheduleClose(CLOSE_AFTER);
};

/* ------------------------------------ api (same as before: pending / progress / success / error) */

const notify = {
    /** Step of a transaction: { stage, index, total } */
    pending: ({ stage, index = 0, total = 0 } = {}) => {
        if (stage === "checking" || !flowStart) flowStart = Date.now();
        const s = STAGES[stage] ?? STAGES.checking;
        show({ tone: "pending", ...s, step: index && total > 1 ? { index, total } : null, isSticky: true });
    },
    /** Free-form progress, used by the test panel */
    progress: ({ title, desc } = {}) => {
        if (!root().firstElementChild) flowStart = Date.now();
        show({ tone: "pending", title, desc, where: "app", isSticky: true });
    },
    success: ({ title = "Done", desc = "The transaction is confirmed.", hash, explorerUrl = null } = {}) => {
        const seconds = flowStart ? Math.round((Date.now() - flowStart) / 1000) : 0;
        flowStart = 0;
        show({ tone: "success", title, desc: hash && seconds ? `${desc} Confirmed in ${seconds}s.` : desc, hash: hash ?? "", explorerUrl });
    },
    error: (error) => {
        flowStart = 0;
        const isReject = isUserReject(error);
        show({
            tone: "error",
            title: isReject ? "Cancelled" : "Something went wrong",
            desc: isReject ? "You closed the wallet prompt. Nothing was sent." : error?.message ?? "Please try again.",
        });
    },
};

if (typeof window !== "undefined") {
    window.closeToast = close;

    /** Hovering the card pauses the countdown; leaving it resumes with the time that was left */
    window.holdToast = (isHeld) => {
        const bar = root().querySelector(".toast-countdown");
        if (!bar) return;
        if (isHeld) {
            clearTimeout(closeTimer);
            remaining = Math.max(800, closeAt - Date.now());
            bar.style.animationPlayState = "paused";
        } else {
            bar.style.animationPlayState = "running";
            scheduleClose(remaining);
        }
    };

    window.copyToastHash = async (hash, button) => {
        try {
            await navigator.clipboard.writeText(hash);
            if (button) button.textContent = "Copied";
        } catch {
            if (button) button.textContent = "Select";
        }
    };
}

export { notify };
