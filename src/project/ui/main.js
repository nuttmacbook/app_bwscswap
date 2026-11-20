/*
 * YOUR CODE (off-chain). The website in one place:
 *   1. which pages exist
 *   2. what each button does
 * Blockchain work comes from src/project/chain (imported, never written here).
 * Drawing, wallet changes and loading are handled by src/engine/ui/app.js. Settings: settings/config.js.
 */

import "./main.css";
import { startApp, openWallet } from "../../engine/ui/app";
import { getNetworkData, addNetworkToWallet, getDexData, swapCoins, addLiquidity, removeLiquidity, createPair,
    getBridgeData, bridgeTokens, claimBridge, getStakeData, stakeTokens, claimStake, addStakeReward, createStakePool,
    placeLimitOrder, fillLimitOrder, cancelLimitOrder, addLimitCoin, setLimitCoin, withdrawLimitFees } from "../chain";
import { AUTO_DELIVER } from "../chain/bridge";
import { header, refreshPrice } from "./componants/header";
import { footer } from "./componants/footer";
import { notify } from "./componants/toast";
import { home, homeLoading, homeError } from "./pages/home";
import { swapPage, swapLoading, swapError, swapInput, swapOutInput, swapMax, swapConfirmImpact, swapSettingsToggle, swapSlippage, swapSlippageCustom, swapDeadline, swapFlip, swapPick, swapReset, swapOrder } from "./pages/swap";
import { bridgePage, bridgeInput, bridgeFlip, bridgeChain, bridgeUse, bridgePick, bridgeMax, bridgeOrder, bridgeReset, bridgeLoadingOf, bridgeError } from "./pages/bridge";
import { stakePage, stakeFilter, stakeMore, stakeSearch, stakeNewId, stakeNewPick, newPoolOrder, newPoolReset, stakeOpen, stakeMode, stakeInput, stakeMax, stakeReset, stakeOrder,
    stakeLoadingOf, stakeError, rewardOpen, rewardInput, rewardOrder, rewardReset } from "./pages/stake";
import { poolPage, poolLoading, poolError, poolInput, poolPercent, poolOpen, poolNative, poolFilter, poolMore, poolSearch, poolReset,
    poolNewPick, poolNewFee, addOrder, removeOrder, newPairOrder, newPairReset } from "./pages/pool";
import * as limit from "./pages/limit";
import { appsPage, appPage, appsCategory, appsSort, appsBadge, appsMore, appsSearch } from "./pages/apps";
import { openSearch, listenForSearchKeys } from "./componants/search";
import { copyCode } from "./code";
import { docsPage, docsSearch, docsMenu, docsCloseMenu, docsJump } from "./pages/docs";
import * as send from "./pages/send";
import { multiSend } from "../chain";

/* ------------------------------------ 1. pages (the first one opens by default; others at #/name) */

const pages = {
    // The landing page: the chain's live numbers (one read)
    home: {
        load: async () => ({ network: await getNetworkData() }),
        view: home, loading: homeLoading, error: homeError,
    },
    swap: { load: getDexData, view: swapPage, loading: swapLoading, error: swapError },
    pool: { load: getDexData, view: poolPage, loading: poolLoading, error: poolError },
    // One read on BWSC and one per other chain
    bridge: { load: (wallet) => getBridgeData(wallet), view: bridgePage, loading: bridgeLoadingOf("the bridge"), error: bridgeError },
    // The chain's app directory (settings/config.js directory + the built-in tools): nothing to read from the chain
    apps: { load: async () => ({}), view: appsPage, loading: () => "", error: () => "" },
    // Docs: using the chain, writing programs, building apps (text in ui/docs-content.js)
    docs: { load: async () => ({}), view: docsPage, loading: () => "", error: () => "" },
    // One app's own page (#/app?id=…): cover, logo, full text, badges explained, links, programs
    app: { load: async () => ({}), view: appPage, loading: () => "", error: () => "" },
    // Limit orders: coins + markets (pages of 200 in parallel), the chosen market's orders, the Swap price to compare
    limit: { load: limit.loadLimit, view: limit.limitPage, loading: limit.limitLoadingOf("the order books"), error: limit.limitError },
    // Multi transfer: one read (the chosen coin's balance and allowance, the limit per transaction, the base fee)
    send: { load: send.loadSend, view: send.sendPage, loading: send.sendLoading, error: send.sendError },
    stake: { load: getStakeData, view: stakePage, loading: stakeLoadingOf("the pools"), error: stakeError },
};

