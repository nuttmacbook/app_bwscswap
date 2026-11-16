/*
 * ENGINE (same in every project, do not edit).
 *
 * Runs the page: picks the page from the URL (#/name), reads its data, draws it, redraws when the wallet
 * changes, and runs transactions with toasts. Loads the dev test panel only on the local test chain (VITE_NETWORK=local).
 * src/project/ui/main.js tells it which pages exist; that file is where your project code goes.
 * If a setting is missing, it shows the list of what to fix instead of the page.
 */

import { box, modal } from "../chain/connect";
import { isUserReject } from "../chain/txError";
import { problems } from "../settings";
import { invalidateReads } from "../chain/cache";
import { startPage } from "../chain/rpcMeter";

// The test panel lives in deploy-kit/ and loads only on its local test chain (VITE_NETWORK=local) when that folder exists.
// Delete deploy-kit/ and this line finds nothing: the built site never contains it.
// Production builds never include them, and /dev can be left out of a production copy entirely.
// The condition reads import.meta.env directly so the bundler drops the branch (and the dev chunk) in production.
const loadDev = Object.values(import.meta.env.VITE_NETWORK === "local" ? import.meta.glob("/deploy-kit/engine/web/devMode.js") : {})[0];

/**
 * Starts the app.
 *
 * @param {object} options
 * @param {Record<string, { load: Function, view: Function, loading: string, error: Function }>} options.pages
 *        first one is the default page; #/name opens the others
 * @param {Function} options.header  (data) => html
 * @param {string} options.footer    html
 * @param {object} options.notify    toast functions (src/project/ui/componants/toast.js)
 * @returns {{ refresh: Function, runTx: Function, wallet: Function }}
 */
export function startApp({ pages, header, footer, notify }) {
    const root = document.getElementById("app");

    if (problems.length) {
        showProblems(root);
        return { refresh: async () => {}, runTx: async () => {}, wallet: () => null };
    }
    const names = Object.keys(pages ?? {});

    let wallet = null;
    let lastData = null;
    let paintId = 0;
    let dev = null;

    const activeWallet = () => (dev ? dev.wallet(wallet) : wallet);

    const currentPage = () => {
        const name = window.location.hash.replace(/^#\/?/, "").split("?")[0];
        return pages?.[name] ? name : names[0];
    };

    const paint = (body, data = lastData) => {
        if (!root) return;
        root.innerHTML = header({ ...data, wallet: activeWallet(), page: currentPage() }) + body + footer + (dev ? dev.panel(data) : "");
        document.body.dataset.page = currentPage();
    };

    /** Reads the current page's data and redraws it. A newer refresh wins over an older one. */
    async function refresh({ quiet = false, fresh = false } = {}) {
        const id = ++paintId;
        const name = currentPage();
        const page = pages[name];
        if (fresh) invalidateReads();
        startPage(name);
        if (!quiet || !lastData) paint(page.loading, lastData);

        try {
            const data = await page.load(activeWallet());
            if (id !== paintId) return;
            lastData = data;
            paint(page.view(data), data);
        } catch (err) {
            console.error(err);
            if (id !== paintId) return;
            const hint = dev ? await dev.downMessage() : null;
            paint(page.error(hint ?? "The network did not answer. Check your connection and try again."), lastData);
        }
    }

    let isBusy = false;
    /** Runs one transaction flow (a project/chain function) with the transaction popup, then redraws the page */
    async function runTx(action, success = {}) {
        // One transaction at a time: a second click while the popup is working does nothing (no double send)
        if (isBusy) return;
        isBusy = true;
        document.body.classList.add("tx-busy");
        try {
            notify.pending({ stage: "checking" });
            const current = box.getCurrentState();
            const signer = current?.address ? current : activeWallet();
            const receipt = await action(signer, { onStep: notify.pending });
            // explorerUrl: a transaction on another chain (one of settings `chains`) links to that chain's explorer
            notify.success({ ...success, hash: receipt?.transactionHash ?? receipt?.hash, explorerUrl: receipt?.explorerUrl ?? null });
            await refresh({ quiet: true });
        } catch (err) {
            // Closing the wallet prompt is a choice, not a failure: the toast says "Cancelled", the console stays clean
            if (isUserReject(err)) console.info("Cancelled in the wallet."); else console.error(err);
            notify.error(err);
        } finally {
            isBusy = false;
            document.body.classList.remove("tx-busy");
        }
    }

    const devReady = loadDev
        ? loadDev().then((m) => { dev = m.install({ refresh, notify, invalidateReads }); })
            .catch((err) => console.error("dev mode failed to load", err))
        : Promise.resolve();

    window.addEventListener("hashchange", () => { refresh(); window.scrollTo?.(0, 0); });

    // Called on load and whenever the wallet or network changes
    box.safeRenderApp(async (state) => {
        await devReady;
        wallet = state;
        await refresh();
    });

    return { refresh, runTx, wallet: () => activeWallet() };
}

/** Opens the wallet's connect / account window */
export const openWallet = () => modal?.open();

/** Shown instead of the page while settings are missing */
function showProblems(root) {
    const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!root) return;
    root.innerHTML = /*html*/`
        <main class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
            <div class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-sm text-amber-100" role="alert">
                <p class="font-semibold">Setup is not finished</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
                    ${[ ...new Set(problems) ].map((p) => /*html*/`<li>${escape(p)}</li>`).join("")}
                </ul>
                <p class="mt-3 text-amber-200/70">Fix these in settings/config.js, then rebuild (or restart npm run dev).</p>
            </div>
        </main>
    `;
}
