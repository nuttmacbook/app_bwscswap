/*
 * YOUR CODE (on-chain). The chain coin's price for the header: from the exchange's BWSC / unit pair (settings/config.js
 * `prices.unit`, e.g. USDT), at the pool's current ratio. Never typed in: no pair or an empty pool = no price.
 *
 * One small read (BwscDex.getPair), shared by every page and made at most every 30 s (MAX_AGE_MS), so pages keep their
 * own single read; it shows in the read meter as "Price.getPair". A swap or deposit clears it (invalidateReads), so
 * the next page shows the new price.
 *
 *   coinPrice()             the last price: { value, decimals, unit, at } or null (no read)
 *   loadCoinPrice({ fresh }) reads it when older than MAX_AGE_MS (or `fresh`); resolves to the same shape or null
 */

import { box } from "../../engine/chain/connect";
import { metered } from "../../engine/chain/rpcMeter";
import { cachedRead } from "../../engine/chain/cache";
import { config, ZERO } from "../../engine/settings";
import { DexProgram } from "./programs";
import { HUB, listedTokens } from "./coins";

const MAX_AGE_MS = 30_000;
const lower = (a) => String(a ?? "").toLowerCase();
const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };

let last = null;          // { value, decimals, unit, at }

/** The unit token on the hub (by symbol, from prices.unit), or null until its address is set */
const unitToken = () => listedTokens(HUB).find((t) => t.symbol === String(config.prices?.unit ?? "")) ?? null;

const coinPrice = () => last;

/** The pair → unit's smallest units per 1 whole coin (the chain coin has 18 decimals), or null for an empty pool */
function priceFrom(pair, unit) {
    if (!pair) return null;
    const unitIsA = lower(pair.tokenA) === lower(unit.address);
    const coinReserve = big(unitIsA ? pair.reserveB : pair.reserveA);
    const unitReserve = big(unitIsA ? pair.reserveA : pair.reserveB);
    if (coinReserve <= 0n || unitReserve <= 0n) return null;
    return { value: (unitReserve * 10n ** 18n) / coinReserve, decimals: Number(unit.decimals ?? 18), unit: unit.symbol, at: Date.now() };
}

/** Reads the pair (cached 30 s; a swap or deposit clears it). A failed read keeps the last price: the header never errors */
async function loadCoinPrice({ fresh = false } = {}) {
    const unit = unitToken();
    if (DexProgram.address === ZERO || !unit?.address) return null;
    try {
        const pair = await cachedRead(`price:${lower(unit.address)}`, () => metered(box.createReader(DexProgram), "Price").methods.getPair({ tokenA: ZERO, tokenB: unit.address }).call(), { ttl: MAX_AGE_MS, fresh });
        last = priceFrom(pair, unit);
    } catch { /* keep the last price */ }
    return last;
}

export { coinPrice, loadCoinPrice, MAX_AGE_MS };
