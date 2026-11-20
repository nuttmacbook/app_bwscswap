import { settings } from "../../../engine/settings";
import { escapeHtml } from "../../../engine/ui/helpers";
import { icon } from "../icons";

/* YOUR CODE (off-chain). Bottom of every page: the chain, its apps, the developer pages and the network. */

const column = (title, links) => /*html*/`
    <div class="min-w-0">
        <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">${title}</p>
        <ul class="mt-4 space-y-2.5 text-[13px]">${links.map(([ label, href, external ]) => `<li><a href="${escapeHtml(href)}" ${external ? `target="_blank" rel="noopener"` : ""} class="inline-flex items-center gap-1 text-zinc-400 transition hover:text-white">${escapeHtml(label)}${external ? icon("external", "size-3") : ""}</a></li>`).join("")}</ul>
    </div>`;

const footer = /*html*/`
    <footer class="mx-auto w-full max-w-6xl 2xl:max-w-7xl px-4 pb-28 pt-16 sm:px-6 md:pb-12">
        <div class="grid gap-10 border-t border-white/[0.06] pt-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div class="min-w-0">
                <a href="#/" class="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="${escapeHtml(settings.appName)} home"><img src="/brand/logo-horizontal-on-dark.svg" alt="${escapeHtml(settings.appName)}" class="h-14 w-auto" /></a>
                <p class="mt-4 max-w-xs text-[13px] leading-relaxed text-zinc-500">${escapeHtml(settings.tagline)}</p>
                <p class="mt-4 font-mono text-[12px] text-zinc-600">Chain ID ${settings.chainId}</p>
            </div>
            ${column("Apps", [ [ "All apps", "#/apps" ], [ "Swap", "#/swap" ], [ "Limit orders", "#/limit" ], [ "Pool", "#/pool" ], [ "Bridge", "#/bridge" ], [ "Stake", "#/stake" ], [ "Multi transfer", "#/send" ] ])}
            ${column("Developers", [ [ "Docs", "#/docs" ], [ "Your first program", "#/docs?p=first-program" ], [ "Build an app", "#/docs?p=reading" ], [ "HTTP API", "#/docs?p=http-api" ] ])}
            ${column("Network", [ [ "Network and wallets", "#/docs?p=network" ], [ "Blocks and fees", "#/docs?p=fees" ], ...(settings.explorerUrl ? [ [ "Explorer", settings.explorerUrl, true ] ] : []) ])}
        </div>
        <p class="mt-12 text-[12px] text-zinc-600">${escapeHtml(settings.appName)}</p>
    </footer>
`;

export { footer };
