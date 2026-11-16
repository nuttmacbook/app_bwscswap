import { escapeHtml } from "../../../engine/ui/helpers";
import { icon } from "../icons";

/*
 * YOUR CODE (off-chain). A list to pick from (token, chain, market): opens over the page, searchable, keyboard friendly.
 * Lives outside #app, so the page behind does not repaint while it is open.
 *
 *   openPicker({ title, items: [{ id, label, sub, search, right, badge, isDisabled, note }], onPick: (id) => {} })
 *   search: extra text the search box matches (e.g. the address), not shown
 *   onFree: (text) => boolean   optional: offers "Use <what was typed>" when it is an address; true closes the list
 */

let root = null;

const close = () => {
    root?.remove();
    root = null;
    document.removeEventListener("keydown", onKey);
};
const onKey = (event) => { if (event.key === "Escape") close(); };

const row = (item) => /*html*/`
    <button type="button" data-pick="${escapeHtml(item.id)}" data-pick-label="${escapeHtml(item.label)}" ${item.isDisabled ? "disabled" : ""}
        class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
        ${item.badge ?? ""}
        <span class="min-w-0 flex-1">
            <span class="block truncate text-[14px] font-semibold text-white">${escapeHtml(item.label)}</span>
            ${item.sub ? `<span class="block truncate text-[12px] text-zinc-500">${escapeHtml(item.sub)}</span>` : ""}
        </span>
        ${item.note ? `<span class="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">${escapeHtml(item.note)}</span>` : ""}
        ${item.right ? `<span class="shrink-0 font-mono text-[13px] tabular-nums text-zinc-300">${item.right}</span>` : ""}
    </button>`;

// Hundreds of items: draw the first MAX_ROWS, the search box finds the rest
const MAX_ROWS = 100;
const rows = (list) => list.slice(0, MAX_ROWS).map(row).join("")
    + (list.length > MAX_ROWS ? `<p class="px-3 py-3 text-center text-[12px] text-zinc-500" data-pick-more>${list.length - MAX_ROWS} more: type to search</p>` : "");

function openPicker({ title, items = [], onPick = () => {}, onFree = null, placeholder = "Search" }) {
    close();
    root = document.createElement("div");
    root.className = "fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/70 backdrop-blur-sm sm:items-center sm:p-4";
    root.innerHTML = /*html*/`
        <div class="surface flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl p-4 sm:rounded-3xl" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
            <div class="flex items-center justify-between gap-3 px-1">
                <p class="text-[15px] font-semibold text-white">${escapeHtml(title)}</p>
                <button type="button" data-close class="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Close">${icon("close")}</button>
            </div>
            ${items.length > 2 || onFree ? `<input data-search type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" class="mt-3 w-full rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-brand-400/60" />` : ""}
            <div data-list class="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">${rows(items)}</div>
        </div>`;
    root.addEventListener("click", (event) => {
        if (event.target === root || event.target.closest("[data-close]")) return close();
        const pick = event.target.closest("[data-pick]");
        if (pick && pick.dataset.pick === "__free__") {
            if (onFree?.(root.querySelector("[data-search]")?.value.trim() ?? "")) close();
            return;
        }
        if (pick && !pick.disabled) { close(); onPick(pick.dataset.pick); }
    });
    root.querySelector("[data-search]")?.addEventListener("input", (event) => {
        const q = event.target.value.trim().toLowerCase();
        const found = items.filter((i) => `${i.label} ${i.sub ?? ""} ${i.search ?? ""}`.toLowerCase().includes(q));
        // A pasted address that is not in the list can still be used (e.g. a new token for a new pair)
        const free = onFree && /^0x[0-9a-f]{40}$/.test(q) && !found.some((i) => String(i.id).toLowerCase() === q)
            ? row({ id: "__free__", label: "Use this address", sub: q }) : "";
        root.querySelector("[data-list]").innerHTML = (free + rows(found))
            || `<p class="px-3 py-6 text-center text-[13px] text-zinc-500">Nothing matches.</p>`;
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    (root.querySelector("[data-search]") ?? root.querySelector("[data-pick]:not([disabled])"))?.focus();
}

export { openPicker, close as closePicker };
