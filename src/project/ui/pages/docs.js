/*
 * YOUR CODE (off-chain). Docs (#/docs?p=slug): how to use the chain, write programs and build apps on it.
 * Layout: sections on the left (searchable; a drawer on phones), the page in the middle, "On this page" on the right,
 * previous / next at the bottom. The text lives in ui/docs-content.js.
 */

import { escapeHtml } from "../../../engine/ui/helpers";
import { settings } from "../../../engine/settings";
import { networkDetails } from "../../chain";
import { PAGES } from "../docs-content";
import { codeBlock } from "../code";
import { icon } from "../icons";

const view = { query: "", menu: false };

/** {NODE} {RPC} … from the settings */
function fill(text) {
    const d = networkDetails();
    const values = { NODE: settings.nodeUrl, RPC: d.rpcUrl, CHAIN_ID: String(d.chainId), SYMBOL: d.symbol ?? "", NAME: d.name ?? settings.appName, EXPLORER: d.explorerUrl || "the chain's explorer" };
    return String(text).replace(/\{(NODE|RPC|CHAIN_ID|SYMBOL|NAME|EXPLORER)\}/g, (_, k) => values[k]);
}

/** `code`, **bold**, [label](href) in an escaped line of text */
function inline(text) {
    return escapeHtml(fill(text))
        .replace(/`([^`]+)`/g, (_, c) => `<code class="doc-code">${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong class="font-semibold text-white">${b}</strong>`)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
            const external = /^https:\/\//.test(href);
            return `<a href="${href}" ${external ? `target="_blank" rel="noopener"` : ""} class="font-medium text-brand-300 underline decoration-brand-400/30 underline-offset-4 hover:text-brand-200 hover:decoration-brand-300">${label}</a>`;
        });
}

const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const current = () => {
    const p = new URLSearchParams(String(window.location.hash.split("?")[1] ?? "")).get("p");
    return PAGES.find((x) => x.slug === p) ?? PAGES[0];
};
const textOf = (page) => [ page.title, page.lead, ...page.blocks.map((b) => JSON.stringify(b.at(1) ?? "")) ].join(" ").toLowerCase();

/* ------------------------------------ blocks */

function block(b) {
    const [ kind, a, c ] = b;
    if (kind === "h2") return `<h2 id="${slugOf(fill(a))}" class="group mt-14 scroll-mt-24 text-[22px] font-semibold tracking-[-0.02em] text-white first:mt-0"><a href="#" onclick="event.preventDefault(); docsJump('${slugOf(fill(a))}')" class="no-underline">${escapeHtml(fill(a))}</a></h2>`;
    if (kind === "p") return `<p class="mt-4 text-[15px] leading-[1.75] text-zinc-400">${inline(a)}</p>`;
    if (kind === "list") return `<ul class="mt-4 space-y-2.5">${a.map((t) => `<li class="relative pl-5 text-[15px] leading-[1.7] text-zinc-400 before:absolute before:left-0 before:top-[0.72em] before:h-px before:w-2.5 before:bg-brand-400/60">${inline(t)}</li>`).join("")}</ul>`;
    if (kind === "code") return `<div class="mt-5">${codeBlock({ code: fill(a.code), file: a.file, lang: a.lang ?? "js" })}</div>`;
    if (kind === "note" || kind === "warn") {
        const warn = kind === "warn";
        return `<div class="mt-5 flex gap-3 rounded-2xl border ${warn ? "border-amber-400/20 bg-amber-500/[0.05]" : "border-brand-400/20 bg-brand-500/[0.05]"} px-4 py-3.5"><span class="mt-0.5 h-auto w-0.5 shrink-0 rounded-full ${warn ? "bg-amber-300/70" : "bg-brand-300/70"}"></span><p class="text-[14px] leading-relaxed ${warn ? "text-amber-50/80" : "text-zinc-300"}">${inline(a)}</p></div>`;
    }
    if (kind === "table") {
        const head = a.some(Boolean);
        return /*html*/`
        <div class="mt-5 overflow-x-auto rounded-2xl border border-white/[0.07]">
            <table class="w-full text-left text-[14px]">
                ${head ? `<thead class="bg-white/[0.03] text-[11px] uppercase tracking-[0.12em] text-zinc-500"><tr>${a.map((h) => `<th class="px-4 py-2.5 font-medium">${escapeHtml(h)}</th>`).join("")}</tr></thead>` : ""}
                <tbody class="divide-y divide-white/[0.06]">${c.map((row) => `<tr>${row.map((cell, i) => `<td class="px-4 py-3 align-top leading-relaxed ${i === 0 ? "whitespace-nowrap text-zinc-200" : "text-zinc-400"}">${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
        </div>`;
    }
    if (kind === "steps") {
        return `<ol class="mt-6 space-y-0">${a.map((s, i) => /*html*/`
            <li class="relative flex gap-4 pb-6 last:pb-0">
                ${i < a.length - 1 ? `<span class="absolute left-4 top-8 bottom-0 w-px bg-white/[0.08]" aria-hidden="true"></span>` : ""}
                <span class="relative grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-ink-900 font-mono text-[12px] text-brand-300">${String(i + 1).padStart(2, "0")}</span>
                <span class="min-w-0 flex-1 pt-1"><span class="block text-[15px] font-semibold text-white">${inline(s.title)}</span><span class="mt-1 block text-[14px] leading-relaxed text-zinc-400">${inline(s.text)}</span></span>
            </li>`).join("")}</ol>`;
    }
    if (kind === "cards") {
        return `<div class="mt-5 grid gap-3 sm:grid-cols-2">${a.map((card) => /*html*/`
            <a href="${card.href}" class="group rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 transition hover:border-brand-400/30 hover:bg-white/[0.04]">
                <span class="flex items-center justify-between gap-3 text-[15px] font-semibold text-white">${escapeHtml(fill(card.title))}<span class="text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-brand-300">${icon("arrowRight")}</span></span>
                <span class="mt-1.5 block text-[13px] leading-relaxed text-zinc-400">${escapeHtml(fill(card.text))}</span>
            </a>`).join("")}</div>`;
    }
    return "";
}

/* ------------------------------------ the page */

function sidebar(page) {
    const q = view.query.trim().toLowerCase();
    const list = PAGES.filter((p) => !q || textOf(p).includes(q));
    const groups = [ ...new Set(list.map((p) => p.group)) ];
    return /*html*/`
        <label class="relative block">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"><svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></span>
            <input type="search" oninput="docsSearch(this.value)" value="${escapeHtml(view.query)}" placeholder="Search the docs" aria-label="Search the docs" data-docs-search autocomplete="off"
                class="min-h-10 w-full rounded-xl border border-white/10 bg-ink-950/70 pl-9 pr-3 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60" />
        </label>
        <nav class="mt-6 space-y-7" aria-label="Docs" data-docs-nav>
            ${groups.map((g) => /*html*/`
            <div>
                <p class="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">${escapeHtml(g)}</p>
                <ul class="mt-2 space-y-0.5">${list.filter((p) => p.group === g).map((p) => `<li><a href="#/docs?p=${p.slug}" ${p.slug === page.slug ? `aria-current="page"` : ""} onclick="docsCloseMenu()" class="block rounded-lg px-3 py-1.5 text-[14px] transition ${p.slug === page.slug ? "bg-white/[0.06] font-medium text-white" : "text-zinc-400 hover:text-white"}" data-docs-link="${p.slug}">${escapeHtml(p.title)}</a></li>`).join("")}</ul>
            </div>`).join("") || `<p class="px-3 text-[13px] text-zinc-500">Nothing matches.</p>`}
        </nav>`;
}

function docsPage() {
    const page = current();
    const i = PAGES.indexOf(page);
    const prev = PAGES.at(i - 1);
    const next = PAGES.at(i + 1);
    const headings = page.blocks.filter((b) => b.at(0) === "h2").map((b) => fill(b.at(1)));
    return /*html*/`
    <main class="mx-auto w-full max-w-[1400px] px-4 sm:px-6" data-docs="${page.slug}">
        <!-- Phones: the sections in a drawer -->
        <div class="sticky top-[61px] z-20 -mx-4 border-b border-white/[0.06] bg-ink-950/85 px-4 py-2 backdrop-blur lg:hidden">
            <button type="button" onclick="docsMenu()" aria-expanded="${view.menu}" class="flex min-h-10 w-full items-center justify-between gap-3 text-[13px] text-zinc-300" data-docs-menu>
                <span><span class="text-zinc-500">${escapeHtml(page.group)}</span> <span class="mx-1 text-zinc-600">/</span> ${escapeHtml(page.title)}</span>
                <span class="transition ${view.menu ? "rotate-180" : ""}">${icon("chevronDown")}</span>
            </button>
            ${view.menu ? `<div class="max-h-[70dvh] overflow-y-auto pb-4 pt-3">${sidebar(page)}</div>` : ""}
        </div>

        <div class="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
            <aside class="hidden lg:block"><div class="sticky top-[85px] max-h-[calc(100dvh-110px)] overflow-y-auto pb-10 pr-2 pt-10">${sidebar(page)}</div></aside>

            <article class="min-w-0 max-w-[760px] py-10 sm:py-14" data-docs-article>
                <p class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-300/90">${escapeHtml(page.group)}</p>
                <h1 class="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[42px]">${escapeHtml(fill(page.title))}</h1>
                ${page.lead ? `<p class="mt-4 text-[17px] leading-relaxed text-zinc-300">${inline(page.lead)}</p>` : ""}
                <div class="mt-10 border-t border-white/[0.06] pt-2">${page.blocks.map(block).join("")}</div>

                <nav class="mt-16 grid gap-3 border-t border-white/[0.06] pt-8 sm:grid-cols-2" aria-label="Previous and next">
                    ${i > 0 ? `<a href="#/docs?p=${prev.slug}" class="group rounded-2xl border border-white/[0.07] p-4 hover:border-brand-400/30" data-docs-prev><span class="flex items-center gap-1.5 text-[12px] text-zinc-500">${icon("arrowLeft", "size-3.5")}Previous</span><span class="mt-1 block text-[15px] font-medium text-white">${escapeHtml(prev.title)}</span></a>` : "<span></span>"}
                    ${next && i < PAGES.length - 1 ? `<a href="#/docs?p=${next.slug}" class="group rounded-2xl border border-white/[0.07] p-4 text-right hover:border-brand-400/30" data-docs-next><span class="flex items-center justify-end gap-1.5 text-[12px] text-zinc-500">Next${icon("arrowRight", "size-3.5")}</span><span class="mt-1 block text-[15px] font-medium text-white">${escapeHtml(next.title)}</span></a>` : ""}
                </nav>
            </article>

            <aside class="hidden xl:block">
                ${headings.length ? /*html*/`
                <div class="sticky top-[85px] pt-10">
                    <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">On this page</p>
                    <ul class="mt-3 space-y-2 border-l border-white/[0.07]" data-docs-toc>${headings.map((h) => `<li><a href="#" onclick="event.preventDefault(); docsJump('${slugOf(h)}')" class="-ml-px block border-l border-transparent pl-3 text-[13px] text-zinc-400 hover:border-brand-300 hover:text-white">${escapeHtml(h)}</a></li>`).join("")}</ul>
                </div>` : ""}
            </aside>
        </div>
    </main>`;
}

/* ------------------------------------ actions (wired in ui/main.js) */

/** Search patches the section list in place (the box keeps focus) */
function docsSearch(value) {
    view.query = String(value ?? "");
    for (const nav of document.querySelectorAll("[data-docs-nav]")) {
        const fresh = document.createElement("div");
        fresh.innerHTML = sidebar(current());
        nav.replaceWith(fresh.querySelector("[data-docs-nav]"));
    }
}
const docsMenu = () => { view.menu = !view.menu; };
const docsCloseMenu = () => { view.menu = false; };
/** Headings scroll in place (the hash holds the page, not the heading) */
const docsJump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export { docsPage, docsSearch, docsMenu, docsCloseMenu, docsJump };
