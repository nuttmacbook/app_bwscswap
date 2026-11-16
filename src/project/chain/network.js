/*
 * YOUR CODE (on-chain). The chain itself, for the home page: live numbers from the node (one GET /genesis) and the
 * values a wallet needs to add BWSC by hand. Nothing here needs a wallet.
 */

import { box } from "../../engine/chain/connect";
import { cachedRead } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { config } from "../../engine/settings";

const trim = (url) => String(url ?? "").replace(/\/+$/, "");
const big = (value) => {
    try { return value === undefined || value === null ? null : BigInt(String(value).replace(/n$/, "")); } catch { return null; }
};

/** What a wallet asks for when you add the network by hand (the same values the node's GET /evm gives) */
function networkDetails() {
    const hub = config.hub;
    return {
        name: hub.name,
        rpcUrl: `${trim(hub.nodeUrl)}/evm`,
        chainId: hub.chainId,
        symbol: hub.native?.symbol,
        explorerUrl: trim(hub.explorerUrl),
    };
}

/**
 * Live state of the chain → { isLive, chainId, latest, pending, baseFee (wei), burnPercent, burned (wei), maxBlockGas, gasTarget }.
 * A node that does not answer gives { isLive: false } (the page still shows everything else).
 */
async function getNetworkData({ fresh = false } = {}) {
    if (!box) return { isLive: false };
    try {
        // Counted like a program read, so the page's read meter shows it (node.genesis)
        const node = metered({ methods: { genesis: () => ({ call: () => box.client.genesis() }) } }, "node");
        const g = await cachedRead("network:genesis", () => node.methods.genesis().call(), { fresh, ttl: 4000 });
        return {
            isLive: true,
            chainId: Number(g?.chainId),
            latest: big(g?.latest),
            pending: big(g?.pending),
            baseFee: big(g?.baseFee ?? g?.gasPrice),
            burnPercent: g?.burnPercent === undefined ? null : Number(g.burnPercent),
            burned: big(g?.burned),
            maxBlockGas: big(g?.maxBlockGas),
            gasTarget: big(g?.gasTarget),
        };
    } catch {
        return { isLive: false };
    }
}

/**
 * Asks the connected wallet to add BWSC and switch to it (wallet_addEthereumChain). Returns false when no wallet is
 * connected, so the page can open the connect window instead (connecting adds the chain too).
 */
async function addNetworkToWallet(wallet) {
    if (!wallet?.provider?.request) return false;
    const hub = config.hub;
    const d = networkDetails();
    await wallet.provider.request({ method: "wallet_addEthereumChain", params: [ {
        chainId: `0x${Number(hub.chainId).toString(16)}`,
        chainName: hub.name,
        nativeCurrency: { name: hub.native?.name ?? hub.native?.symbol, symbol: hub.native?.symbol, decimals: Number(hub.native?.decimals ?? 18) },
        rpcUrls: [ d.rpcUrl ],
        blockExplorerUrls: d.explorerUrl ? [ d.explorerUrl ] : [],
    } ] });
    return true;
}

export { getNetworkData, networkDetails, addNetworkToWallet };
