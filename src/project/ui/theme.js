/*
 * YOUR CODE (off-chain, design). Look of the wallet windows: REOWN_THEME (the real site) and WALLET_THEME (deploy-kit test chain only).
 * Colors of the page itself are in src/project/ui/theme.css (keep these two in step).
 */

const WALLET_MODE = "dark";

const WALLET_THEME = {
    "--bwsc-bg": "#080c15",
    "--bwsc-item": "rgba(255,255,255,.035)",
    "--bwsc-border": "rgba(148,180,255,.12)",
    "--bwsc-accent": "#3b82f6",
    "--bwsc-accent-text": "#ffffff",
    "--bwsc-radius": "20px",
    "--bwsc-font": "\"Inter\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
};

/** Reown AppKit window (the real site's connect window): https://docs.reown.com/appkit/javascript/core/theming */
const REOWN_THEME = {
    mode: "dark",
    variables: {
        "--w3m-accent": "#3b82f6",
        "--w3m-color-mix": "#080c15",
        "--w3m-color-mix-strength": 40,
        "--w3m-border-radius-master": "2px",
        "--w3m-font-family": "\"Inter\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
        "--w3m-z-index": 2147483000,
    },
};

export { WALLET_MODE, WALLET_THEME, REOWN_THEME };
