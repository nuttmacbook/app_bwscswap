/*
 * YOUR CODE (off-chain). Apps page (#/apps): every app and utility of the chain (ui/directory.js).
 * Built for many apps: search (name, description, tags), categories with counts, a badge filter, sort, 24 at a time.
 * Each card shows the app's badges (Core, Audited, risk, Beta, New) and its category color; it opens the app's own page
 * (#/app?id=…): cover, logo, full text, screenshots, links, programs, what each badge means, and the Open button.
 * #/apps?c=games opens a category; #/apps?q=chess opens with a search.
 */

import { icon as line } from "../icons";
import { escapeHtml, shortAddress, addressUrl } from "../../../engine/ui/helpers";
import { APPS, CATEGORIES, RISKS, categoryOf, appById, isExternal, countIn, badgesOf, searchText } from "../directory";
import { pageHead } from "./shared";

const PAGE = 24;
const view = { category: "all", query: "", sort: "featured", badge: "any", shown: PAGE };
const FILTERS = [ [ "any", "Any badge" ], [ "core", "Core only" ], [ "audited", "Audited only" ], [ "safer", "Hide high risk" ] ];

/** Full class names per color (written out, so the stylesheet keeps them) */
const TONE = {
    brand: "border-brand-400/40 bg-brand-500/15 text-brand-100",
    sky: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    fuchsia: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200",
    emerald: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-400/30 bg-amber-500/10 text-amber-100",
    violet: "border-violet-400/30 bg-violet-500/10 text-violet-200",
    rose: "border-rose-400/40 bg-rose-500/10 text-rose-200",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-400",
};
const BAR = { brand: "bg-brand-400", sky: "bg-sky-400", fuchsia: "bg-fuchsia-400", emerald: "bg-emerald-400", amber: "bg-amber-400", violet: "bg-violet-400", rose: "bg-rose-400", zinc: "bg-zinc-500" };

