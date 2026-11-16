/*
 * YOUR CODE (on-chain). The bridge: BWSC is the hub, every chain in settings/config.js `chains` bridges with it.
 * One read on BWSC and one per chain; bridging, and claiming with a signed running total.
 *
 *   chain → BWSC   bridgeIn on that chain (a token: approve first; its own coin: value)  → claimIn on BWSC
 *   BWSC → chain   bridgeOut on BWSC (native: value)                                     → claimOut on that chain
 *
 * A route is one coin on BWSC paired with one coin on another chain (any mix of tokens and native coins). It counts
 * only when both bridges list it and point at each other. "Waiting to claim" comes straight from the two chains:
 * (running total on the source) − (claimed on the destination). The signature is fetched only when someone presses Claim.
 * Missing settings never stop the site: the bridge page lists them instead.
 *
 * Any number of chains: they are read in parallel, each with its own time limit, so one slow or broken chain only
 * marks that chain "not available" and never holds up the others. Adding a chain = one entry in `chains`.
 */

import { ethers } from "ethers";
import { box } from "../../engine/chain/connect";
import { cachedRead, invalidateReads } from "../../engine/chain/cache";
import { metered } from "../../engine/chain/rpcMeter";
import { normalize } from "../../engine/chain/txError";
import { approveIfNeeded } from "../../engine/chain/token";
import { config, settings, ZERO } from "../../engine/settings";
import { BridgeProgram } from "./programs";
import { BRIDGE_EVM_ABI } from "./abi/evmBridge";
import { ERC20_ABI } from "./abi/erc20";
import { HUB, CHAINS, chainOf, coinOf } from "./coins";

const PAGE = 100n;
const SIGNER_URL = String(config.bridgeSigner?.url ?? "").replace(/\/+$/, "");
// The signer's relayer delivers every transfer by itself (settings bridgeSigner.autoDeliver, on unless false)
const AUTO_DELIVER = config.bridgeSigner?.autoDeliver !== false;
const lower = (a) => String(a ?? "").toLowerCase();
const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };
const OTHERS = CHAINS.filter((c) => !c.isHub);
// How long one chain may take to answer before the page shows it as not available (the others still show)
const CHAIN_TIMEOUT_MS = 10_000;

/** load(), or an error after `ms` */
const withTimeout = (load, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { isTimeout: true })), ms);
    load().then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/** What is missing before the bridge can run at all, and per chain */
function bridgeSetup() {
    const missing = [];
    if (BridgeProgram.address === ZERO) missing.push("settings/config.js: programs.bridge (the BwscBridge program) is empty.");
    if (!OTHERS.length) missing.push("settings/config.js: chains has no other chain to bridge with.");
    if (!SIGNER_URL) missing.push("settings/config.js: bridgeSigner.url is empty.");
    return missing;
}
const chainProblem = (c) => (!c.rpcUrl ? (settings.isLocal ? "The local chain is not running (install Foundry for anvil)." : "rpcUrl is empty.") : !/^0x[0-9a-f]{40}$/.test(c.bridge) ? "bridge (the BwscBridgeEvm proxy) is empty." : "");

const providers = new Map();
const providerOf = (c) => {
    if (!providers.has(c.key)) providers.set(c.key, new ethers.JsonRpcProvider(c.rpcUrl, c.chainId, { staticNetwork: true, cacheTimeout: -1 }));
    return providers.get(c.key);
};
const evmBridge = (c, runner = providerOf(c)) => new ethers.Contract(c.bridge, BRIDGE_EVM_ABI, runner);
const hubBridge = () => metered(box.createReader(BridgeProgram), "BwscBridge");
const txLink = (c, hash) => (hash && c.explorerUrl ? `${c.explorerUrl}/tx/${hash}` : null);

/* ------------------------------------ reading */