const app = startApp({ pages, header, footer, notify });

// Blocks rise in once per route; quiet repaints after a transaction must not replay it
let lastRoute = null;
new MutationObserver(() => {
    const root = document.getElementById("app");
    const route = document.body.dataset.page;
    if (!root || root.querySelector("[aria-busy=true]")) return;
    if (route !== lastRoute) {
        lastRoute = route;
        root.setAttribute("data-enter", "");
        setTimeout(() => root.removeAttribute("data-enter"), 900);
    }
}).observe(document.getElementById("app") ?? document.body, { childList: true });

/*
 * Amount fields shrink their text to fit a long number instead of cutting it off (narrow phones, big balances).
 * Never below 16px: phones zoom into smaller fields.
 */
const fitAmounts = () => {
    for (const input of document.querySelectorAll("input.amount-input")) {
        input.style.fontSize = "";
        let size = parseFloat(getComputedStyle(input).fontSize);
        while (input.value && input.scrollWidth > input.clientWidth + 1 && size > 16) {
            size -= 1;
            input.style.fontSize = `${size}px`;
        }
    }
};
new MutationObserver(fitAmounts).observe(document.getElementById("app") ?? document.body, { childList: true, subtree: true });
document.addEventListener("input", () => requestAnimationFrame(fitAmounts));
window.addEventListener("resize", () => requestAnimationFrame(fitAmounts));

/* ------------------------------------ 2. buttons (called from onclick="..." in the pages) */

const repaint = () => app.refresh({ quiet: true });

window.openWallet = openWallet;

/** Home: add BWSC to the connected wallet; not connected → the connect window (connecting adds the chain too) */
window.addNetwork = async () => {
    try {
        if (!(await addNetworkToWallet(app.wallet?.()))) openWallet();
        else notify.success({ title: "Network added", desc: "Your wallet now has the network." });
    } catch (err) {
        notify.error(err);
    }
};

