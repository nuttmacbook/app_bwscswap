/*
 * YOUR CODE (off-chain). The app directory: every app and utility of the chain in one list, for the Apps page, each
 * app's own page, the home page and the search box in the header.
 *
 *   Built in (this website): Swap, Limit orders, Pool, Bridge, Stake (+ the explorer). Always listed, badge Core.
 *   Everything else: settings/config.js `directory.apps` (games, other projects, tools…), no code change needed.
 *
 * An app (settings/config.js directory.apps):
 *   id, name, category, description (one line for the card), url ("https://…", "#/page", or "" = coming soon)
 *   logo, cover        pictures: "https://…" or a file in public/ ("/apps/x.png"); logo square, cover about 3:1
 *   about              the full text for the app's page (blank line = new paragraph; plain text)
 *   screenshots        pictures for the app's page
 *   developer          who made it · links: { website, docs, x, telegram, discord, github }
 *   programs           [{ label, address }] its programs on this chain (linked to the explorer)
 *   core               true = made by the chain team (badge Core)
 *   audit              { by, url, date } = audited (badge Audited; the page links the report)
 *   risk               "low" | "medium" | "high" (badge; the page says what it means)
 *   tags, addedAt ("2026-11-15": badge New for 30 days), status ("beta"), featured
 */

import { config, settings, addProblem } from "../../engine/settings";

const NEW_DAYS = 30;
const lower = (a) => String(a ?? "").toLowerCase();

/** The chain's own utilities (pages of this site) */
const BUILT_IN = [
    { id: "swap", name: "Swap", category: "defi", url: "#/swap", icon: "swap", program: "dex", tags: [ "trade", "exchange", "dex" ],
        description: "Trade any two coins at the pools' price through the best route.",
        about: "Swap any two coins on the chain. The exchange looks through every pool for the route that gives you the most, up to three pools long, and shows the price impact before you sign.\n\nYou set the slippage and a deadline once; every swap uses them. The native coin works directly: the pools hold its wrapped token for you." },
    { id: "limit", name: "Limit orders", category: "defi", url: "#/limit", icon: "limit", program: "limit", tags: [ "trade", "order", "p2p" ],
        description: "Put up one coin for another at your price, or buy from other people's orders.",
        about: "Name your price: put up one coin and ask for another. Your coins wait in the program until someone buys or you cancel, and you can always cancel.\n\nBuyers see every order sorted best rate first and can buy part of an order when the seller allows it. Each coin has its own small fee, taken from what the buyer receives." },
    { id: "pool", name: "Pool", category: "defi", url: "#/pool", icon: "pool", program: "dex", tags: [ "liquidity", "lp", "earn" ],
        description: "Add liquidity to a pair and earn a share of every swap's fee.",
        about: "Put two coins into a pair and earn your share of the fee on every swap through it. Your share of the pool is yours to take out at any time." },
    { id: "bridge", name: "Bridge", category: "defi", url: "#/bridge", icon: "bridge", program: "bridge", tags: [ "bsc", "cross-chain", "transfer" ],
        description: "Move coins between this chain and others; they arrive by themselves.",
        about: "Move coins between Bluewolfchain and the other chains it is connected to. Send from one side and the coins arrive on the other by themselves: no claim, no gas on the other side.\n\nTotals are kept on both sides, so anyone can check that every coin out matches a coin in." },
    { id: "stake", name: "Stake", category: "defi", url: "#/stake", icon: "stake", program: "staking", tags: [ "earn", "reward", "apr" ],
        description: "Stake coins in a pool and earn rewards paid every second.",
        about: "Stake a coin in a pool and earn its reward every second, shared by stake size. Rewards added to a pool can never be taken back by anyone, and you can take your stake out at any time." },
    ...(settings.explorerUrl ? [ { id: "explorer", name: "Explorer", category: "tools", url: settings.explorerUrl, icon: "explorer", tags: [ "blocks", "transactions", "deploy" ],
        description: "Every block, transaction and program on the chain. Deploy programs here.",
        about: "Look up any block, transaction, address or program. Programs are plain JavaScript you can read right there, and new programs are deployed from the explorer too." } ] : []),
].map((a) => ({
    ...a, core: true, status: "live", featured: true, developer: settings.appName, links: {}, screenshots: [], logo: "", cover: "", risk: "", audit: null, addedAt: "",
    programs: a.program && config.programs?.[a.program] ? [ { label: a.name, address: lower(config.programs[a.program]) } ] : [],
}));

const DEFAULT_CATEGORIES = [ { id: "defi", label: "DeFi", tone: "sky" }, { id: "games", label: "Games", tone: "fuchsia" }, { id: "tools", label: "Tools", tone: "zinc" } ];
const TONES = [ "sky", "fuchsia", "emerald", "amber", "violet", "rose", "zinc", "brand" ];
const CATEGORIES = (config.directory?.categories?.length ? config.directory.categories : DEFAULT_CATEGORIES)
    .map((c, i) => ({ id: String(c.id), label: String(c.label ?? c.id), tone: TONES.includes(c.tone) ? c.tone : TONES[i % TONES.length] }));

/** What each risk level means (the app's page says it in full) */
const RISKS = {
    low: { label: "Low risk", tone: "emerald", text: "Simple, well-understood code. Your coins stay in your control or can always be taken back." },
    medium: { label: "Medium risk", tone: "amber", text: "More moving parts, or coins held by the program for a while. Use amounts you are comfortable with." },
    high: { label: "High risk", tone: "rose", text: "New or unaudited, game of chance, or the team can change how it works. Only use what you can afford to lose." },
};