async function readHub(who, fresh) {
    const views = [];
    for (let offset = 0n; ; offset += PAGE) {
        const v = await cachedRead(`bridge:hub:${who}:${offset}`, () => hubBridge().methods.getView({ account: who, offset: `${offset}n`, limit: `${PAGE}n` }).call(), { fresh });
        views.push(v);
        if (offset + PAGE >= big(v.routeCount)) break;
    }
    return { ...views[0], routes: views.flatMap((v) => v.routes), coins: views.flatMap((v) => v.coins) };
}

async function readChain(c, who, fresh) {
    const views = [];
    for (let offset = 0n; ; offset += PAGE) {
        const v = await cachedRead(`bridge:${c.key}:${who}:${offset}`, () => evmBridge(c).getBridgeView(who || ZERO, offset, PAGE), { fresh });
        views.push(v);
        if (offset + PAGE >= big(v.routeCount)) break;
    }
    return { chainId: Number(views[0].chainId), remoteChainId: Number(views[0].remoteChainId), paused: views[0].paused, routes: views.flatMap((v) => [ ...v.routes ]) };
}

/**
 * Everything the bridge page needs.
 * @returns {{ isReady, missing, chains: [{ ...chain, problem, paused }], routes: [{ id, chain, hub, remote, waitingIn, waitingOut }] }}
 *   hub / remote: { coin, address, isNative, enabled, feeBps, min, balance, allowance, available, … running totals }
 *   waitingIn  = chain → BWSC, claimable on BWSC · waitingOut = BWSC → chain, claimable on that chain
 */
async function getBridgeData(wallet, { fresh = false } = {}) {
    const base = { wallet, isConnected: Boolean(wallet?.address) };
    const missing = bridgeSetup();
    if (BridgeProgram.address === ZERO || !SIGNER_URL) return { ...base, isReady: false, missing, chains: CHAINS, routes: [] };
    const who = lower(wallet?.address);
    const hub = await readHub(who, fresh);
    const chains = await Promise.all(OTHERS.map(async (c) => {
        const problem = chainProblem(c);
        if (problem) return { ...c, problem };
        try {
            const view = await withTimeout(() => readChain(c, who, fresh), CHAIN_TIMEOUT_MS);
            if (view.chainId !== Number(c.chainId)) return { ...c, problem: `its RPC is chain ${view.chainId}, not ${c.chainId} (check rpcUrl).` };
            if (view.remoteChainId !== Number(hub.chainId)) return { ...c, problem: `its bridge works with chain ${view.remoteChainId}, not this one (${hub.chainId}).` };
            return { ...c, view, paused: view.paused };
        } catch (error) {
            return { ...c, problem: error?.isTimeout ? "did not answer in time." : "could not be read right now." };
        }
    }));
    const hubCoins = new Map(hub.coins.map((x) => [ lower(x.address), x ]));
    const routes = [];
    for (const r of hub.routes) {
        const c = chains.find((x) => Number(x.chainId) === Number(r.chainId));
        if (!c?.view) continue;
        const e = c.view.routes.find((x) => lower(x.token) === lower(r.remoteToken));
        // Both bridges must point at each other
        if (!e || lower(e.remoteToken) !== lower(r.token)) continue;
        const hc = hubCoins.get(lower(r.token)) ?? {};
        const hubSide = {
            coin: coinOf(HUB, { address: r.token, symbol: hc.symbol, name: hc.name, decimals: Number(hc.decimals ?? 18), balance: big(hc.balance) }),
            address: lower(r.token), isNative: lower(r.token) === ZERO, enabled: r.enabled === true, feeBps: Number(r.feeBps), min: big(r.min),
            balance: big(hc.balance), allowance: big(hc.allowance), available: big(hc.available), bridgedOut: big(r.bridgedOut), claimedIn: big(r.claimedIn),
        };
        const remoteSide = {
            coin: coinOf(c.key, { address: e.token, symbol: e.symbol, decimals: Number(e.decimals), balance: big(e.balance) }),
            address: lower(e.token), isNative: e.isNative, enabled: e.enabled, feeBps: Number(e.feeBps), min: big(e.min),
            balance: big(e.balance), allowance: big(e.allowance), available: big(e.available), bridgedIn: big(e.bridgedIn), claimedOut: big(e.claimedOut),
        };
        routes.push({
            id: `${c.key}:${hubSide.address}`,
            chain: { key: c.key, name: c.name, short: c.short, chainId: c.chainId },
            hub: hubSide,
            remote: remoteSide,
            waitingIn: remoteSide.bridgedIn > hubSide.claimedIn ? remoteSide.bridgedIn - hubSide.claimedIn : 0n,
            waitingOut: hubSide.bridgedOut > remoteSide.claimedOut ? hubSide.bridgedOut - remoteSide.claimedOut : 0n,
        });
    }
    return {
        ...base,
        isReady: true,
        missing,
        hubPaused: hub.paused === true,
        hubChainId: Number(hub.chainId),
        chains: [ { ...CHAINS[0], paused: hub.paused === true }, ...chains ],
        routes,
    };
}

