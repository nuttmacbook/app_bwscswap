/*
 * ENGINE (same in every project, do not edit).
 *
 * Entry that src/engine/ui/app.js loads only while VITE_NETWORK=local (import.meta.glob on /deploy-kit/engine/web/devMode.js).
 * Builds the test panel from two lists:
 *   - common tools, here (every project): native coins for gas, each token, demo wallet
 *   - project tools, from deploy-kit/project/devActions.js (only this project)
 * Never part of a production build. (A BWSC node has no time travel, so there are no time buttons.)
 */

import { setLatency } from "../../../src/engine/chain/rpcMeter";
import { settings } from "../../../src/engine/settings";
import * as tools from "./devTools";
import { testPanel } from "./testPanel";
import { devActions } from "../../project/devActions";

const DEMO_ON_KEY = "bwsc.local.demoOn";

/** Called by src/engine/ui/app.js; returns the hooks it uses */
export function install({ refresh, notify, invalidateReads }) {
    // A local node answers in a millisecond; this makes pages load like on a public node
    setLatency(String(import.meta.env.VITE_RPC_LATENCY).split("-").map(Number));

    let isDemo = false;
    try { isDemo = localStorage.getItem(DEMO_ON_KEY) === "1"; } catch {}
    let current;
    let panelState = {};
    let symbol = "";

    /** Reads the active wallet's balances and the chain head for the panel (not counted in the page's reads) */
    const loadPanelState = async () => {
        const [ money, head ] = await Promise.all([
            tools.balances(current?.address).catch(() => ({ coins: 0n, tokens: {} })),
            tools.chainHead().catch(() => ({ block: 0, symbol })),
        ]);
        symbol = head.symbol || symbol;
        panelState = { wallet: current, isDemo: Boolean(current?.isDemo), ...money, block: head.block, symbol };
    };

    /** Runs a local-chain action with a progress toast, then reloads the panel and the page */
    const run = async (label, action) => {
        try {
            notify.progress({ title: label, desc: "Sending to the local chain…" });
            await action((desc) => notify.progress({ title: label, desc }));
            invalidateReads();
            await loadPanelState();
            await refresh({ quiet: true });
            notify.success({ title: label, desc: "Done on the local chain." });
        } catch (err) {
            console.error(err);
            notify.error(err);
        }
    };

    const setDemo = async (on) => {
        isDemo = Boolean(on);
        try { localStorage.setItem(DEMO_ON_KEY, isDemo ? "1" : "0"); } catch {}
        await refresh();
    };

    /* ------------------------------------ common tools (every project) */

    const commonActions = () => [
        { group: "Wallet", label: isDemo ? "Demo wallet: on" : "Demo wallet: off", run: () => setDemo(!isDemo), isInstant: true },
        { group: "Wallet", label: "New demo wallet", run: async () => { tools.resetDemoWallet(); await setDemo(true); }, isInstant: true },
        { group: "Money", label: `+${import.meta.env.VITE_DEV_FUND_GAS} ${symbol || "coins"} (gas)`, run: () => tools.fundGas(current?.address) },
        ...Object.keys(tools.testTokens).map((token) => ({
            group: "Money",
            label: `+${import.meta.env.VITE_DEV_FUND_AMOUNT} ${token}`,
            run: () => tools.fundToken(current?.address, token),
        })),
    ];

    window.devCommon = (index) => {
        const action = commonActions()[index];
        if (!action) return;
        if (action.isInstant) return action.run();
        run(action.label, () => action.run());
    };

    /* ------------------------------------ project tools (deploy-kit/project/devActions.js) */

    window.devProject = (index) => {
        const action = devActions?.[index];
        if (action) run(action.label, (progress) => action.run({ ...tools, wallet: current }, progress));
    };

    tools.chainHead().then((head) => { symbol = head.symbol; }).catch(() => {});

    return {
        // A connected wallet always wins; the demo wallet (a local key that signs real transactions) fills in otherwise
        wallet: (connected) => {
            const next = connected?.address ? connected : isDemo ? tools.demoWallet() : connected;
            if (next?.address !== current?.address) {
                current = next;
                loadPanelState().then(() => refresh({ quiet: true }));
            }
            current = next;
            return current;
        },
        panel: () => testPanel({ state: panelState, common: commonActions(), project: devActions ?? [] }),
        downMessage: async () => ((await tools.isChainUp()) ? null : `The local chain at ${settings.nodeUrl} is not running. Start it from deploy-kit/ with npm run dev.`),
    };
}