/** Copy buttons (network details, the example program) */
window.copyText = async (text, button) => {
    try {
        await navigator.clipboard.writeText(text);
        if (button) { button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy"; }, 1500); }
    } catch {
        if (button) button.textContent = "Select it";
    }
};
window.refreshPage = () => app.refresh({ fresh: true });

window.swapInput = swapInput;
window.swapOutInput = swapOutInput;
window.swapMax = swapMax;
window.swapConfirmImpact = swapConfirmImpact;
window.swapSettingsToggle = () => { swapSettingsToggle(); repaint(); };
window.swapSlippage = (bps) => { swapSlippage(bps); repaint(); };
window.swapSlippageCustom = (value) => { swapSlippageCustom(value); repaint(); };
window.swapDeadline = (value) => { swapDeadline(value); repaint(); };
window.swapFlip = () => { swapFlip(); repaint(); };
window.swapPick = (side) => swapPick(side, repaint);
window.doSwap = () => {
    let order;
    try { order = swapOrder(); } catch (err) { return notify.error(err); }
    const title = { wrap: "Wrapped", unwrap: "Unwrapped" }[order.kind] ?? "Swap confirmed";
    return app.runTx((wallet, options) => swapCoins(wallet, order, options).then((receipt) => { swapReset(); return receipt; }), {
        title,
        desc: `${order.symbol} to ${order.toSymbol}. Balances are updated.`,
    });
};

window.poolInput = poolInput;
window.poolPercent = (percent) => { poolPercent(percent); repaint(); };
window.poolOpen = (id) => { poolOpen(id); repaint(); };
window.poolNative = (id) => { poolNative(id); repaint(); };
window.poolFilter = (id) => { poolFilter(id); repaint(); };
window.poolMore = () => { poolMore(); repaint(); };
window.poolSearch = poolSearch;
window.poolNewPick = (key) => poolNewPick(key, repaint);
window.poolNewFee = poolNewFee;
window.doAddLiquidity = () => {
    let order;
    try { order = addOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => addLiquidity(wallet, order, options).then((receipt) => { poolReset(); return receipt; }), {
        title: "Liquidity added",
        desc: `Your share of ${order.label} is updated.`,
    });
};
window.doRemoveLiquidity = () => {
    let order;
    try { order = removeOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => removeLiquidity(wallet, order, options), {
        title: "Liquidity taken out",
        desc: `${order.label} are back in your wallet.`,
    });
};
window.doCreatePair = () => {
    let order;
    try { order = newPairOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => createPair(wallet, order, options).then((receipt) => { newPairReset(); return receipt; }), {
        title: "Pair created",
        desc: `${order.label} is listed. The first deposit sets its price.`,
    });
};

/* ------------------------------------ bridge and staking */

window.bridgeInput = bridgeInput;
window.bridgeFlip = () => { bridgeFlip(); repaint(); };
window.bridgeChain = (side) => bridgeChain(side, repaint);
window.bridgePick = () => bridgePick(repaint);
window.bridgeUse = (id) => { bridgeUse(id); repaint(); window.scrollTo({ top: 0, behavior: "smooth" }); };
window.bridgeMax = () => { bridgeMax(); repaint(); };
window.doBridge = () => {
    let order;
    try { order = bridgeOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => bridgeTokens(wallet, order, options).then((receipt) => { bridgeReset(); return receipt; }), AUTO_DELIVER ? {
        title: "Sent to the bridge",
        desc: `Your ${order.symbol} arrives on ${order.to} by itself: watch it under "On the way".`,
    } : {
        title: "Locked in the bridge",
        desc: `Claim your ${order.symbol} on ${order.to} under "Waiting to claim".`,
    });
};

// Automatic delivery: while something is on the way, the bridge page reads again every few seconds (not while the
// user types, picks something or a transaction runs) and says when it arrived
let onTheWay = null;
let claimedByHandAt = 0;
setInterval(() => {
    const watch = document.querySelector("[data-bridge-watch]");
    const count = Number(document.querySelector("[data-waiting-count]")?.getAttribute("data-waiting-count") ?? 0);
    if (onTheWay !== null && count < onTheWay && document.body.dataset.page === "bridge" && Date.now() - claimedByHandAt > 30_000) notify.success({ title: "Arrived", desc: "Your bridged coins are in your wallet on the other chain." });
    onTheWay = document.body.dataset.page === "bridge" ? count : null;
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!watch || typing || document.body.classList.contains("tx-busy") || document.querySelector("[data-pick]")) return;
    app.refresh({ quiet: true, fresh: true });
}, 5000);
window.doClaim = (route, to) => (claimedByHandAt = Date.now(), app.runTx((wallet, options) => claimBridge(wallet, { route, to }, options), {
    title: "Claimed",
    desc: "The coins are in your wallet on the other chain.",
}).finally(() => { claimedByHandAt = Date.now(); }));