/* ------------------------------------ the wallet on another chain */

const hex = (n) => `0x${Number(n).toString(16)}`;

/** Asks the wallet to switch to `chainId` (adds the chain when the wallet does not know it) */
async function switchTo(provider, chainId, addParams) {
    const current = Number(await provider.request({ method: "eth_chainId" }));
    if (current === Number(chainId)) return;
    try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [ { chainId: hex(chainId) } ] });
    } catch (error) {
        if ((error?.code !== 4902 && error?.data?.originalError?.code !== 4902) || !addParams) throw error;
        await provider.request({ method: "wallet_addEthereumChain", params: [ addParams ] });
    }
}

/** An ethers signer on chain `c` for this wallet: the demo wallet's own key locally, otherwise the browser wallet */
async function signerOn(wallet, c) {
    const cfg = (config.chains ?? []).find((x) => x.key === c.key) ?? {};
    // The local demo wallet signs on every local chain with its own key (local test chain only)
    const demoKey = wallet?.evmKey ?? wallet?.bscKey;
    if (demoKey) return new ethers.Wallet(demoKey, providerOf(chainOf(c.key)));
    if (!wallet?.provider) throw new Error("Connect a wallet first.");
    await switchTo(wallet.provider, c.chainId, {
        chainId: hex(c.chainId), chainName: c.name, nativeCurrency: cfg.native ?? { name: c.short, symbol: c.short, decimals: 18 },
        rpcUrls: [ cfg.rpcUrl ], blockExplorerUrls: cfg.explorerUrl ? [ cfg.explorerUrl ] : [],
    });
    const signer = await new ethers.BrowserProvider(wallet.provider).getSigner(wallet.address);
    if (lower(await signer.getAddress()) !== lower(wallet.address)) throw new Error("The wallet switched account. Try again.");
    return signer;
}

/** EVM revert → a sentence (the contract's own reason when there is one) */
function evmError(error, fallback) {
    if (error?.code === "ACTION_REJECTED" || error?.code === 4001 || error?.info?.error?.code === 4001) {
        const e = new Error("Cancelled in the wallet.");
        e.isUserReject = true;
        e.code = 4001;
        return e;
    }
    const reason = error?.reason ?? error?.revert?.args?.[0] ?? error?.shortMessage ?? error?.message;
    return new Error(reason ? `${fallback} ${String(reason).replace(/^execution reverted: ?/, "")}` : fallback);
}

/* ------------------------------------ transactions */

const routeOf = (data, id) => {
    const r = data.routes.find((x) => x.id === id);
    if (!r) throw new Error("That route is not in the bridge.");
    return r;
};
const GAS_RESERVE = 10n ** 16n;

/**
 * Sends coins into the bridge on the source chain.
 * @param {object} order  { route: id, direction: "out" (BWSC → chain) | "in" (chain → BWSC), amount (bigint) }
 */
