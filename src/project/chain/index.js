/*
 * YOUR CODE (on-chain). The only door between the UI and the blockchain.
 * The UI (src/project/ui) imports from this file and nothing else on-chain,
 * so programs can change without touching pages, and pages can change without touching programs.
 */

// Exchange: every pair in one program (read 100 at a time), routes, swaps, wrap / unwrap, liquidity, new pairs
export { getDexData, coinIn, pairFor, bestRoute, bestRouteOut, swapCoins, addLiquidity, removeLiquidity, createPair, freeGasFor } from "./dex";

// Staking: every pool (read 100 at a time); stake / take out / claim; owner: new pool, add reward
export { getStakeData, pendingAt, stakeTokens, claimStake, addStakeReward, createStakePool } from "./staking";

// Limit orders: coin for coin at the maker's price (every coin and market read in pages); owner: coins and fees
export { getLimitData, getMyOrders, placeLimitOrder, fillLimitOrder, cancelLimitOrder, addLimitCoin, setLimitCoin, withdrawLimitFees, priceFor, amountForBudget, rateOf } from "./limit";

// Multi transfer: one coin (native or token) to many wallets, in batches of up to 200 a transaction
export { getSendData, parseList, mergeDuplicates, batchesOf, feeEstimate, feeCeiling, multiSend } from "./multisend";

// Bridge: BWSC hub ↔ every chain in settings/config.js
export { getBridgeData, bridgeTokens, claimBridge } from "./bridge";

// The chain itself: live numbers for the home page, and the values to add BWSC to a wallet by hand
export { getNetworkData, networkDetails, addNetworkToWallet } from "./network";

// Coins and chains as the pages show them (settings/config.js + the chain)
export { HUB, CHAINS, chainOf, listedTokens, nativeCoin } from "./coins";

// Previews while typing (same math as the programs; the programs check again)
export { withSlippage, pairedAmount, depositPreview, withdrawPreview, amountIn, withSlippageUp } from "./pricing";
