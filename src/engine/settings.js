/*
 * ENGINE. The website's settings: settings/config.js, the one settings file. The code has no fallback values:
 * when something required is missing or wrong, `problems` says what, and the page shows it instead of running.
 * Addresses that are still empty are fine (not deployed yet): the page that needs one says so.
 *
 * VITE_CONFIG (JSON, merged over the file) is set only by deploy-kit's local test chain; never set it yourself.
 */

import fromFile from "../../settings/config.js";

/** Objects merge key by key; anything else (lists too) is replaced */
function merge(base, over) {
    if (over === null || over === undefined) return base;
    if (typeof over !== "object" || Array.isArray(over)) return over;
    const out = { ...(base ?? {}) };
    for (const [ k, v ] of Object.entries(over)) out[k] = base && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    return out;
}

const fromTestChain = () => {
    try { return import.meta.env.VITE_CONFIG ? JSON.parse(import.meta.env.VITE_CONFIG) : null; } catch { return null; }
};

const config = merge(fromFile ?? {}, fromTestChain());
const problems = [];
/** Adds a problem found later (e.g. a coin listed twice) */
const addProblem = (text) => problems.push(text);

const trim = (url) => String(url ?? "").replace(/\/+$/, "");
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));
const ZERO = "0x0000000000000000000000000000000000000000";

/* ------------------------------------ checks */

const hub = config.hub ?? {};
const app = config.app ?? {};
if (!app.name) addProblem("settings/config.js: app.name is empty.");
if (!/^https?:\/\//.test(String(hub.nodeUrl ?? ""))) addProblem("settings/config.js: hub.nodeUrl must start with https:// (or http:// for a node on this computer).");
if (!Number.isInteger(hub.chainId) || hub.chainId <= 0) addProblem("settings/config.js: hub.chainId must be the chain id (a whole number).");
if (!hub.native?.symbol) addProblem("settings/config.js: hub.native.symbol is empty.");
// Wallets connect only through Reown (deploy-kit's local test chain uses its own stand-in wallet instead)
if (import.meta.env.VITE_NETWORK !== "local" && !/^[0-9a-f]{32}$/i.test(String(config.wallet?.reownProjectId ?? ""))) {
    addProblem("settings/config.js: wallet.reownProjectId must be your Reown project ID (32 characters, free at https://dashboard.reown.com).");
}

/** Every address field: empty = not deployed yet; anything else must be an address */
const checkAddress = (where, value) => {
    if (value !== "" && value !== undefined && !isAddress(value)) addProblem(`settings/config.js: ${where} is ${JSON.stringify(value)}, which is not an address (0x + 40 hex characters).`);
};
for (const [ k, v ] of Object.entries(config.programs ?? {})) checkAddress(`programs.${k}`, v);
const chainKeys = new Set([ hub.key ]);
for (const c of config.chains ?? []) {
    if (!c.key || chainKeys.has(c.key)) addProblem(`settings/config.js: every chain needs its own key (${JSON.stringify(c.key)}).`);
    chainKeys.add(c.key);
    if (!Number.isInteger(c.chainId) || c.chainId <= 0) addProblem(`settings/config.js: chains (${c.key}).chainId must be a whole number.`);
    checkAddress(`chains (${c.key}).bridge`, c.bridge);
}
for (const t of config.tokens ?? []) {
    if (!chainKeys.has(t.chain)) addProblem(`settings/config.js: token ${t.symbol} is on chain "${t.chain}", which is not hub.key or a chains key.`);
    checkAddress(`tokens (${t.symbol} on ${t.chain}).address`, t.address);
    if (t.logo !== undefined && !/^(\/|https:\/\/)\S+$/.test(String(t.logo))) addProblem(`settings/config.js: tokens (${t.symbol}).logo must be a path in public/ ("/coins/x.svg") or an https:// link.`);
    if (t.priceUsd !== undefined) addProblem(`settings/config.js: tokens (${t.symbol}).priceUsd is no longer used: prices come from the pools. Remove it.`);
}

/** The website is English only: any Thai text in the settings (names, descriptions, apps…) is reported */
const THAI = /[\u0E00-\u0E7F]/;
const findThai = (value, path) => {
    if (typeof value === "string") { if (THAI.test(value)) addProblem(`settings/config.js: ${path} has Thai text. The website is English only: write it in English.`); return; }
    if (Array.isArray(value)) value.forEach((v, i) => findThai(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [ k, v ] of Object.entries(value)) findThai(v, path ? `${path}.${k}` : k);
};
findThai(config, "");

/* ------------------------------------ what the engine uses */

const settings = {
    nodeUrl: trim(hub.nodeUrl),
    // Keeps wallet sessions of different chains apart
    network: `${hub.key ?? "hub"}-${hub.chainId}`,
    chainId: hub.chainId,
    explorerUrl: trim(hub.explorerUrl),
    appName: app.name ?? "",
    tagline: app.tagline ?? "",
    description: app.description ?? "",
    siteUrl: trim(app.siteUrl),
    // Only while deploy-kit/ runs its local test chain (set by deploy-kit/engine/start.mjs)
    isLocal: import.meta.env.VITE_NETWORK === "local",
};

/** An address from settings in lower case, or the zero address when it is empty */
const addressOrZero = (value) => (isAddress(value) ? String(value).toLowerCase() : ZERO);

export { config, settings, problems, addProblem, addressOrZero, isAddress, ZERO };