async function bridgeTokens(wallet, { route, direction, amount }, { onStep = () => {} } = {}) {
    if (!wallet?.address) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getBridgeData(wallet, { fresh: true });
    if (!data.isReady) throw new Error(data.missing[0]);
    const r = routeOf(data, route);
    const side = direction === "out" ? r.hub : r.remote;
    const where = direction === "out" ? CHAINS[0].name : r.chain.name;
    const paused = direction === "out" ? data.hubPaused : data.chains.find((c) => c.key === r.chain.key)?.paused;
    if (paused) throw new Error("The bridge is paused by its owner.");
    if (!side.enabled) throw new Error(`${side.coin.symbol} cannot be bridged from ${where} right now.`);
    if (!(amount > 0n)) throw new Error("Enter an amount.");
    if (amount < side.min) throw new Error(`The smallest transfer is ${ethers.formatUnits(side.min, side.coin.decimals)} ${side.coin.symbol}.`);
    if (amount > side.balance) throw new Error(`Not enough ${side.coin.symbol} on ${where}.`);
    if (side.isNative && amount > side.balance - GAS_RESERVE) throw new Error(`Keep some ${side.coin.symbol} for gas.`);

    if (direction === "out") {
        const needsApprove = !side.isNative && side.allowance < amount;
        const total = needsApprove ? 2 : 1;
        if (needsApprove) await approveIfNeeded({ wallet, token: side.address, spender: BridgeProgram.address, amount, allowance: side.allowance, onStep, index: 1, total });
        onStep({ stage: "bridge", index: total, total });
        try {
            const tx = await box.createProgram(BridgeProgram, wallet.signer).bridgeOut({ chainId: `${r.chain.chainId}n`, token: side.address, amount: `${amount}n` }, side.isNative ? { value: String(amount) } : {});
            onStep({ stage: "bridging", index: total, total });
            const receipt = await tx.wait();
            invalidateReads();
            tellRelayer(HUB, r.chain.key, wallet.address, side.address, null);
            return receipt;
        } catch (error) {
            throw normalize(error, box.handleTxError(BridgeProgram, error), "The bridge did not take it.");
        }
    }

    // From another chain: the wallet signs there, then goes back to BWSC
    const c = chainOf(r.chain.key);
    try {
        const signer = await signerOn(wallet, c);
        const needsApprove = !side.isNative && side.allowance < amount;
        const total = needsApprove ? 2 : 1;
        if (needsApprove) {
            onStep({ stage: "approve", index: 1, total });
            const approveTx = await new ethers.Contract(side.address, ERC20_ABI, signer).approve(c.bridge, amount);
            onStep({ stage: "approving", index: 1, total });
            await approveTx.wait();
        }
        onStep({ stage: "bridge", index: total, total });
        const tx = await evmBridge(c, signer).bridgeIn(side.address, amount, side.isNative ? { value: amount } : {});
        onStep({ stage: "bridging", index: total, total });
        const receipt = await tx.wait();
        invalidateReads();
        tellRelayer(c.key, HUB, wallet.address, side.address, receipt.blockNumber);
        return { transactionHash: receipt.hash, explorerUrl: txLink(c, receipt.hash) ?? "", chain: c.key };
    } catch (error) {
        throw evmError(error, `${c.name} did not take it.`);
    }
}

/**
 * Tells the relayer about a transfer that just went in, so it delivers it at once (it would also find it by itself
 * within seconds). Never fails the transfer: the coins are safe in the bridge either way.
 */