window.stakeFilter = (id) => { stakeFilter(id); repaint(); };
window.stakeMore = () => { stakeMore(); repaint(); };
window.stakeSearch = stakeSearch;
window.stakeNewId = stakeNewId;
window.stakeNewPick = (key) => stakeNewPick(key, repaint);
window.doCreatePool = () => {
    let order;
    try { order = newPoolOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => createStakePool(wallet, order, options).then((receipt) => { newPoolReset(); return receipt; }), {
        title: "Pool created",
        desc: `${order.poolId}: ${order.label}. Add reward to start paying.`,
    });
};
window.stakeOpen = (id) => { stakeOpen(id); repaint(); };
window.stakeMode = (mode) => { stakeMode(mode); repaint(); };
window.stakeInput = stakeInput;
window.stakeMax = (id) => { stakeMax(id); repaint(); };
window.doStake = (id) => {
    let order;
    try { order = stakeOrder(id); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => stakeTokens(wallet, order, options).then((receipt) => { stakeReset(); return receipt; }), {
        title: order.mode === "stake" ? "Staked" : "Stake taken out",
        desc: order.mode === "stake" ? "Rewards start counting every second." : "Your coins are back in your wallet. Rewards so far stay claimable.",
    });
};
window.doStakeClaim = (id) => app.runTx((wallet, options) => claimStake(wallet, { poolId: id }, options), {
    title: "Rewards claimed",
    desc: "Your rewards are in your wallet.",
});

// Owner, phase 2: stream reward into a pool (amount + days); it can never be taken back
window.rewardOpen = (id) => { rewardOpen(id); repaint(); };
window.rewardInput = rewardInput;
window.doAddReward = (id) => {
    let order;
    try { order = rewardOrder(id); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => addStakeReward(wallet, order, options).then((receipt) => { rewardReset(); return receipt; }), {
        title: "Reward added",
        desc: `${order.symbol} is now paid out to stakers over ${order.days} day${order.days === 1 ? "" : "s"}.`,
    });
};

/* ------------------------------------ limit orders */

const L = limit;
const runLimit = (fn) => (...args) => { fn(...args); repaint(); };
Object.assign(window, {
    limitTab: runLimit(L.limitTab), limitMarket: runLimit(L.limitMarket), limitFlip: runLimit(L.limitFlip),
    limitPickCoin: (side) => L.limitPickCoin(side, repaint),
    limitSort: runLimit(L.limitSort), limitMoreOrders: runLimit(L.limitMoreOrders), limitShowEnded: runLimit(L.limitShowEnded),
    limitMarketSort: runLimit(L.limitMarketSort), limitMoreMarkets: runLimit(L.limitMoreMarkets), limitMarketSearch: L.limitMarketSearch,
    limitGiveInput: L.limitGiveInput, limitWantInput: L.limitWantInput, limitPartial: runLimit(L.limitPartial), limitEnds: runLimit(L.limitEnds),
    limitMax: runLimit(L.limitMax), limitAtSwap: runLimit(L.limitAtSwap),
    limitBuyOpen: runLimit(L.limitBuyOpen), limitBuyClose: runLimit(L.limitBuyClose), limitBuyInput: L.limitBuyInput,
    limitBuyAll: runLimit(L.limitBuyAll), limitBuyBudget: runLimit(L.limitBuyBudget),
    limitMineFilter: runLimit(L.limitMineFilter),
    limitNewCoin: L.limitNewCoin, limitNewFee: L.limitNewFee, limitFeeInput: L.limitFeeInput, limitCoinSearch: L.limitCoinSearch, limitMoreCoins: runLimit(L.limitMoreCoins),
});
window.limitSeller = (address) => { L.limitSeller(address); repaint(); };
window.limitSellerInput = L.limitSellerInput;
window.limitSellerApply = () => { try { L.limitSellerApply(); repaint(); } catch (err) { notify.error(err); } };
window.limitShare = (button) => {
    const before = button?.innerHTML;
    return window.copyText(L.limitShareLink(app.wallet?.()), button).then(() => { if (button) setTimeout(() => { button.innerHTML = before; }, 1600); });
};
window.limitMoreMine = async () => { await L.limitMoreMine(app.wallet?.()); repaint(); };
window.limitPlace = () => {
    let order;
    try { order = L.limitPlaceOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => placeLimitOrder(wallet, order, options).then((receipt) => { L.limitPlaceReset(); L.limitMineReset(); return receipt; }), {
        title: "Order placed",
        desc: `${order.label}. It shows in the list now; you get paid as people buy.`,
    });
};
window.limitBuy = () => {
    let order;
    try { order = L.limitBuyOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => fillLimitOrder(wallet, order, options).then((receipt) => { L.limitBuyClose(); return receipt; }), {
        title: "Bought",
        desc: `${order.label} is in your wallet.`,
    });
};
window.limitCancel = (id) => app.runTx((wallet, options) => cancelLimitOrder(wallet, { id }, options).then((receipt) => { L.limitMineReset(); return receipt; }), {
    title: "Order cancelled",
    desc: "What was not sold is back in your wallet.",
});
window.limitAddCoin = () => {
    let order;
    try { order = L.limitAddCoinOrder(); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => addLimitCoin(wallet, order, options).then((receipt) => { L.limitAddCoinReset(); return receipt; }), { title: "Coin added", desc: "People can now put it up or ask for it." });
};
window.limitSaveCoin = (address, enabled) => {
    let order;
    try { order = L.limitSaveCoinOrder(address, enabled); } catch (err) { return notify.error(err); }
    return app.runTx((wallet, options) => setLimitCoin(wallet, order, options), { title: "Coin saved", desc: `${order.symbol}: ${order.enabled ? "on" : "off"}, fee ${order.feeBps / 100}%.` });
};
window.limitWithdraw = (address) => app.runTx((wallet, options) => withdrawLimitFees(wallet, { token: address }, options), { title: "Fees withdrawn", desc: "The fees are in your wallet." });

