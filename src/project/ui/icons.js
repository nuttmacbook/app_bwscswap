/*
 * YOUR CODE (off-chain). The site's line icons (one stroke style everywhere). Pages use these instead of text symbols
 * such as arrows, ticks or crosses, so every mark on the site is drawn the same way.
 *
 * icon(name, className = "size-4") → <svg>
 */

const PATHS = {
    upload: `<path d="M12 16V4M7 9l5-5 5 5M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>`,
    send: `<circle cx="5" cy="12" r="2"/><path d="M7 12h3c2 0 3-6 6-6h4M10 12c2 0 3 6 6 6h4M10 12h10M17 3l3 3-3 3M17 15l3 3-3 3"/>`,
    arrowRight: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
    arrowLeft: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
    arrowDown: `<path d="M12 5v14M6 13l6 6 6-6"/>`,
    external: `<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>`,
    chevronDown: `<path d="M6 9l6 6 6-6"/>`,
    chevronRight: `<path d="M9 6l6 6-6 6"/>`,
    check: `<path d="M5 12.5l4.2 4.2L19 7"/>`,
    close: `<path d="M6 6l12 12M18 6L6 18"/>`,
    swapH: `<path d="M4 8h14l-3-3M20 16H6l3 3"/>`,
    link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
    copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>`,
    pair: `<path d="M7 7h11M15 4l3 3-3 3M17 17H6M9 14l-3 3 3 3"/>`,
};

const icon = (name, cls = "size-4") =>
    `<svg viewBox="0 0 24 24" class="${cls} shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;

export { icon };