function tellRelayer(from, to, account, sourceToken, block) {
    if (!AUTO_DELIVER || !SIGNER_URL) return;
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&account=${lower(account)}&token=${lower(sourceToken)}${block ? `&block=${Number(block)}` : ""}`;
    fetch(`${SIGNER_URL}/deliver?${q}`).catch(() => {});
}

/** Asks the bridge signer for the signed running total (the source chain's coin address) */
async function fetchClaim(from, to, account, sourceToken) {
    let res;
    try {
        res = await fetch(`${SIGNER_URL}/claim?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&account=${account}&token=${sourceToken}`);
    } catch {
        throw new Error("The bridge signer did not answer. Try again in a minute.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "The bridge signer could not sign right now.");
    return body;
}

/**
 * Claims everything waiting on the destination, for this wallet. Anyone could send it; here the wallet does.
 * @param {object} order  { route: id, to: "hub" (claim on BWSC) | "remote" (claim on the other chain) }
 */
async function claimBridge(wallet, { route, to }, { onStep = () => {} } = {}) {
    if (!wallet?.address) throw new Error("Wallet is not connected.");
    onStep({ stage: "checking" });
    const data = await getBridgeData(wallet, { fresh: true });
    if (!data.isReady) throw new Error(data.missing[0]);
    const r = routeOf(data, route);
    const toHub = to === "hub";
    const waiting = toHub ? r.waitingIn : r.waitingOut;
    if (!(waiting > 0n)) throw new Error("Nothing is waiting to be claimed.");
    const paused = toHub ? data.hubPaused : data.chains.find((c) => c.key === r.chain.key)?.paused;
    if (paused) throw new Error("The bridge is paused by its owner.");

    onStep({ stage: "signature", index: 1, total: 2 });
    const from = toHub ? r.chain.key : HUB;
    const dest = toHub ? HUB : r.chain.key;
    const signed = await fetchClaim(from, dest, lower(wallet.address), toHub ? r.remote.address : r.hub.address);
    // Never trust the signer's answer blindly: it must be for this wallet, this coin and this chain
    const destToken = toHub ? r.hub.address : r.remote.address;
    if (lower(signed.account) !== lower(wallet.address) || lower(signed.token) !== destToken || Number(signed.chainId) !== Number(toHub ? data.hubChainId : r.chain.chainId)) {
        throw new Error("The bridge signer answered for another account, coin or chain. Nothing was sent.");
    }
    const already = toHub ? r.hub.claimedIn : r.remote.claimedOut;
    if (!signed.signature || BigInt(signed.total) <= already) {
        throw new Error(toHub ? `Your deposit on ${r.chain.name} is waiting for ${signed.confirmations} confirmations. Try again in a minute.` : "The bridge signer has not seen it yet. Try again in a minute.");
    }
    const paying = BigInt(signed.total) - already;
    const available = toHub ? r.hub.available : r.remote.available;
    const sym = toHub ? r.hub.coin.symbol : r.remote.coin.symbol;
    if (paying > available) throw new Error(`The bridge is short of ${sym} right now. Your claim is safe: try again later.`);

    onStep({ stage: "claim", index: 2, total: 2 });
    if (toHub) {
        try {
            const tx = await box.createProgram(BridgeProgram, wallet.signer).claimIn({ chainId: `${r.chain.chainId}n`, account: signed.account, token: signed.token, total: `${signed.total}n`, signature: signed.signature });
            onStep({ stage: "claiming", index: 2, total: 2 });
            const receipt = await tx.wait();
            invalidateReads();
            return receipt;
        } catch (error) {
            throw normalize(error, box.handleTxError(BridgeProgram, error), "The claim did not go through.");
        }
    }
    const c = chainOf(r.chain.key);
    try {
        const signer = await signerOn(wallet, c);
        const tx = await evmBridge(c, signer).claimOut(signed.account, signed.token, BigInt(signed.total), signed.signature);
        onStep({ stage: "claiming", index: 2, total: 2 });
        const receipt = await tx.wait();
        invalidateReads();
        return { transactionHash: receipt.hash, explorerUrl: txLink(c, receipt.hash) ?? "", chain: c.key };
    } catch (error) {
        throw evmError(error, `The claim did not go through on ${c.name}.`);
    }
}

export { getBridgeData, bridgeTokens, claimBridge, bridgeSetup, AUTO_DELIVER };
