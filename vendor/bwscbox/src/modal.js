/*
 * The connect / account window. Plain DOM, styles scoped under .bwscbox-*, no framework.
 * Theme: "dark" | "light" + variables: --bwsc-accent, --bwsc-accent-text, --bwsc-bg, --bwsc-text, --bwsc-muted,
 * --bwsc-border, --bwsc-radius, --bwsc-font (any you leave out use the theme's own).
 */

import { shortAddress } from "./values.js";

const THEMES = {
    dark: { "--bwsc-bg": "#0f1220", "--bwsc-text": "#eef0ff", "--bwsc-muted": "#9aa0bf", "--bwsc-border": "rgba(255,255,255,.1)", "--bwsc-item": "rgba(255,255,255,.04)", "--bwsc-accent": "#7c5cff", "--bwsc-accent-text": "#ffffff" },
    light: { "--bwsc-bg": "#ffffff", "--bwsc-text": "#14162b", "--bwsc-muted": "#5d6280", "--bwsc-border": "rgba(20,22,43,.12)", "--bwsc-item": "rgba(20,22,43,.04)", "--bwsc-accent": "#5b3df5", "--bwsc-accent-text": "#ffffff" },
};

const CSS = `
.bwscbox-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(5,6,15,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:0;touch-action:manipulation}
@media (min-width:520px){.bwscbox-backdrop{align-items:center;padding:16px}}
.bwscbox-card{width:100%;max-width:400px;max-height:90vh;overflow:auto;background:var(--bwsc-bg);color:var(--bwsc-text);border:1px solid var(--bwsc-border);border-radius:var(--bwsc-radius,20px) var(--bwsc-radius,20px) 0 0;padding:20px;font-family:var(--bwsc-font,ui-sans-serif,system-ui,sans-serif);box-shadow:0 24px 80px rgba(0,0,0,.45)}
@media (min-width:520px){.bwscbox-card{border-radius:var(--bwsc-radius,20px)}}
.bwscbox-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.bwscbox-title{font-size:17px;font-weight:650;margin:0}
.bwscbox-x{all:unset;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:10px;color:var(--bwsc-muted);font-size:20px;line-height:1}
.bwscbox-x:hover{background:var(--bwsc-item);color:var(--bwsc-text)}
.bwscbox-list{display:grid;gap:8px}
.bwscbox-item{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:14px;background:var(--bwsc-item);border:1px solid var(--bwsc-border);font-size:15px;font-weight:550}
.bwscbox-item:hover,.bwscbox-item:focus-visible{border-color:var(--bwsc-accent)}
.bwscbox-item img,.bwscbox-dot{width:32px;height:32px;border-radius:9px;flex:none}
.bwscbox-dot{display:grid;place-items:center;background:var(--bwsc-accent);color:var(--bwsc-accent-text);font-weight:700}
.bwscbox-note{color:var(--bwsc-muted);font-size:13px;line-height:1.5;margin:12px 0 0}
.bwscbox-btn{all:unset;box-sizing:border-box;cursor:pointer;display:block;width:100%;text-align:center;padding:12px 14px;border-radius:14px;background:var(--bwsc-accent);color:var(--bwsc-accent-text);font-weight:650;font-size:15px;margin-top:10px}
.bwscbox-btn.ghost{background:transparent;color:var(--bwsc-text);border:1px solid var(--bwsc-border)}
.bwscbox-btn:focus-visible{outline:2px solid var(--bwsc-accent);outline-offset:2px}
.bwscbox-addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;word-break:break-all;padding:12px 14px;border-radius:14px;background:var(--bwsc-item);border:1px solid var(--bwsc-border)}
.bwscbox-warn{color:#ffb84d}
.bwscbox-err{color:#ff7a7a;font-size:13px;margin:10px 0 0;min-height:1em}
`;

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeIcon = (icon) => (typeof icon === "string" && /^data:image\/(svg\+xml|png|webp|jpeg)[;,]/i.test(icon) ? icon : "");
const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");

/**
 * @param {object} manager   createWalletManager(...)
 * @param {object} options   { theme: "dark" | "light", themeVariables: {}, appName }
 */
