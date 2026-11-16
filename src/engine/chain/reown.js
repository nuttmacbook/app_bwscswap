/*
 * ENGINE (do not edit). Wallet connection through Reown AppKit (WalletConnect): the only connect window of the site.
 * The site only asks the wallet to sign: EIP-712 typed data for BWSC programs (eth_signTypedData_v4) and, for the
 * bridge's steps on another chain (any chain in settings `chains`), that chain's own transaction. No email / social login wallets.
 *
 * It gives bwscbox the same wallet manager it would build itself (connect, restore, disconnect, ensureChain, current,
 * onChange), so the rest of the app does not know which connector is used.
 *
 * Settings: settings/config.js → wallet.reownProjectId (from https://dashboard.reown.com; add your domain there too),
 * hub (BWSC), chains (every chain in settings `chains`), app (name, description, siteUrl). The look comes from src/project/ui/theme.js.
 */

import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";
import { walletSigner, typedData } from "bwscbox";
import { verifyTypedData } from "ethers";

const lower = (value) => String(value ?? "").toLowerCase();
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The node only accepts a signature that recovers to `from`. Wallets get this wrong in three ways; each gets its own
 * message here, before anything is sent:
 *   a smart-contract account (Safe, smart wallets) signs in a form ecrecover cannot read,
 *   the wallet signs with another of its accounts (often WalletConnect apps after switching accounts in the app),
 *   the wallet hashes the typed data its own way (an address the wallet does not even list).
 */
async function checkSignature(provider, account, tx, signature) {
    const hex = String(signature ?? "");
    if (!/^0x[0-9a-fA-F]{130}$/.test(hex)) {
        throw new Error("This wallet signs with a smart-contract account, which BWSC cannot check. Use a regular account in your wallet (or another wallet) and try again.");
    }
    const typed = typedData.walletTypedData(tx);
    const { EIP712Domain, ...types } = typed.types;
    let signer = "";
    try { signer = lower(verifyTypedData(typed.domain, types, typed.message, hex)); } catch { signer = ""; }
    if (signer === account) return;
    const listed = await provider.request({ method: "eth_accounts" }).then((list) => (list ?? []).map(lower)).catch(() => []);
    if (signer && listed.includes(signer)) {
        throw new Error(`Your wallet signed with ${short(signer)}, but this site is connected to ${short(account)}. Switch your wallet to ${short(account)}, or disconnect and connect again with ${short(signer)}.`);
    }
    throw new Error("Your wallet did not sign exactly what this site sent, so BWSC would refuse it. Update the wallet app, or try MetaMask or Rabby.");
}
const trim = (url) => String(url ?? "").replace(/\/+$/, "");

/** A chain from settings/config.js as an AppKit network */
function networkOf({ chainId, name, native, rpcUrl, explorerUrl }) {
    return defineChain({
        id: chainId,
        caipNetworkId: `eip155:${chainId}`,
        chainNamespace: "eip155",
        name,
        nativeCurrency: { name: native?.name ?? native?.symbol, symbol: native?.symbol, decimals: Number(native?.decimals ?? 18) },
        rpcUrls: { default: { http: [ rpcUrl ] } },
        blockExplorers: explorerUrl ? { default: { name: `${name} explorer`, url: explorerUrl } } : undefined,
    });
}

/**
 * @param {object} options
 * @param {object} options.config   settings/config.js (merged)
 * @param {object} options.client   bwscbox client of the node (box.client)
 * @param {object} options.theme    { mode: "dark" | "light", variables: { "--w3m-accent": … } }
 * @returns {{ manager: object, modal: { open(), close() } }}
 */
