/*
 * bwscbox — kitbox for BWSC (Program VM) chains.
 *
 *   import { bwscbox, utils } from "bwscbox";
 *   const box = new bwscbox({ node: "https://node.example", appName: "My dApp" });
 *   const modal = box.createModal("dark", { "--bwsc-accent": "#22d3ee" });
 *   box.safeRenderApp(async (state) => render(state));        // on load + every wallet / network change
 *   modal.open();                                              // connect / account window
 *   const tx = await box.createProgram(MyProgram, state.signer).deposit({ amount: 5n });
 *   await tx.wait();
 *
 * No dependencies. Wallets: every EIP-6963 browser wallet (MetaMask, Rabby, OKX, Trust, …) and window.ethereum.
 */

import { createClient, ChainError, DEFAULT_GAS_LIMIT } from "./client.js";
import { createWalletManager } from "./wallet.js";
import { createModal } from "./modal.js";
import { createProgram, createReader, handleTxError, tokenAt } from "./program.js";
import { walletSigner, keyWalletSigner } from "./signers.js";
import * as values from "./values.js";
import * as typedData from "./typedData.js";
import { nodeMessage } from "./messages.js";

class bwscbox {
    ZERO = values.ZERO;

    /**
     * @param {object} options
     * @param {string} options.node          node URL (https://…), the same one the wallet uses
     * @param {string} [options.appName]
     * @param {string} [options.storageKey]  localStorage key that remembers the chosen wallet
     * @param {number} [options.gasLimit]
     * @param {(path: string) => void} [options.onRequest]  every HTTP call to the node (for counters)
     */
    constructor({ node, appName = "", storageKey = "bwscbox.wallet", gasLimit = DEFAULT_GAS_LIMIT, onRequest } = {}) {
        this.appName = appName;
        this.client = createClient({ node, gasLimit, onRequest });
        this.wallet = createWalletManager({ client: this.client, storageKey });
    }

    /** The connect / account window: { open(), close() } */
    createModal(theme = "dark", themeVariables = {}) {
        this.modal = createModal(this.wallet, { theme, themeVariables, appName: this.appName });
        return this.modal;
    }

    /**
     * Calls render(state) once the saved wallet (if any) is back, then again whenever the account or network changes.
     * state = { address, chainId, isRightChain, walletName, signer } or null. Errors in render are logged, not thrown.
     */
    safeRenderApp(render) {
        const run = async (state) => { try { await render(state ?? null); } catch (error) { console.error(error); } };
        this.wallet.onChange(run);
        this.wallet.restore().catch(() => null).then((state) => run(state));
    }

    getCurrentState() { return this.wallet.current(); }
    connect(rdns) { return this.wallet.connect(rdns); }
    disconnect() { return this.wallet.disconnect(); }
    switchChain() { return this.wallet.ensureChain(); }
    /** { chainId, params } of the node (params = wallet_addEthereumChain values) */
    chainInfo() { return this.wallet.chainInfo(); }
    getCurrentRpc() { return this.client.node; }

    createProgram(program, signer) { return createProgram(this.client, program, signer); }
    createReader(program) { return createReader(this.client, program); }
    handleTxError(program, error) { return handleTxError(program, error); }
    tokenAt(address) { return tokenAt(address); }

    /** Send native coin (wei, bigint) → { hash, wait() } */
    async transferNative(to, amount, signer) {
        const sent = await this.client.send({ action: "transfer", to, value: String(amount) }, signer);
        return { ...sent, wait: (options) => this.client.waitReceipt(sent.hash, options) };
    }
}

const utils = {
    shortAddress: values.shortAddress,
    formNumber: values.formNumber,
    toUnits: values.toUnits,
    fromUnits: values.fromUnits,
    fromChainValue: values.fromChainValue,
    toChainValue: values.toChainValue,
    timestampToUTC: values.timestampToUTC,
    delay: values.delay,
    isAddress: values.isAddress,
};

export { bwscbox, utils, nodeMessage, ChainError, createClient, createWalletManager, createModal, createProgram, createReader, handleTxError, tokenAt, walletSigner, keyWalletSigner, typedData, values };
export default bwscbox;
