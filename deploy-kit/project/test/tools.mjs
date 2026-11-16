/*
 * Helpers the program tests share (not a test file itself).
 */

import { utils } from "bwscbox";
import { sendAndWait } from "../../engine/deploy-steps.mjs";

/** Deploys a program the way the explorer does (code + input, then the admin's init) and returns its address */
async function deployProgram(t, name, input, { upgrader = null } = {}) {
    const sent = await sendAndWait(t.client, t.owner, { action: "deploy", code: t.programs[name].code, input: utils.toChainValue(input), ...(upgrader ? { upgrader } : {}), gasLimit: 1_500_000 });
    const address = String(sent.result?.programUuid ?? "").toLowerCase();
    await sendAndWait(t.client, t.owner, { action: "init", to: address, gasLimit: 1_000_000 });
    return address;
}

/** A test token (the chain's standard Token.js); the whole supply goes to t.owner */
const deployToken = (t, ticker, { decimals = 18, supply = "1000000000" } = {}) =>
    deployProgram(t, "Token", { name: `Test ${ticker}`, ticker, decimals: BigInt(decimals), supply: utils.toUnits(supply, decimals) });

export { deployProgram, deployToken };
