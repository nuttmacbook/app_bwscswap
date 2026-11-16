/*
 * ENGINE (same in every project, do not edit).
 *
 * Any standard token program by address. Works for zero, one or many tokens: nothing about a token is written here,
 * the address always comes from a program (e.g. a view that returns it) or from the address book.
 */

import { box } from "./connect";
import { normalize } from "./txError";

/**
 * Approves `spender` for exactly `amount` when the current allowance is lower. Never approves more.
 *
 * @param {object} options
 * @param {object} options.wallet      { address, signer }
 * @param {string} options.token       token address
 * @param {string} options.spender     program that will take the tokens
 * @param {bigint} options.amount      amount needed
 * @param {bigint} options.allowance   current allowance (read with the page view, so no extra call)
 * @param {Function} options.onStep    progress callback
 * @param {number} options.index       step number of the approval in the flow
 * @param {number} options.total       number of wallet prompts in the flow
 * @returns {Promise<boolean>} true when an approval was sent
 */
async function approveIfNeeded({ wallet, token, spender, amount, allowance, onStep = () => {}, index = 1, total = 1 }) {
    if (BigInt(allowance ?? 0) >= BigInt(amount ?? 0)) return false;
    const program = box.tokenAt(token);
    onStep({ stage: "approve", index, total });
    try {
        const tx = await box.createProgram(program, wallet.signer).approve({ spender, amount: `${BigInt(amount)}n` });
        onStep({ stage: "approving", index, total });
        await tx.wait();
        return true;
    } catch (error) {
        throw normalize(error, box.handleTxError(program, error), "Approval failed. Please try again.");
    }
}

export { approveIfNeeded };
