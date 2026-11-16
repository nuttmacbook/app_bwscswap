/*
 * YOUR CODE (on-chain). Prices, read from the exchange's pools at this moment: never typed in anywhere.
 * A coin's price = what 1 whole coin is worth in the unit token (settings/config.js `prices.unit`, a stablecoin on the
 * hub) at the pools' current mid-price, along the best route (up to swap.maxHops pairs). No route = no price (null),
 * and the pages show "—". The native coin is priced as its wrapped token.
 */

import { config, addProblem, ZERO } from "../../engine/settings";
import { HUB, listedTokens } from "./coins";
import { bestRoute } from "./dex";

const lower = (a) => String(a ?? "").toLowerCase();
const UNIT_SYMBOL = String(config.prices?.unit ?? "");
if (!UNIT_SYMBOL) addProblem("settings/config.js: prices.unit must name the token prices are counted in (e.g. \"USDT\").");

/** The unit token's listed entry on the hub (by symbol), or null until its address is set */
const unitListed = () => listedTokens(HUB).find((t) => t.symbol === UNIT_SYMBOL) ?? null;

/**
 * Prices from one read of the exchange (getDexData's result).
 * @returns {{ unit: { address, symbol, decimals } | null, of: (address) => bigint | null }}
 *          of() gives the unit's smallest units per 1 whole coin (USDT with 18 decimals: 0.85 → 850000000000000000n)
 */
function priceBook(dexData) {
    const listed = unitListed();
    const unit = listed && dexData?.isReady ? dexData.tokens.find((t) => t.address === lower(listed.address)) ?? null : null;
    const cache = new Map();
    const of = (address) => {
        if (!unit) return null;
        const a = lower(address) === ZERO ? dexData.wrapped : lower(address);
        if (a === unit.address) return 10n ** BigInt(unit.decimals);
        if (cache.has(a)) return cache.get(a);
        const coin = dexData.tokens.find((t) => t.address === a);
        let price = null;
        if (coin) {
            const route = bestRoute(dexData, a, unit.address, 10n ** BigInt(coin.decimals));
            price = route.kind === "swap" && route.mid > 0n ? route.mid : null;
        }
        cache.set(a, price);
        return price;
    };
    return { unit: unit ? { address: unit.address, symbol: unit.symbol, decimals: unit.decimals } : null, of };
}

/** The same coin for prices? (the native coin and its wrapped token count as one) */
const sameCoin = (dexData, a, b) => {
    const k = (x) => (lower(x) === ZERO ? lower(dexData?.wrapped) : lower(x));
    return k(a) === k(b);
};

export { priceBook, sameCoin };
