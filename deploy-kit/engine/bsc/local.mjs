/*
 * ENGINE (same in every project, do not edit).
 *
 * The BSC side on this computer, for npm run dev / npm test / npm run test:app:
 *   1. startLocalBsc: anvil + a MockToken for every entry in deploy-kit/settings/bsc/test-tokens.json; their addresses
 *      replace the settings listed under "replaces" (BSC contract settings and BWSC program settings alike).
 *      No anvil installed → no BSC side: the replaced settings get placeholder addresses so BWSC still deploys.
 *   2. deployBscLocal: the steps of deploy-kit/settings/bsc/deploy.config.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { startAnvil } from "./anvil.mjs";
import { compileContracts } from "./compiler.mjs";
import { runBscStep, verifyBscStep } from "./deploy.mjs";
import { readSettings, readJsonSettings, SETTINGS_DIR } from "../settings.mjs";
import config from "../../settings/bsc/deploy.config.mjs";

const BSC_SETTINGS_DIR = path.join(SETTINGS_DIR, "bsc");

/** Settings of every BSC contract: deploy-kit/settings/bsc/<Name>.env → { Name: { KEY: value } } (deploy.env is not one) */
function bscSettings() {
    return Object.fromEntries(fs.readdirSync(BSC_SETTINGS_DIR)
        .filter((f) => f.endsWith(".env") && !f.startsWith("deploy"))
        .map((f) => {
            const values = readSettings(`bsc/${f}`);
            const empty = Object.entries(values).filter(([ , v ]) => v === "").map(([ k ]) => k);
            if (empty.length) throw new Error(`Set ${empty.join(", ")} in deploy-kit/settings/bsc/${f}.`);
            return [ f.replace(/\.env$/, ""), values ];
        }));
}

/** "Name.KEY" → value applied to a settings map (only names that exist in it) */
function applyOverrides(settings, overrides) {
    for (const [ target, value ] of Object.entries(overrides)) {
        const [ name, key ] = target.split(".");
        if (settings[name] && key in settings[name]) settings[name][key] = value;
    }
    return settings;
}

/**
 * @returns {Promise<{ anvil, contracts, tokens: Record<string, { address, decimals, name }>, overrides: Record<string,string> }>}
 *          anvil is null when Foundry is not installed
 */
async function startLocalBsc({ port, chainId }) {
    const list = readJsonSettings("bsc/test-tokens.json").tokens ?? [];
    const anvil = await startAnvil({ port, chainId });
    if (!anvil) {
        // Placeholders so the BWSC side still deploys; the bridge page says the BSC side is not running
        const overrides = {};
        list.forEach((t, i) => t.replaces.forEach((r) => { overrides[r] = `0x${(0xb5c00 + i + 1).toString(16).padStart(40, "0")}`; }));
        return { anvil: null, contracts: null, tokens: {}, overrides };
    }
    const { contracts } = await compileContracts({ quiet: true });
    const deployer = anvil.wallet(0);
    const tokens = {};
    const overrides = {};
    for (const t of list) {
        const token = await new ethers.ContractFactory(contracts.MockToken.abi, contracts.MockToken.bytecode, deployer).deploy(t.name, t.symbol, t.decimals);
        await token.waitForDeployment();
        const address = (await token.getAddress()).toLowerCase();
        await (await token.mint(await deployer.getAddress(), ethers.parseUnits(String(t.supply), t.decimals))).wait();
        tokens[t.symbol] = { address, decimals: t.decimals, name: t.name };
        for (const r of t.replaces) overrides[r] = address;
    }
    return { anvil, contracts, tokens, overrides };
}

/**
 * Runs deploy-kit/settings/bsc/deploy.config.mjs on the local BSC.
 * @param {object} local  startLocalBsc() result
 * @param {object} bwsc   BWSC addresses (deployLocal().addresses)
 * @returns {Promise<{ addresses, settings, owner }>}
 */
async function deployBscLocal(local, { bwsc }) {
    const deployer = local.anvil.wallet(0);
    const owner = (await deployer.getAddress()).toLowerCase();
    const settings = applyOverrides(bscSettings(), local.overrides);
    const addresses = {};
    const ctx = { owner, deployer: owner, settings, addresses, bwsc, contracts: local.contracts };
    for (const step of config.steps) {
        if (step.when && !step.when(ctx)) continue;
        const out = await runBscStep(step, { wallet: deployer, contracts: local.contracts, ctx });
        addresses[step.key] = out.address;
        const ok = await verifyBscStep(step, out.address, { provider: local.anvil.provider, contracts: local.contracts, ctx });
        if (ok !== true) throw new Error(`${step.key} on the local BSC: ${ok}`);
    }
    return { addresses, settings, owner, deployer };
}

/** What the test panel gets about the local BSC (the website's own settings come from project/app-config.mjs) */
const bscWebsiteEnv = (bsc) => (bsc ? { VITE_LOCAL_BSC_RPC: bsc.anvil.url, VITE_LOCAL_BSC_TOKENS: JSON.stringify(bsc.tokens) } : {});

export { startLocalBsc, deployBscLocal, bscSettings, applyOverrides, bscWebsiteEnv };