/* ------------------------------------ apps directory and the header search */

window.openSearch = openSearch;
listenForSearchKeys();
window.appsCategory = (id) => { appsCategory(id); repaint(); };
window.appsSort = (value) => { appsSort(value); repaint(); };
window.appsBadge = (value) => { appsBadge(value); repaint(); };
window.appsMore = () => { appsMore(); repaint(); };
window.appsSearch = appsSearch;

/* ------------------------------------ landing effects and code blocks */

window.copyCode = copyCode;
/** The light under the pointer on feature cards */
window.spotMove = (event, el) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${event.clientX - r.left}px`);
    el.style.setProperty("--y", `${event.clientY - r.top}px`);
};

window.docsSearch = docsSearch;
window.docsMenu = () => { docsMenu(); repaint(); };
window.docsCloseMenu = docsCloseMenu;
window.docsJump = docsJump;

/* ------------------------------------ multi transfer */

const S = send;
Object.assign(window, {
    sendText: S.sendText,
    sendSameAmount: S.sendSameAmount,
    sendSame: () => { S.sendSame(); repaint(); },
    sendClear: () => { S.sendClear(); repaint(); },
    sendExample: () => { S.sendExample(); repaint(); },
    sendMerge: () => { S.sendMerge(); repaint(); },
    sendPickCoin: () => S.sendPickCoin(repaint),
    sendFile: (input) => S.sendFile(input, repaint).catch((err) => notify.error(err)),
});
window.sendSubmit = () => {
    let order;
    try { order = S.sendOrder(); } catch (err) { return notify.error(err); }
    const wallets = order.rows.length;
    return app.runTx((wallet, options) => multiSend(wallet, order, { ...options, onBatch: S.sendBatchDone }).finally(() => repaint()), {
        title: "Transfer done",
        desc: `Every wallet in the list got its amount (${wallets.toLocaleString("en-US")} wallet${wallets === 1 ? "" : "s"}).`,
    });
};

/* ------------------------------------ the coin's price in the header */

// Read again every 30 s while the tab is open and in view (the read itself is cached 30 s and shared by all pages)
setInterval(() => { if (!document.hidden) refreshPrice(); }, 30_000);
