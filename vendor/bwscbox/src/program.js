/*
 * Programs (the chain's smart contracts) as objects.
 *
 * A program descriptor is { name, address, functions: ["swap", …], views?: ["getView", …] }.
 * A project keeps one per program (e.g. src/project/chain/programs.js), so the page never writes a function name twice.
 *
 *   const swap = box.createProgram(SwapProgram, wallet.signer);
 *   const tx = await swap.swap({ tokenIn, amountIn, minOut });   // wallet prompt → node simulates → queued
 *   const receipt = await tx.wait();                               // in a block and it worked, or it throws
 *
 *   const view = await box.createReader(SwapProgram).methods.getView({ account }).call();   // no wallet, no gas
 */

import { ChainError, errorText } from "./client.js";

/** Standard token program (ERC-20 style, src/standards/token.js of the node) at an address */
export const tokenAt = (address) => ({
    name: "Token",
    address,
    functions: [ "name", "ticker", "decimals", "totalSupply", "balanceOf", "allowance", "transfer", "approve", "transferFrom", "multiTransfer", "permit", "nonces" ],
    views: [ "name", "ticker", "decimals", "totalSupply", "balanceOf", "allowance", "nonces" ],
});

const known = (program, method) => !Array.isArray(program?.functions) || program.functions.includes(method);

/** Transactions: every listed function becomes (input, { value, gasLimit }) → { hash, wait() } */
export function createProgram(client, program, signer) {
    if (!program?.address) throw new Error(`bwscbox: ${program?.name ?? "program"} has no address`);
    return new Proxy({}, {
        get: (_, method) => {
            if (typeof method !== "string" || method === "then") return undefined;
            if (!known(program, method)) throw new Error(`bwscbox: ${program.name} has no function ${method}`);
            return async (input = {}, { value = "0", gasLimit } = {}) => {
                if (!signer?.signTransaction) throw new Error("Wallet is not connected.");
                const sent = await client.send({ action: "call", to: program.address, method, input, value: String(value), ...(gasLimit ? { gasLimit } : {}) }, signer);
                return { ...sent, wait: (options) => client.waitReceipt(sent.hash, options) };
            };
        },
    });
}

/**
 * Reads, shaped like web3's contract.methods.fn(args).call() so read counters can wrap it unchanged.
 * `from` = the caller the program sees (params.context.sender), for views that depend on it.
 */
export function createReader(client, program) {
    if (!program?.address) throw new Error(`bwscbox: ${program?.name ?? "program"} has no address`);
    const call = (method, input, from) => client.query({ program: program.address, method, input, from });
    return {
        address: program.address,
        methods: new Proxy({}, {
            get: (_, method) => (typeof method === "string" ? (input = {}, { from } = {}) => ({ call: () => call(method, input, from) }) : undefined),
        }),
        read: new Proxy({}, {
            get: (_, method) => (typeof method === "string" ? (input = {}, { from } = {}) => call(method, input, from) : undefined),
        }),
    };
}

/**
 * What went wrong, for people: the program's own message when it threw, otherwise the node's or the wallet's.
 * @returns {{ message: string, code: any, isUserReject: boolean, raw: any }}
 */
export function handleTxError(program, error) {
    const code = error?.code ?? error?.cause?.code;
    const isUserReject = code === 4001 || code === "ACTION_REJECTED";
    const fromNode = error instanceof ChainError || error?.name === "ChainError" ? errorText(error.body) ?? error.message : null;
    const message = isUserReject ? "You rejected the request in your wallet." : fromNode ?? error?.message ?? `${program?.name ?? "Program"} call failed.`;
    return { message: String(message).replace(/^Error:\s*/, ""), code, isUserReject, raw: error };
}
