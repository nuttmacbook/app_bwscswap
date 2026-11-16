/*
 * YOUR CODE (off-chain). Coins as the pages show them. The chain knows each token's ticker and decimals; settings/config.js
 * `tokens` adds a friendly name and the order in lists (prices come from the pools: chain/prices.js). The chain's own coin comes
 * from `hub.native` (address 0x0…0 everywhere in this app), other chains' coins from `chains[].native`.
 */

import { config, addProblem, isAddress, ZERO } from "../../engine/settings";

const HUB = config.hub?.key ?? "bwsc";
const lower = (a) => String(a ?? "").toLowerCase();

const LISTED = (config.tokens ?? []).map((t, index) => ({
    chain: t.chain,
    address: lower(t.address),
    symbol: String(t.symbol ?? ""),
    name: String(t.name ?? t.symbol ?? ""),
    wrapsNative: t.wraps === "native",
    order: index,
}));
{
    const seen = new Set();
    for (const t of LISTED) {
        if (!t.address) continue;
        const k = `${t.chain}:${t.address}`;
        if (seen.has(k)) addProblem(`settings/config.js: ${t.symbol} on ${t.chain} is listed twice.`);
        seen.add(k);
    }
}

/** The native coin of a chain ("bwsc" = the hub), as a coin */
function nativeCoin(chain = HUB) {
    const n = chain === HUB ? config.hub?.native : (config.chains ?? []).find((c) => c.key === chain)?.native;
    return { chain, address: ZERO, symbol: n?.symbol ?? "", name: n?.name ?? n?.symbol ?? "", decimals: Number(n?.decimals ?? 18), isNative: true, isListed: true, order: -1 };
}

/** The listed entry for a coin on a chain, or null */
const listedCoin = (chain, address) => (lower(address) === ZERO ? nativeCoin(chain) : LISTED.find((t) => t.chain === chain && t.address === lower(address)) ?? null);

/**
 * A coin as pages show it: what the chain says (symbol, decimals, balances …) plus the listed name and price.
 * @param {string} chain   "bwsc" or a chain key
 * @param {object} raw     at least { address }, usually { address, symbol, name, decimals, balance, allowance }
 */
function coinOf(chain, raw) {
    const address = lower(raw?.address);
    const known = listedCoin(chain, address);
    return {
        ...raw,
        chain,
        address,
        symbol: known?.symbol || String(raw?.symbol ?? "") || `${address.slice(0, 6)}…`,
        name: known?.name || String(raw?.name ?? "") || String(raw?.symbol ?? ""),
        decimals: Number(raw?.decimals ?? known?.decimals ?? 18),
        isNative: address === ZERO,
        isListed: Boolean(known),
        wrapsNative: Boolean(known?.wrapsNative),
        order: known?.order ?? 1_000,
    };
}

/** Listed first (in settings order), then the rest by symbol */
const byListOrder = (a, b) => a.order - b.order || a.symbol.localeCompare(b.symbol);

/** Listed tokens of a chain with an address (for pickers: "create a pair", "create a pool") */
const listedTokens = (chain = HUB) => LISTED.filter((t) => t.chain === chain && isAddress(t.address));

/** The chains the site knows: the hub first */
const CHAINS = [
    { key: HUB, name: config.hub?.name ?? HUB, chainId: config.hub?.chainId, isHub: true, explorerUrl: String(config.hub?.explorerUrl ?? "").replace(/\/+$/, ""), short: String(config.hub?.short ?? HUB).toUpperCase(), native: config.hub?.native },
    // short: a few letters for small screens (optional, the key in capitals otherwise)
    ...(config.chains ?? []).map((c) => ({ key: c.key, name: c.name ?? c.key, chainId: c.chainId, isHub: false, rpcUrl: c.rpcUrl, bridge: lower(c.bridge), explorerUrl: String(c.explorerUrl ?? "").replace(/\/+$/, ""), short: String(c.short ?? c.key).toUpperCase(), native: c.native, confirmations: c.confirmations ?? "finalized" })),
];
const chainOf = (key) => CHAINS.find((c) => c.key === key) ?? null;
const chainById = (id) => CHAINS.find((c) => Number(c.chainId) === Number(id)) ?? null;

export { HUB, CHAINS, chainOf, chainById, coinOf, nativeCoin, listedCoin, listedTokens, byListOrder };
