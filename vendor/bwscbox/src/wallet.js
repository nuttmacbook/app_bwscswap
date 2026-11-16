/*
 * Browser wallets: finds them (EIP-6963, plus window.ethereum for older wallets), connects, remembers the choice,
 * keeps the wallet on the right chain (adds the chain from the node's GET /evm the first time) and reports changes.
 */

import { walletSigner } from "./signers.js";

const hex = (n) => `0x${Number(n).toString(16)}`;
const SWITCH_UNKNOWN_CHAIN = 4902;

/**
 * @param {object} options
 * @param {object} options.client      createClient(...) of the node
 * @param {string} [options.storageKey] where the chosen wallet is remembered (localStorage)
 */
export function createWalletManager({ client, storageKey = "bwscbox.wallet" }) {
    const found = new Map();      // rdns → { info, provider }
    const listeners = new Set();
    let state = null;             // { address, chainId, isRightChain, walletName, rdns, provider, signer }
    let chain = null;             // { chainId (number), params } from the node, read once
    let detach = () => {};

    const hasWindow = typeof window !== "undefined";
    const storage = {
        get: () => { try { return hasWindow ? window.localStorage.getItem(storageKey) : null; } catch { return null; } },
        set: (value) => { try { if (hasWindow) value ? window.localStorage.setItem(storageKey, value) : window.localStorage.removeItem(storageKey); } catch {} },
    };

    /* ---------------------------------------------------------------- discovery */

    if (hasWindow) {
        window.addEventListener("eip6963:announceProvider", (event) => {
            const { info, provider } = event?.detail ?? {};
            if (info?.rdns && provider) found.set(info.rdns, { info, provider });
        });
        window.dispatchEvent(new Event("eip6963:requestProvider"));
    }

    /** Wallets in this browser: [{ rdns, name, icon }] (window.ethereum appears as "injected" when nothing announced itself) */
    const wallets = () => {
        const list = [ ...found.values() ].map(({ info }) => ({ rdns: info.rdns, name: info.name, icon: info.icon }));
        if (!list.length && hasWindow && window.ethereum) list.push({ rdns: "injected", name: window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", icon: "" });
        return list;
    };
    const providerOf = (rdns) => (rdns === "injected" ? (hasWindow ? window.ethereum : null) : found.get(rdns)?.provider ?? null);

    /* ---------------------------------------------------------------- chain */

    async function chainInfo() {
        if (chain) return chain;
        const [ genesis, params ] = await Promise.all([ client.genesis(), client.chainParams().catch(() => null) ]);
        chain = { chainId: Number(genesis?.chainId), params };
        return chain;
    }

    /** Switches the wallet to the node's chain, adding it first when the wallet does not know it */
    async function ensureChain(provider = state?.provider) {
        if (!provider) throw new Error("Wallet is not connected.");
        const { chainId, params } = await chainInfo();
        const current = Number(await provider.request({ method: "eth_chainId" }));
        if (current === chainId) return true;
        try {
            await provider.request({ method: "wallet_switchEthereumChain", params: [ { chainId: hex(chainId) } ] });
        } catch (error) {
            const code = error?.code ?? error?.data?.originalError?.code;
            if (code !== SWITCH_UNKNOWN_CHAIN && !/unrecognized|not added|unknown chain/i.test(String(error?.message))) throw error;
            if (!params?.rpcUrls?.length) throw new Error("This chain is not in your wallet yet, and the node did not say how to add it (GET /evm).");
            await provider.request({ method: "wallet_addEthereumChain", params: [ params ] });
        }
        return Number(await provider.request({ method: "eth_chainId" })) === chainId;
    }

    /* ---------------------------------------------------------------- state */

    const emit = () => listeners.forEach((listener) => { try { listener(state); } catch (error) { console.error(error); } });

    async function readState(rdns, provider, accounts) {
        const address = String(accounts?.[0] ?? "").toLowerCase();
        if (!address) return null;
        const { chainId } = await chainInfo().catch(() => ({ chainId: null }));
        const walletChain = Number(await provider.request({ method: "eth_chainId" }).catch(() => 0));
        // Signing format 2: the wallet signs from any chain it has open, so there is no "wrong network" for BWSC
        const signer = await walletSigner(provider, address);
        const name = wallets().find((w) => w.rdns === rdns)?.name ?? "Wallet";
        return { address, chainId: walletChain, chainIdOfNode: chainId, isRightChain: true, walletName: name, rdns, provider, signer };
    }

    function watch(rdns, provider) {
        detach();
        const onAccounts = async (accounts) => { state = await readState(rdns, provider, accounts); if (!state) storage.set(null); emit(); };
        const onChain = async () => { state = await readState(rdns, provider, await provider.request({ method: "eth_accounts" })); emit(); };
        provider.on?.("accountsChanged", onAccounts);
        provider.on?.("chainChanged", onChain);
        detach = () => {
            provider.removeListener?.("accountsChanged", onAccounts);
            provider.removeListener?.("chainChanged", onChain);
        };
    }

    /** Asks the wallet for access (shows the wallet's prompt). No chain switch: any chain can sign. */
    async function connect(rdns) {
        const provider = providerOf(rdns);
        if (!provider) throw new Error("That wallet is not available in this browser.");
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        state = await readState(rdns, provider, accounts);
        storage.set(rdns);
        watch(rdns, provider);
        emit();
        return state;
    }

    /** Reconnects silently on page load when the visitor connected before (no prompt) */
    async function restore() {
        const rdns = storage.get();
        if (!rdns) return null;
        // Wallets announce themselves right after load; give them a moment
        for (let i = 0; i < 10 && !providerOf(rdns); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        const provider = providerOf(rdns);
        if (!provider) return null;
        const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
        state = await readState(rdns, provider, accounts);
        // A locked wallet answers no accounts: keep the choice and listen, so unlocking reconnects without a new prompt
        watch(rdns, provider);
        return state;
    }

    async function disconnect() {
        const provider = state?.provider;
        detach();
        state = null;
        storage.set(null);
        // MetaMask can drop the site's permission; other wallets just forget us on our side
        await provider?.request?.({ method: "wallet_revokePermissions", params: [ { eth_accounts: {} } ] }).catch(() => {});
        emit();
    }

    return {
        wallets,
        connect,
        restore,
        disconnect,
        ensureChain: () => ensureChain(),
        chainInfo,
        current: () => state,
        onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
}
