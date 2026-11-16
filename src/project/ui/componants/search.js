/*
 * YOUR CODE (off-chain). The search box in the header: every app and utility of the chain (ui/directory.js), from any
 * page. Opens with the header button, "/" or Ctrl/⌘ K. The chain's own tools open at once; other apps open their page.
 */

import { openPicker } from "./picker";
import { APPS, categoryLabel, isExternal, badgesOf } from "../directory";
import { appIcon } from "../pages/apps";

function openSearch() {
    openPicker({
        title: "Search the chain's apps",
        placeholder: "Swap, bridge, games…",
        items: APPS.map((a) => ({
            id: a.id,
            label: a.name,
            sub: `${categoryLabel(a.category)} · ${a.status === "soon" ? "coming soon" : a.description}`,
            search: `${a.description} ${(a.tags ?? []).join(" ")}`,
            badge: appIcon(a, "size-9"),
            note: badgesOf(a)[0]?.label ?? "",
        })),
        onPick: (id) => {
            // The chain's own tools open at once; every other app opens its page (badges, details, Open)
            const a = APPS.find((x) => x.id === id);
            if (!a) return;
            if (a.core && a.url && !isExternal(a)) window.location.hash = a.url.slice(1);
            else window.location.hash = `/app?id=${encodeURIComponent(a.id)}`;
        },
    });
}

/** "/" or Ctrl/⌘ K anywhere (not while typing in a field) */
function listenForSearchKeys() {
    document.addEventListener("keydown", (event) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
        if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
            event.preventDefault();
            openSearch();
        }
    });
}

export { openSearch, listenForSearchKeys };
