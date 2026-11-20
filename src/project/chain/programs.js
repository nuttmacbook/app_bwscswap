/*
 * YOUR CODE (on-chain). The programs this website talks to: where they are (settings/config.js `programs`) and the
 * functions it may call. The code itself lives on chain; you deployed it from deploy-kit/bwsc/.
 */

import { config, addressOrZero } from "../../engine/settings";

const DexProgram = {
    name: "BwscDex",
    address: addressOrZero(config.programs?.dex),
    functions: [ "createPair", "addLiquidity", "removeLiquidity", "swap", "swapExactOut", "quote", "quoteIn", "getView" ],
};

const StakingProgram = {
    name: "BwscStaking",
    address: addressOrZero(config.programs?.staking),
    functions: [ "stake", "unstake", "claim", "createPool", "addReward", "getView" ],
};

const LimitProgram = {
    name: "BwscLimit",
    address: addressOrZero(config.programs?.limit),
    functions: [ "placeOrder", "fill", "cancel", "addCoin", "setCoin", "withdrawFees", "getView", "getMarket", "getOrdersOf" ],
};

const MultiSendProgram = {
    name: "BwscMultiSend",
    address: addressOrZero(config.programs?.multisend),
    functions: [ "send", "getView" ],
};

const BridgeProgram = {
    name: "BwscBridge",
    address: addressOrZero(config.programs?.bridge),
    functions: [ "bridgeOut", "claimIn", "getView" ],
};

/** wBWSC (address comes from the exchange's view: the one it really uses) */
const wrappedProgramAt = (address) => ({ name: "wBWSC", address, functions: [ "deposit", "withdraw" ] });

export { DexProgram, StakingProgram, LimitProgram, MultiSendProgram, BridgeProgram, wrappedProgramAt };