const ICONS = {
    swap: `<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>`,
    limit: `<path d="M4 7h13l-3-3M20 17H7l3 3"/>`,
    pool: `<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>`,
    bridge: `<path d="M3 17h18M5 17V9M19 17V9M3 9c3 0 6-3 9-3s6 3 9 3M9 17v-5M15 17v-5"/>`,
    stake: `<path d="M12 3l8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/>`,
    explorer: `<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>`,
    out: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>`,
    core: `<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/>`,
    audited: `<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>`,
    risk: `<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>`,
    back: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
};
const svg = (path, size = "size-5") => `<svg viewBox="0 0 24 24" class="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const TILE = [ "from-sky-400 to-indigo-600", "from-fuchsia-400 to-rose-600", "from-amber-300 to-orange-600", "from-emerald-300 to-teal-600", "from-violet-400 to-purple-700" ];
const toneOf = (text) => [ ...String(text) ].reduce((h, c) => h + c.charCodeAt(0), 0) % TILE.length;

/** The app's picture: its logo, the utility's icon, or its first letter on a colored tile */
const appIcon = (a, size = "size-12") => (a.logo
    ? `<img src="${escapeHtml(a.logo)}" alt="" loading="lazy" class="${size} shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] object-cover" />`
    : a.icon
        ? `<span class="grid ${size} shrink-0 place-items-center rounded-2xl border border-brand-400/25 bg-brand-500/10 text-brand-200">${svg(ICONS[a.icon] ?? ICONS.swap, "size-6")}</span>`
        : `<span class="grid ${size} shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${TILE[toneOf(a.id)]} text-[18px] font-bold text-white shadow-inner">${escapeHtml(a.name.slice(0, 1).toUpperCase())}</span>`);

/** A badge chip; `withIcon` adds its shield / warning icon */
const chip = (b, withIcon = false) => {
    const icon = !withIcon ? "" : b.id === "core" ? ICONS.core : b.id === "audited" ? ICONS.audited : b.id.startsWith("risk-") ? ICONS.risk : "";
    return `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[b.tone]}" title="${escapeHtml(b.title)}" data-badge="${b.id}">${icon ? svg(icon, "size-3") : ""}${escapeHtml(b.label)}</span>`;
};
const categoryChip = (id) => { const c = categoryOf(id); return `<span class="inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE[c.tone]}">${escapeHtml(c.label)}</span>`; };
const pageOf = (a) => `#/app?id=${encodeURIComponent(a.id)}`;
const openAttrs = (a) => (isExternal(a) ? `href="${escapeHtml(a.url)}" target="_blank" rel="noopener"` : `href="${escapeHtml(a.url)}"`);

/**
 * One app as a card (also on the home page): category color on top, logo, name, badges, one line.
 * The card opens the app's page; "Open" goes straight to the app (not for Coming soon).
 */
function appCard(a, { compact = false } = {}) {
    const badges = badgesOf(a);
    const tone = categoryOf(a.category).tone;
    return /*html*/`
    <div class="surface group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 pt-5 transition hover:-translate-y-0.5 hover:border-brand-400/30 ${a.status === "soon" ? "opacity-80" : ""}" data-app="${escapeHtml(a.id)}">
        <span class="absolute inset-x-0 top-0 h-1 ${BAR[tone]} opacity-70" aria-hidden="true"></span>
        <a href="${pageOf(a)}" class="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="${escapeHtml(a.name)}: details" data-app-details></a>
        <span class="pointer-events-none relative flex items-start gap-3.5">
            ${appIcon(a, compact ? "size-11" : "size-12")}
            <span class="min-w-0 flex-1">
                <span class="block truncate text-[15px] font-semibold text-white">${escapeHtml(a.name)}</span>
                <span class="mt-1 flex flex-wrap items-center gap-1.5">${categoryChip(a.category)}${a.developer && !a.core ? `<span class="truncate text-[11px] text-zinc-500">by ${escapeHtml(a.developer)}</span>` : ""}</span>
            </span>
        </span>
        <span class="pointer-events-none relative mt-3 block text-[13px] leading-relaxed text-zinc-400 ${compact ? "line-clamp-2" : "line-clamp-3"}">${escapeHtml(a.description)}</span>
        <span class="relative mt-auto flex items-end justify-between gap-2 pt-3">
            <span class="pointer-events-none flex min-w-0 flex-wrap gap-1.5" data-app-badges>${badges.map((b) => chip(b, true)).join("")}</span>
            ${a.status === "soon" ? "" : `<a ${openAttrs(a)} class="relative z-10 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[12px] font-semibold text-white hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-app-open>Open${isExternal(a) ? svg(ICONS.out, "size-3.5") : ""}</a>`}
        </span>
    </div>`;
}

/** Apps for the current category, search and sort */
function matching() {
    const words = view.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const byBadge = (a) => (view.badge === "core" ? a.core : view.badge === "audited" ? Boolean(a.audit) : view.badge === "safer" ? a.risk !== "high" : true);
    const list = APPS.filter((a) => (view.category === "all" || a.category === view.category) && byBadge(a) && words.every((w) => searchText(a).includes(w)));
    if (view.sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
    if (view.sort === "new") return list.sort((a, b) => String(b.addedAt ?? "").localeCompare(String(a.addedAt ?? "")) || a.name.localeCompare(b.name));
    // Featured: featured first, then live before coming soon, then settings order
    return list.map((a, i) => ({ a, i })).sort((x, y) => Number(y.a.featured) - Number(x.a.featured) || Number(x.a.status === "soon") - Number(y.a.status === "soon") || x.i - y.i).map((x) => x.a);
}

const grid = () => {
    const list = matching();
    const shown = list.slice(0, view.shown);
    return /*html*/`
        <p class="text-[12px] text-zinc-500" data-apps-count>${list.length} app${list.length === 1 ? "" : "s"}${view.query ? ` for “${escapeHtml(view.query.trim())}”` : ""}</p>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-apps-grid>
            ${shown.map((a) => appCard(a)).join("") || `<p class="col-span-full rounded-2xl border border-white/[0.06] px-4 py-10 text-center text-[14px] text-zinc-500">No app matches. Try another word or category.</p>`}
        </div>
        ${list.length > shown.length ? `<div class="mt-5 text-center"><button type="button" onclick="appsMore()" class="min-h-11 rounded-xl border border-white/10 px-5 text-[13px] font-semibold text-zinc-200 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Show ${Math.min(PAGE, list.length - shown.length)} more of ${list.length}</button></div>` : ""}`;
};

const chips = () => /*html*/`
    <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Categories" data-apps-categories>
        ${[ { id: "all", label: "All" }, ...CATEGORIES ].map((c) => /*html*/`
        <button type="button" role="tab" aria-selected="${view.category === c.id}" onclick="appsCategory('${c.id}')" data-apps-category="${c.id}"
            class="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${view.category === c.id ? "border-brand-400/40 bg-brand-500/15 text-white" : "border-white/10 text-zinc-400 hover:text-white"}">
            ${escapeHtml(c.label)}<span class="text-[11px] ${view.category === c.id ? "text-brand-200" : "text-zinc-600"}">${countIn(c.id)}</span>
        </button>`).join("")}
    </div>`;

/** Reads #/apps?c=…&q=… once per visit */
function fromHash() {
    const query = new URLSearchParams(String(window.location.hash.split("?")[1] ?? ""));
    if (query.has("c")) { const c = query.get("c"); view.category = c === "all" || CATEGORIES.some((x) => x.id === c) ? c : "all"; view.shown = PAGE; }
    if (query.has("q")) { view.query = query.get("q") ?? ""; view.shown = PAGE; }
}

const appsPage = () => {
    fromHash();
    return /*html*/`
    <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 2xl:max-w-7xl">
        ${pageHead("Apps", "Everything on Bluewolfchain", `${APPS.length} apps and utilities: trade, bridge and stake on the chain's own tools, play games, and open every project built on the network.`)}
        <div class="surface z-20 sm:sticky sm:top-[61px] -mx-1 mb-5 space-y-3 rounded-2xl p-3 sm:mx-0" data-rise="2">
            <div class="flex flex-wrap gap-2">
                <label class="relative min-w-0 flex-1 basis-60">
                    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">${svg(ICONS.explorer, "size-4")}</span>
                    <input type="search" oninput="appsSearch(this.value)" value="${escapeHtml(view.query)}" placeholder="Search apps, games, tools…" autocomplete="off" spellcheck="false" aria-label="Search apps" data-apps-search
                        class="min-h-11 w-full rounded-xl border border-white/10 bg-ink-950/70 pl-9 pr-3 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60" />
                </label>
                <label class="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-[12px] text-zinc-400">Show
                    <select onchange="appsBadge(this.value)" data-apps-badge class="bg-transparent text-[13px] text-white outline-none">
                        ${FILTERS.map(([ v, l ]) => `<option value="${v}" ${view.badge === v ? "selected" : ""} class="bg-ink-900">${l}</option>`).join("")}
                    </select>
                </label>
                <label class="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-[12px] text-zinc-400">Sort
                    <select onchange="appsSort(this.value)" data-apps-sort class="bg-transparent text-[13px] text-white outline-none">
                        ${[ [ "featured", "Featured" ], [ "new", "Newest" ], [ "name", "A–Z" ] ].map(([ v, l ]) => `<option value="${v}" ${view.sort === v ? "selected" : ""} class="bg-ink-900">${l}</option>`).join("")}
                    </select>
                </label>
            </div>
            ${chips()}
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-500" data-apps-legend>
                ${chip({ id: "core", label: "Core", tone: "brand", title: "" }, true)} by the chain team
                ${chip({ id: "audited", label: "Audited", tone: "emerald", title: "" }, true)} checked by an outside auditor
                ${Object.entries(RISKS).map(([ k, r ]) => chip({ id: `risk-${k}`, label: r.label, tone: r.tone, title: r.text }, true)).join(" ")}
            </p>
        </div>
        <section data-rise="3" data-apps-results>${grid()}</section>
        <aside class="mt-10 rounded-2xl border border-white/[0.06] p-5 text-[13px] leading-relaxed text-zinc-400">
            <p class="font-semibold text-white">Built something on Bluewolfchain?</p>
            <p class="mt-1">Apps are listed by the chain team. Send your app's name, link, one line about it and a logo to have it added here.</p>
        </aside>
    </main>`;
};

/* ------------------------------------ actions (wired in ui/main.js) */

/** Category and sort change the hash too, so a link opens the same view */
const setHash = () => {
    const q = new URLSearchParams();
    if (view.category !== "all") q.set("c", view.category);
    if (view.query.trim()) q.set("q", view.query.trim());
    const text = q.toString();
    history.replaceState(null, "", `#/apps${text ? `?${text}` : ""}`);
};
const appsCategory = (id) => { view.category = id; view.shown = PAGE; setHash(); };
const appsSort = (value) => { view.sort = value; view.shown = PAGE; };
const appsBadge = (value) => { view.badge = value; view.shown = PAGE; };
const appsMore = () => { view.shown += PAGE; };
/** Search patches the results in place, so the box keeps focus */
const appsSearch = (value) => {
    view.query = String(value ?? "");
    view.shown = PAGE;
    setHash();
    const el = document.querySelector("[data-apps-results]");
    if (el) el.innerHTML = grid();
};

/* ------------------------------------ one app's page (#/app?id=…) */

const linkNames = { website: "Website", docs: "Docs", x: "X", telegram: "Telegram", discord: "Discord", github: "GitHub" };
const paragraphs = (text) => String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join("");

function appPage() {
    const id = new URLSearchParams(String(window.location.hash.split("?")[1] ?? "")).get("id") ?? "";
    const a = appById(id);
    if (!a) {
        return /*html*/`
        <main class="mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6">
            <h1 class="text-xl font-semibold text-white">No app here</h1>
            <p class="mt-2 text-[14px] text-zinc-400">This link points to an app that is not listed (any more).</p>
            <a href="#/apps" class="mt-5 inline-flex min-h-11 items-center rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/[0.06]">All apps</a>
        </main>`;
    }
    const badges = badgesOf(a);
    const cat = categoryOf(a.category);
    const links = Object.entries(a.links ?? {}).filter(([ , v ]) => v);
    const related = APPS.filter((x) => x.category === a.category && x.id !== a.id).slice(0, 3);
    const explain = (b) => (b.id === "core" ? `Made and run by the ${escapeHtml(a.developer || "chain")} team, the people who run this chain.`
        : b.id === "audited" ? `Audited by <b class="text-white">${escapeHtml(a.audit.by)}</b>${a.audit.date ? ` (${escapeHtml(a.audit.date)})` : ""}.${a.audit.url ? ` <a href="${escapeHtml(a.audit.url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-brand-300 hover:text-brand-200">Read the report${line("external", "size-3")}</a>` : ""} An audit lowers the risk; it does not remove it.`
        : escapeHtml(b.title));
    const openButton = a.status === "soon"
        ? `<span class="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 px-6 text-[15px] font-semibold text-zinc-400" data-app-page-open>Coming soon</span>`
        : `<a ${openAttrs(a)} class="btn-brand inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-6 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" data-app-page-open>Open ${escapeHtml(a.name)}${isExternal(a) ? svg(ICONS.out, "size-4") : ""}</a>`;
    return /*html*/`
    <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10" data-app-page="${escapeHtml(a.id)}">
        <a href="#/apps${a.category ? `?c=${encodeURIComponent(a.category)}` : ""}" class="inline-flex min-h-10 items-center gap-1.5 rounded-lg text-[13px] text-zinc-400 hover:text-white">${svg(ICONS.back, "size-4")} All ${escapeHtml(cat.label)}</a>

        <!-- Cover + header -->
        <section class="surface relative mt-3 overflow-hidden rounded-3xl" data-rise>
            <div class="relative h-36 sm:h-56 ${a.cover ? "" : `bg-gradient-to-br ${TILE[toneOf(a.id)]} opacity-60`}" data-app-cover>
                ${a.cover ? `<img src="${escapeHtml(a.cover)}" alt="" class="absolute inset-0 size-full object-cover" />` : ""}
                <div class="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-transparent"></div>
            </div>
            <div class="relative -mt-12 flex flex-wrap items-end gap-4 px-5 pb-5 sm:-mt-14 sm:px-7 sm:pb-7">
                <span class="rounded-[22px] bg-ink-950 p-1">${appIcon(a, "size-20 sm:size-24")}</span>
                <div class="min-w-0 flex-1 basis-56">
                    <h1 class="text-2xl font-semibold tracking-tight text-white sm:text-3xl">${escapeHtml(a.name)}</h1>
                    <p class="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-zinc-400">${categoryChip(a.category)}${a.developer ? `<span>by ${escapeHtml(a.developer)}</span>` : ""}</p>
                </div>
                <div class="w-full sm:w-auto">${openButton}</div>
            </div>
        </section>

        <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-w-0 space-y-5">
                <section class="surface rounded-3xl p-5 sm:p-6" aria-label="About">
                    <p class="text-[15px] font-medium leading-relaxed text-white">${escapeHtml(a.description)}</p>
                    <div class="mt-3 space-y-3 text-[14px] leading-relaxed text-zinc-400" data-app-about>${paragraphs(a.about) || ""}</div>
                </section>
                ${a.screenshots.length ? /*html*/`
                <section aria-label="Screenshots">
                    <div class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-app-shots>
                        ${a.screenshots.map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="h-48 shrink-0 snap-start rounded-2xl border border-white/10 object-cover sm:h-64" />`).join("")}
                    </div>
                </section>` : ""}
            </div>

            <aside class="min-w-0 space-y-5">
                <section class="surface rounded-3xl p-5" aria-label="Badges" data-app-page-badges>
                    <p class="text-[13px] font-semibold text-white">Badges</p>
                    <ul class="mt-3 space-y-3">
                        ${badges.map((b) => `<li class="text-[12px] leading-relaxed text-zinc-400"><span class="mb-1 flex">${chip(b, true)}</span>${explain(b)}</li>`).join("") || `<li class="text-[12px] text-zinc-500">No badges yet: not audited, no risk rating. Take extra care.</li>`}
                        ${!a.core && !a.audit ? `<li class="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-3 text-[12px] leading-relaxed text-amber-100/90">Not made by the chain team and not audited. Listing here is not an endorsement: check it yourself before you trust it with coins.</li>` : ""}
                    </ul>
                </section>
                ${links.length ? /*html*/`
                <section class="surface rounded-3xl p-5" aria-label="Links">
                    <p class="text-[13px] font-semibold text-white">Links</p>
                    <ul class="mt-2">${links.map(([ k, v ]) => `<li><a href="${escapeHtml(v)}" target="_blank" rel="noopener" class="flex min-h-10 items-center justify-between gap-2 text-[13px] text-zinc-300 hover:text-white">${escapeHtml(linkNames[k] ?? k)}<span class="text-zinc-500">${svg(ICONS.out, "size-3.5")}</span></a></li>`).join("")}</ul>
                </section>` : ""}
                ${a.programs.length ? /*html*/`
                <section class="surface rounded-3xl p-5" aria-label="Programs on the chain" data-app-programs>
                    <p class="text-[13px] font-semibold text-white">Programs on the chain</p>
                    <p class="mt-1 text-[11px] text-zinc-500">Read the code yourself on the explorer.</p>
                    <ul class="mt-2">${a.programs.map((p) => `<li><a href="${escapeHtml(addressUrl(p.address) || "#")}" target="_blank" rel="noopener" class="flex min-h-10 items-center justify-between gap-2 text-[13px] text-zinc-300 hover:text-white"><span class="truncate">${escapeHtml(p.label)}</span><span class="font-mono text-[12px] text-zinc-500">${escapeHtml(shortAddress(p.address))}</span></a></li>`).join("")}</ul>
                </section>` : ""}
                ${a.tags.length ? `<p class="flex flex-wrap gap-1.5 px-1">${a.tags.map((t) => `<a href="#/apps?q=${encodeURIComponent(t)}" class="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400 hover:text-white">#${escapeHtml(t)}</a>`).join("")}</p>` : ""}
            </aside>
        </div>

        ${related.length ? /*html*/`
        <section class="mt-10" aria-label="More ${escapeHtml(cat.label)}">
            <div class="flex items-baseline justify-between"><p class="text-[15px] font-semibold text-white">More ${escapeHtml(cat.label)}</p><a href="#/apps?c=${encodeURIComponent(cat.id)}" class="inline-flex items-center gap-1 text-[13px] text-brand-300 hover:text-brand-200">All${line("arrowRight", "size-3.5")}</a></div>
            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${related.map((x) => appCard(x, { compact: true })).join("")}</div>
        </section>` : ""}
    </main>`;
}

export { appsPage, appPage, appCard, appIcon, appsCategory, appsSort, appsBadge, appsMore, appsSearch };
