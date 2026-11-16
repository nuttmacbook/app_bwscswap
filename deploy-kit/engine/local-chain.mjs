/*
 * ENGINE (same in every project, do not edit).
 *
 * Sets up the local test chain exactly like the real deploy:
 *   1. deploys a standard token for every entry in deploy-kit/settings/test-tokens.json (none, one or many)
 *   2. reads deploy-kit/settings/programs/*.env and swaps the values listed under "replaces" for those test tokens
 *   3. runs deploy-kit/settings/deploy.config.mjs step by step (deploy → admin init → readBack → check)
 *   4. gives the test panel's funder (devKey 1) half of every token, so its buttons can hand tokens out
 * Used by npm run dev (start.mjs) and npm test (test-runner.mjs).
 */

import { utils, tokenAt, createProgram, createReader } from "bwscbox";
import { devSigner } from "./node.mjs";
import { allProgramSettings, testTokens } from "./settings.mjs";
import { normalizeSteps, skipReason, requiredProgramsOf, runStep, sendAndWait, isLive } from "./deploy-steps.mjs";
import config from "../settings/deploy.config.mjs";

/**
 * @param {object} options
 * @param {object} options.client     bwscbox client of the local node
 * @param {object} options.programs   compileAll() result
 * @param {object} [options.overrides] "Program.KEY" → value, applied after the test tokens
 * @returns {Promise<object>} deployed:
 *   addresses       key → address (every step in deploy.config.mjs)
 *   tokens          symbol → { address, decimals, key } for every token (test tokens and token() steps)
 *   settings        program settings after the swap
 *   send(signer, key, method, input, { value })  → receipt (throws the program's message)
 *   read(key, method, input, { from })            → result
 *   gas             key → { deploy, init }
 */
async function deployLocal({ client, programs, overrides = {} }) {
    const owner = devSigner(0);
    const funder = devSigner(1);
    const tokens = {};
    const addresses = {};
    const gas = {};

    const deployToken = async (symbol, name, decimals, supply) => {
        const step = { kind: "token", key: symbol, build: "Token", upgradeable: false, init: () => ({ name, ticker: symbol, decimals: BigInt(decimals), supply: utils.toUnits(String(supply), decimals) }) };
        const out = await runStep(step, { client, deployer: owner, admin: owner, ctx: { owner: owner.address }, build: programs.Token });
        return out.address;
    };

    /* ------------------------------------ 1. test tokens */

    const replaced = [];
    for (const t of testTokens()) {
        const address = await deployToken(t.symbol, t.name, t.decimals, t.supply);
        tokens[t.symbol] = { address, decimals: t.decimals, name: t.name, key: null };
        replaced.push({ symbol: t.symbol, address, replaces: t.replaces ?? [] });
    }

    /* ------------------------------------ 2. settings, with test tokens in place of real ones */

    const settings = allProgramSettings();
    for (const { symbol, address, replaces } of replaced) {
        for (const target of replaces) {
            const [ programName, key ] = String(target).split(".");
            if (!settings[programName] || !(key in settings[programName])) {
                throw new Error(`test-tokens.json: ${symbol} replaces ${target}, but deploy-kit/settings/programs/${programName}.env has no ${key}.`);
            }
            settings[programName][key] = address;
        }
    }

    // Values from other chains' test setup (e.g. BSC test tokens from deploy-kit/engine/bsc/local.mjs): "Program.KEY" → value
    for (const [ target, value ] of Object.entries(overrides)) {
        const [ programName, key ] = String(target).split(".");
        if (settings[programName] && key in settings[programName]) settings[programName][key] = value;
    }

    /* ------------------------------------ 3. the same steps as the real deploy */

    const ctx = { owner: owner.address, deployer: owner.address, addresses, settings, isLocal: true, network: "local" };
    for (const [ label, address ] of Object.entries(requiredProgramsOf(config, settings))) {
        if (!(await isLive(client, address))) throw new Error(`${label}: no program at ${address} on the local chain. Add it to deploy-kit/settings/test-tokens.json "replaces".`);
    }
    for (const step of normalizeSteps(config)) {
        if (skipReason(step, ctx)) continue;
        if (!programs[step.build]) throw new Error(`deploy.config.mjs: no program named ${step.build} (deploy-kit/bwsc/${step.build}.js).`);
        const out = await runStep(step, { client, deployer: owner, admin: owner, ctx, build: programs[step.build] });
        addresses[step.key] = out.address;
        gas[step.key] = out.gas;
        if (step.kind === "token") {
            const s = settings[step.key];
            tokens[s.TICKER] = { address: out.address, decimals: Number(s.DECIMALS), name: s.NAME, key: step.key };
        }
        // A program that is also a token (wBWSC): the owner wraps some native coins so there is some to hand out
        if (step.asToken) {
            const t = step.asToken(ctx);
            await sendAndWait(client, owner, { action: "call", to: out.address, method: "deposit", input: {}, value: String(utils.toUnits(String(t.wrap), 18)) });
            tokens[t.symbol] = { address: out.address, decimals: t.decimals, name: t.name, key: step.key };
        }
    }

    /* ------------------------------------ 4. tokens for the test panel's funder */

    for (const t of Object.values(tokens)) {
        const reader = createReader(client, tokenAt(t.address));
        const held = await reader.read.balanceOf({ who: owner.address });
        if (held > 1n) await sendAndWait(client, owner, { action: "call", to: t.address, method: "transfer", input: utils.toChainValue({ to: funder.address, amount: held / 2n }) });
    }

    const send = async (signer, key, method, input = {}, { value = 0n, gasLimit } = {}) => {
        const address = addresses[key] ?? key;
        const tx = await createProgram(client, { name: key, address }, signer)[method](utils.toChainValue(input), { value: String(value), gasLimit });
        return tx.wait({ timeoutMs: 60_000 });
    };
    const read = (key, method, input = {}, { from } = {}) => client.query({ program: addresses[key] ?? key, method, input: utils.toChainValue(input), from });

    return { addresses, tokens, settings, gas, send, read, owner, funder };
}

/** What the website gets on the local chain: program addresses, and every token for the test panel */
const websiteEnv = (deployed) => ({
    VITE_LOCAL_TEST_TOKENS: JSON.stringify(Object.fromEntries(Object.entries(deployed.tokens)
        .map(([ symbol, t ]) => [ symbol, { address: t.address, decimals: t.decimals } ]))),
});

export { deployLocal, websiteEnv };