export function createReownWallet({ config, client, theme = {} }) {
    const hub = config.hub;
    const nodeUrl = trim(hub.nodeUrl);
    // The node's EVM JSON-RPC (the same one GET /evm hands to wallets)
    const hubNetwork = networkOf({ ...hub, rpcUrl: `${nodeUrl}/evm`, explorerUrl: trim(hub.explorerUrl) || undefined });
    const otherNetworks = (config.chains ?? []).map((c) => networkOf(c));
    const siteUrl = trim(config.app?.siteUrl) || (typeof location !== "undefined" ? location.origin : "");

    const appKit = createAppKit({
        adapters: [ new EthersAdapter() ],
        networks: [ hubNetwork, ...otherNetworks ],
        defaultNetwork: hubNetwork,
        projectId: config.wallet.reownProjectId,
        metadata: {
            name: config.app?.name ?? "",
            description: config.app?.description ?? "",
            url: siteUrl,                                   // must be the site's own domain (Reown verifies it)
            icons: siteUrl ? [ `${siteUrl}/logo-512.png` ] : [],
        },
        // Signing only: no email / social wallets, no swaps or on-ramp inside the window
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false },
        allowUnsupportedChain: true,                        // the page shows "Wrong network" itself
        themeMode: theme.mode ?? "dark",
        themeVariables: theme.variables ?? {},
    });

    const listeners = new Set();
    let state = null;
    let provider = null;
    let account = { address: "", isConnected: false, status: "disconnected" };
    let chainId = null;

    const emit = () => listeners.forEach((listener) => { try { listener(state); } catch (error) { console.error(error); } });

    /** Switches the wallet to BWSC (AppKit adds the chain to the wallet when it does not know it) */
    async function ensureChain() {
        if (!provider) throw new Error("Wallet is not connected.");
        if (Number(await provider.request({ method: "eth_chainId" }).catch(() => 0)) === hub.chainId) return true;
        await appKit.switchNetwork(hubNetwork);
        return Number(await provider.request({ method: "eth_chainId" }).catch(() => 0)) === hub.chainId;
    }

    async function refresh() {
        const address = lower(account.address);
        if (!account.isConnected || !address || !provider) {
            const had = state !== null;
            state = null;
            if (had) emit();
            return;
        }
        const walletChain = Number(chainId ?? (await provider.request({ method: "eth_chainId" }).catch(() => 0)));
        const base = await walletSigner(provider, address);
        // Signing format 2: the wallet signs from whatever chain it has open (no switch, no "add network" needed)
        const signer = {
            address,
            signingChainId: base.signingChainId,
            signTransaction: async (tx) => {
                const signature = await base.signTransaction(tx);
                await checkSignature(provider, address, tx, signature);
                return signature;
            },
        };
        state = {
            address,
            chainId: walletChain,
            isRightChain: true,              // any chain can sign for BWSC (format 2)
            walletName: appKit.getWalletInfo?.()?.name ?? "Wallet",
            rdns: "reown",
            provider,
            signer,
        };
        emit();
    }

    let pending = null;
    const queueRefresh = () => {
        // Several AppKit events arrive together on connect; read them once
        clearTimeout(pending);
        pending = setTimeout(() => refresh().catch((error) => console.error(error)), 30);
    };

    appKit.subscribeAccount?.((next) => {
        account = { address: next?.address ?? "", isConnected: Boolean(next?.isConnected), status: next?.status ?? "" };
        queueRefresh();
    });
    appKit.subscribeNetwork?.((next) => {
        const id = Number(next?.chainId ?? String(next?.caipNetwork?.id ?? "").split(":").pop());
        chainId = Number.isFinite(id) && id > 0 ? id : null;
        queueRefresh();
    });
    appKit.subscribeProviders?.((providers) => {
        provider = providers?.eip155 ?? null;
        queueRefresh();
    });

    /** Resolves once AppKit has finished bringing back an earlier session (or there is none) */
    function restore() {
        return new Promise((resolve) => {
            const started = Date.now();
            const check = () => {
                const busy = account.status === "connecting" || account.status === "reconnecting" || (account.isConnected && !state);
                if (!busy || Date.now() - started > 4000) return resolve(state);
                setTimeout(check, 50);
            };
            setTimeout(check, 50);
        });
    }

    async function disconnect() {
        if (appKit.disconnect) await appKit.disconnect();
        else await appKit.adapter?.connectionControllerClient?.disconnect?.();
        state = null;
        emit();
    }

    const manager = {
        wallets: () => [],
        connect: () => appKit.open({ view: "Connect" }),
        restore,
        disconnect,
        ensureChain,
        chainInfo: async () => ({ chainId: hub.chainId, params: await client.chainParams().catch(() => null) }),
        current: () => state,
        onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };

    const modal = {
        // Connected: AppKit's account view (address, network, disconnect). Not connected: the wallet list / QR code
        open: () => appKit.open(state ? { view: "Account" } : { view: "Connect" }),
        close: () => appKit.close(),
    };

    return { manager, modal, appKit };
}
