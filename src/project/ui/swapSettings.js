/*
 * YOUR CODE (off-chain). The visitor's own trade settings: max slippage and transaction deadline.
 * Used by the swap page and the pool page (deposits and withdrawals). Remembered in this browser only
 * (a convenience: when the browser keeps nothing, the settings/config.js defaults are used).
 */

import { DEFAULT_SLIPPAGE_BPS, DEFAULT_DEADLINE_MINUTES, MIN_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, MIN_DEADLINE_MINUTES, MAX_DEADLINE_MINUTES } from "./options";

const KEY = "bwsc.tradeSettings";

const clampSlippage = (bps) => Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(Number(bps))));
const clampDeadline = (min) => Math.min(MAX_DEADLINE_MINUTES, Math.max(MIN_DEADLINE_MINUTES, Math.round(Number(min))));

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
        return {
            slippageBps: Number.isFinite(saved?.slippageBps) ? clampSlippage(saved.slippageBps) : DEFAULT_SLIPPAGE_BPS,
            deadlineMinutes: Number.isFinite(saved?.deadlineMinutes) ? clampDeadline(saved.deadlineMinutes) : DEFAULT_DEADLINE_MINUTES,
        };
    } catch {
        return { slippageBps: DEFAULT_SLIPPAGE_BPS, deadlineMinutes: DEFAULT_DEADLINE_MINUTES };
    }
}

let current = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* the browser keeps nothing: fine */ } };

/** { slippageBps, deadlineMinutes } */
const tradeSettings = () => ({ ...current });

/** Sets the slippage in basis points (clamped to 0.01% … 50%) */
function setSlippage(bps) {
    if (!Number.isFinite(Number(bps))) return tradeSettings();
    current = { ...current, slippageBps: clampSlippage(bps) };
    save();
    return tradeSettings();
}

/** Sets the deadline in minutes (clamped to 1 minute … 3 days) */
function setDeadline(minutes) {
    if (!Number.isFinite(Number(minutes))) return tradeSettings();
    current = { ...current, deadlineMinutes: clampDeadline(minutes) };
    save();
    return tradeSettings();
}

/** A plain warning for a slippage choice, or "" */
function slippageWarning(bps) {
    if (bps < 5) return "Very low: the swap may fail if the price moves at all.";
    if (bps > 500) return "High: you may get a much worse price (others can trade ahead of you).";
    return "";
}

export { tradeSettings, setSlippage, setDeadline, slippageWarning };
