/*
 * ENGINE (same in every project, do not edit).
 *
 * Common test tools for the local chain, used by the test panel and handed to deploy-kit/project/devActions.js.
 * Every one sends real transactions to the local node. Works with zero, one or many tokens.
 * ethers comes from deploy-kit/node_modules (only the local test panel ever loads this file).
 */

import { ethers } from "ethers";
import { createClient, keyWalletSigner, createProgram, createReader, tokenAt, utils } from "bwscbox";
import { settings } from "../../../src/engine/settings";

const DEMO_KEY = "bwsc.local.demoKey";

const client = createClient({ node: settings.nodeUrl });

// Public test key (devKey 1), passed by deploy-kit/engine/start.mjs; pays coins and tokens for the panel
const funder = keyWalletSigner(new ethers.Wallet(import.meta.env.VITE_DEV_FUNDER_KEY));

/** Every token on the local chain: symbol → { address, decimals } (may be empty) */
const testTokens = (() => {
    try { return JSON.parse(import.meta.env.VITE_LOCAL_TEST_TOKENS ?? "{}"); } catch { return {}; }
})();

/* ------------------------------------ wallets */

/** A wallet whose key lives in this browser's localStorage; signs real transactions on the local chain */
function demoWallet() {
    let key = null;
    try { key = localStorage.getItem(DEMO_KEY); } catch {}
    if (!key) {
        key = ethers.Wallet.createRandom().privateKey;
        try { localStorage.setItem(DEMO_KEY, key); } catch {}
    }
    const signer = keyWalletSigner(new ethers.Wallet(key));
    // evmKey: the same key signs on every local EVM chain too (projects with a bridge; local only). bscKey: old name
    return { address: signer.address, signer, isDemo: true, evmKey: key, bscKey: key };
}

/** Throws away the demo wallet's key, so the next demoWallet() is a brand new person */
function resetDemoWallet() {
    try { localStorage.removeItem(DEMO_KEY); } catch {}
}

/** A fresh random person ({ address, signer }); fund it before use */
const newWallet = () => {
    const signer = keyWalletSigner(ethers.Wallet.createRandom());
    return { address: signer.address, signer };
};

/* ------------------------------------ money */

const wait = async (sent) => client.waitReceipt(sent.hash, { timeoutMs: 60_000 });

/** Sends `coins` (whole native coins) for gas */
async function fundGas(address, coins = import.meta.env.VITE_DEV_FUND_GAS) {
    if (!address) throw new Error("Connect a wallet or turn on the demo wallet first.");
    await wait(await client.send({ action: "transfer", to: address, value: String(utils.toUnits(String(coins), 18)) }, funder));
}

/** Sends `amount` whole tokens of `symbol` from the funder */
async function fundToken(address, symbol, amount = import.meta.env.VITE_DEV_FUND_AMOUNT) {
    if (!address) throw new Error("Connect a wallet or turn on the demo wallet first.");
    const token = testTokens[symbol];
    if (!token) throw new Error(`No token ${symbol} on the local chain.`);
    const tx = await createProgram(client, tokenAt(token.address), funder).transfer(utils.toChainValue({ to: address, amount: utils.toUnits(String(amount), token.decimals) }));
    await tx.wait();
}

/** Token program by symbol, sending as `signer` ({ address, signTransaction }) */
const tokenAs = (symbol, signer) => {
    const token = testTokens[symbol];
    if (!token) throw new Error(`No token ${symbol} on the local chain.`);
    return createProgram(client, tokenAt(token.address), signer);
};

/** Any program descriptor ({ name, address }) sending as `signer`; read with readerOf(program) */
const programAs = (program, signer) => createProgram(client, program, signer);
const readerOf = (program) => createReader(client, program);

/* ------------------------------------ panel state */

/** Native coins and every token for one address (the panel's own reads; not counted for the page) */
async function balances(address) {
    if (!address) return { coins: 0n, tokens: {} };
    const entries = await Promise.all(Object.entries(testTokens).map(async ([ symbol, t ]) => [ symbol, await createReader(client, tokenAt(t.address)).read.balanceOf({ who: address }).catch(() => 0n) ]));
    return { coins: await client.balance(address), tokens: Object.fromEntries(entries) };
}

/** Latest block number and time (ms) */
async function chainHead() {
    const genesis = await client.genesis();
    return { block: Number(genesis?.latest ?? 0), symbol: (await client.chainParams().catch(() => null))?.nativeCurrency?.symbol ?? "" };
}

const isChainUp = async () => {
    try { await client.genesis(); return true; } catch { return false; }
};

export { client, funder, testTokens, demoWallet, resetDemoWallet, newWallet, fundGas, fundToken, tokenAs, programAs, readerOf, balances, chainHead, isChainUp, ethers, utils };
