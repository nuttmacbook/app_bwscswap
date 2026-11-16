/*
 * YOUR CODE (off-chain). Choices the pages offer, from settings/config.js `swap`.
 */

import { config, addProblem } from "../../engine/settings";

const MIN_SLIPPAGE_BPS = 1;        // 0.01%
const MAX_SLIPPAGE_BPS = 5000;     // 50%
const MIN_DEADLINE_MINUTES = 1;
const MAX_DEADLINE_MINUTES = 4320; // 3 days

const DEFAULT_SLIPPAGE_BPS = Number(config.swap?.slippageBps);
if (!(DEFAULT_SLIPPAGE_BPS >= MIN_SLIPPAGE_BPS && DEFAULT_SLIPPAGE_BPS <= MAX_SLIPPAGE_BPS)) addProblem("settings/config.js: swap.slippageBps must be between 1 and 5000 (50 = 0.5%).");

const SLIPPAGE_CHOICES = (config.swap?.slippageChoices ?? []).map(Number).filter((x) => x >= MIN_SLIPPAGE_BPS && x <= MAX_SLIPPAGE_BPS);
if (!SLIPPAGE_CHOICES.length) addProblem("settings/config.js: swap.slippageChoices must list at least one value (in basis points).");

const DEFAULT_DEADLINE_MINUTES = Number(config.swap?.deadlineMinutes ?? 20);
if (!(Number.isInteger(DEFAULT_DEADLINE_MINUTES) && DEFAULT_DEADLINE_MINUTES >= MIN_DEADLINE_MINUTES && DEFAULT_DEADLINE_MINUTES <= MAX_DEADLINE_MINUTES)) {
    addProblem("settings/config.js: swap.deadlineMinutes must be a whole number of minutes from 1 to 4320.");
}

export { DEFAULT_SLIPPAGE_BPS, SLIPPAGE_CHOICES, DEFAULT_DEADLINE_MINUTES, MIN_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, MIN_DEADLINE_MINUTES, MAX_DEADLINE_MINUTES };