export function createModal(manager, { theme = "dark", themeVariables = {}, appName = "" } = {}) {
    if (typeof document === "undefined") return { open: () => {}, close: () => {} };

    if (!document.getElementById("bwscbox-style")) {
        const style = document.createElement("style");
        style.id = "bwscbox-style";
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    let root = null;
    let error = "";
    let stopWatching = () => {};

    const vars = { ...(THEMES[theme] ?? THEMES.dark), ...themeVariables };
    const styleAttr = Object.entries(vars).map(([ key, value ]) => `${key}:${value}`).join(";");

    function connectView() {
        const wallets = manager.wallets();
        const items = wallets.map((w) => /*html*/`
            <button class="bwscbox-item" data-rdns="${escape(w.rdns)}">
                ${safeIcon(w.icon) ? `<img src="${escape(safeIcon(w.icon))}" alt="">` : `<span class="bwscbox-dot">${escape(w.name.slice(0, 1))}</span>`}
                <span>${escape(w.name)}</span>
            </button>`).join("");
        const here = typeof location !== "undefined" ? `${location.host}${location.pathname}${location.search}${location.hash}` : "";
        const none = isMobile()
            ? /*html*/`<p class="bwscbox-note">No wallet in this browser. Open this page inside your wallet app.</p>
                <a class="bwscbox-btn" href="https://metamask.app.link/dapp/${escape(here)}" rel="noopener">Open in MetaMask app</a>`
            : /*html*/`<p class="bwscbox-note">No wallet found in this browser. Install a wallet extension, then reload this page.</p>
                <a class="bwscbox-btn" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Get MetaMask</a>`;
        return /*html*/`
            <div class="bwscbox-head"><p class="bwscbox-title">Connect a wallet</p><button class="bwscbox-x" data-close aria-label="Close">×</button></div>
            ${wallets.length ? `<div class="bwscbox-list">${items}</div>` : none}
            ${appName ? `<p class="bwscbox-note">${escape(appName)} only asks your wallet to sign. It never sees your keys.</p>` : ""}
            <p class="bwscbox-err" role="alert">${escape(error)}</p>`;
    }

    function accountView(state) {
        return /*html*/`
            <div class="bwscbox-head"><p class="bwscbox-title">${escape(state.walletName)}</p><button class="bwscbox-x" data-close aria-label="Close">×</button></div>
            <div class="bwscbox-addr" title="${escape(state.address)}">${escape(shortAddress(state.address, 10, 8))}</div>
            ${state.isRightChain ? "" : `<p class="bwscbox-note bwscbox-warn">Your wallet is on another network.</p><button class="bwscbox-btn" data-switch>Switch network</button>`}
            <button class="bwscbox-btn ghost" data-copy>Copy address</button>
            <button class="bwscbox-btn ghost" data-disconnect>Disconnect</button>
            <p class="bwscbox-err" role="alert">${escape(error)}</p>`;
    }

    function paint() {
        if (!root) return;
        const state = manager.current();
        root.querySelector(".bwscbox-card").innerHTML = state?.address ? accountView(state) : connectView();
    }

    async function guard(action) {
        error = "";
        try { await action(); } catch (err) {
            const code = err?.code ?? err?.cause?.code;
            error = code === 4001 || code === "ACTION_REJECTED" ? "You closed the wallet prompt." : (err?.message ?? "Something went wrong.");
        }
        paint();
    }

    function onClick(event) {
        const target = event.target.closest?.("[data-rdns],[data-close],[data-switch],[data-copy],[data-disconnect]");
        if (event.target === root || target?.hasAttribute("data-close")) return close();
        if (!target) return;
        if (target.dataset.rdns) return guard(async () => { await manager.connect(target.dataset.rdns); close(); });
        if (target.hasAttribute("data-switch")) return guard(() => manager.ensureChain());
        if (target.hasAttribute("data-copy")) return guard(async () => { await navigator.clipboard?.writeText(manager.current()?.address ?? ""); target.textContent = "Copied"; });
        if (target.hasAttribute("data-disconnect")) return guard(async () => { await manager.disconnect(); close(); });
    }

    const onKey = (event) => { if (event.key === "Escape") close(); };

    function open() {
        if (root) return paint();
        error = "";
        root = document.createElement("div");
        root.className = "bwscbox-backdrop";
        root.setAttribute("style", styleAttr);
        root.innerHTML = `<div class="bwscbox-card" role="dialog" aria-modal="true" aria-label="Wallet"></div>`;
        root.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey);
        document.body.appendChild(root);
        stopWatching = manager.onChange(paint);
        paint();
        root.querySelector("button")?.focus?.();
    }

    function close() {
        stopWatching();
        document.removeEventListener("keydown", onKey);
        root?.remove();
        root = null;
    }

    return { open, close };
}