/* ------------------------------------ checks (settings/config.js directory.apps) */

const isPicture = (v) => !v || /^(https:\/\/|\/)/.test(String(v));
const isLink = (v) => !v || /^https:\/\//.test(String(v));
const seen = new Set(BUILT_IN.map((a) => a.id));
const OTHERS = (config.directory?.apps ?? []).filter((a) => {
    const where = `settings/config.js: directory.apps (${JSON.stringify(a?.id ?? a?.name)})`;
    if (!a?.id || !a?.name) { addProblem(`${where} needs an id and a name.`); return false; }
    if (seen.has(a.id)) { addProblem(`${where}: the id is used twice.`); return false; }
    seen.add(a.id);
    if (!CATEGORIES.some((c) => c.id === a.category)) addProblem(`${where}: category "${a.category}" is not in directory.categories.`);
    if (a.url && !/^(https:\/\/|#\/)/.test(String(a.url))) addProblem(`${where}: url must start with https:// or #/ (or be "" for coming soon).`);
    for (const k of [ "logo", "cover" ]) if (!isPicture(a[k])) addProblem(`${where}: ${k} must be an https:// address or a file in public/ (/apps/x.png).`);
    if ((a.screenshots ?? []).some((s) => !isPicture(s))) addProblem(`${where}: screenshots must be https:// addresses or files in public/.`);
    for (const [ k, v ] of Object.entries(a.links ?? {})) if (!isLink(v)) addProblem(`${where}: links.${k} must start with https://.`);
    if (a.risk && !RISKS[a.risk]) addProblem(`${where}: risk must be "low", "medium" or "high".`);
    if (a.audit && (!a.audit.by || !isLink(a.audit.url))) addProblem(`${where}: audit needs "by" (who audited) and an https:// "url" to the report.`);
    for (const p of a.programs ?? []) if (!/^0x[0-9a-fA-F]{40}$/.test(String(p?.address ?? ""))) addProblem(`${where}: programs must be { label, address } with a 0x address.`);
    return true;
}).map((a) => ({
    id: String(a.id), name: String(a.name), category: String(a.category), description: String(a.description ?? ""),
    about: String(a.about ?? ""), url: String(a.url ?? ""), logo: a.logo ? String(a.logo) : "", cover: a.cover ? String(a.cover) : "",
    screenshots: (a.screenshots ?? []).map(String), developer: String(a.developer ?? ""), links: { ...(a.links ?? {}) },
    programs: (a.programs ?? []).map((p) => ({ label: String(p.label ?? "Program"), address: lower(p.address) })),
    tags: Array.isArray(a.tags) ? a.tags.map(String) : [], addedAt: a.addedAt ? String(a.addedAt) : "",
    status: a.url ? (a.status === "beta" ? "beta" : "live") : "soon", featured: Boolean(a.featured),
    core: a.core === true, audit: a.audit ? { by: String(a.audit.by), url: String(a.audit.url ?? ""), date: String(a.audit.date ?? "") } : null,
    risk: RISKS[a.risk] ? a.risk : "",
}));

/** Every app: built-in first, then settings order */
const APPS = [ ...BUILT_IN, ...OTHERS ];

const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) ?? { id, label: id, tone: "zinc" };
const categoryLabel = (id) => categoryOf(id).label;
const appById = (id) => APPS.find((a) => a.id === id) ?? null;
const isExternal = (a) => /^https:\/\//.test(a.url);
const isNew = (a, now = Date.now()) => Boolean(a.addedAt) && now - Date.parse(a.addedAt) < NEW_DAYS * 86_400_000 && now >= Date.parse(a.addedAt);
const countIn = (category) => APPS.filter((a) => category === "all" || a.category === category).length;

/**
 * The badges of an app, most important first: { id, label, tone, title }.
 * Core (the chain team) · Audited · risk · Beta · New · Coming soon
 */
function badgesOf(a) {
    const out = [];
    if (a.core) out.push({ id: "core", label: "Core", tone: "brand", title: `Made by the ${settings.appName} team` });
    if (a.audit) out.push({ id: "audited", label: "Audited", tone: "emerald", title: `Audited by ${a.audit.by}${a.audit.date ? ` (${a.audit.date})` : ""}` });
    if (a.risk) out.push({ id: `risk-${a.risk}`, label: RISKS[a.risk].label, tone: RISKS[a.risk].tone, title: RISKS[a.risk].text });
    if (a.status === "beta") out.push({ id: "beta", label: "Beta", tone: "amber", title: "Still being tested: expect changes" });
    if (isNew(a)) out.push({ id: "new", label: "New", tone: "sky", title: `Added in the last ${NEW_DAYS} days` });
    if (a.status === "soon") out.push({ id: "soon", label: "Coming soon", tone: "zinc", title: "Not open yet" });
    return out;
}

/** Words the search matches */
const searchText = (a) => `${a.name} ${a.description} ${a.about} ${a.developer} ${categoryLabel(a.category)} ${a.tags.join(" ")} ${badgesOf(a).map((b) => b.label).join(" ")}`.toLowerCase();

export { APPS, BUILT_IN, CATEGORIES, RISKS, categoryOf, categoryLabel, appById, isExternal, isNew, countIn, badgesOf, searchText };
