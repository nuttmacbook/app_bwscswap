/*
 * ENGINE (same in every project, do not edit). Wallet window, node, bwscbox utils.
 * Every value comes from settings/config.js through src/engine/settings.js; nothing is written here.
 *
 * Wallets connect through Reown AppKit (reown.js) only. The one exception is deploy-kit's local test chain
 * (VITE_NETWORK=local, never in a real build): its browser tests drive a stand-in wallet with bwscbox's own window.
 * The wallet window's look comes from src/project/ui/theme.js (design, not a setting).
 */

import { bwscbox, utils } from "bwscbox";
import { config, settings, problems } from "../settings";
import { countRequest } from "./rpcMeter";
import { createReownWallet } from "./reown";
import { REOWN_THEME, WALLET_THEME, WALLET_MODE } from "../../project/ui/theme";

const IS_LOCAL = settings.isLocal;

// Only talk to a node when the settings are complete; otherwise the page shows what is missing
const box = problems.length ? null : new bwscbox({ node: settings.nodeUrl, appName: settings.appName, storageKey: `bwscbox.wallet.${settings.network}`, onRequest: countRequest });

function walletWindow() {
    if (!box) return null;
    if (IS_LOCAL) return box.createModal(WALLET_MODE, WALLET_THEME);
    const reown = createReownWallet({ config, client: box.client, theme: REOWN_THEME });
    box.wallet = reown.manager;     // bwscbox reads box.wallet on every call (render, current state, switch network)
    box.modal = reown.modal;
    return reown.modal;
}
const modal = walletWindow();

const { shortAddress, timestampToUTC, delay, toUnits, fromUnits } = utils;

/** Explorer link for a transaction (the node's explorer shows the hash or the signed digest) */
const txUrl = (hash) => (hash && settings.explorerUrl ? `${settings.explorerUrl}/#tx/${hash}` : null);
const addressUrl = (address) => (address && settings.explorerUrl ? `${settings.explorerUrl}/#address/${address}` : null);

export { box, modal, IS_LOCAL, txUrl, addressUrl, shortAddress, timestampToUTC, delay, toUnits, fromUnits };
