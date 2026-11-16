/*
 * ENGINE (same in every project, do not edit).
 *
 * One command for local testing (run from deploy-kit/):  npm run dev
 *
 *   1. starts the real BWSC node (programvm server.js, in memory; port and chain id from deploy-kit/settings/local.env)
 *   2. checks every program with the node's own rules (also refreshes src/generated)
 *   3. deploys test tokens + everything in deploy-kit/settings/deploy.config.mjs, approved by the local admin (local-chain.mjs)
 *   4. adds sample data with deploy-kit/project/seed.mjs
 *   5. the local BSC (anvil, when installed) with the BSC contracts (deploy-kit/settings/bsc/deploy.config.mjs), and the
 *      project's own local services (deploy-kit/project/services.mjs, e.g. the bridge signer)
 *   6. starts the website pointed at that node, with the test panel switched on
 *
 * Stopping it resets the chain. Options: --seed <n>, --port <n> (override local.env)
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { compileAll } from "./compile.mjs";
import { DEV_DIR, ROOT, startNode, waitForNode, localClient, devSigner } from "./node.mjs";
import { localSettings } from "./settings.mjs";
import { deployLocal, websiteEnv } from "./local-chain.mjs";
import { startLocalBsc, deployBscLocal, bscWebsiteEnv } from "./bsc/local.mjs";
import * as services from "../project/services.mjs";
import { testConfig } from "../project/app-config.mjs";
import { devKey } from "./node.mjs";
import * as project from "../project/seed.mjs";

const stop = (message) => {
    console.error(`\n✖ ${message}\n`);
    process.exit(1);
};

let local;
try {
    local = localSettings();
} catch (error) {
    stop(error.message);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : Number(fallback);
};

const PORT = option("port", local.LOCAL_PORT);


const SEED = option("seed", local.LOCAL_SEED);
const CHAIN_ID = Number(local.LOCAL_CHAIN_ID);

const children = [];
let node = null;
let bscLocal = null;
let running = null;
const shutdown = (code = 0) => {
    children.forEach((child) => { try { child.kill(); } catch {} });
    node?.stop();
    bscLocal?.anvil?.stop();
    running?.stop?.();
    process.exit(code);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* ------------------------------------ 1. node */

node = startNode({
    port: PORT, chainId: CHAIN_ID, blockMs: Number(local.LOCAL_BLOCK_MS), people: SEED,
    balance: local.LOCAL_GENESIS_BALANCE, coinName: local.LOCAL_COIN_NAME, coinSymbol: local.LOCAL_COIN_SYMBOL,
    logFile: path.join(DEV_DIR, "generated", "node.log"),
});
children.push(node.child);
node.child.on("exit", (code) => {
    console.error(`The local chain stopped (code ${code}). See deploy-kit/generated/node.log.`);
    shutdown(1);
});

/* ------------------------------------ 2-4. check, deploy, sample data */

let deployed;
let bsc = null;
try {
    await waitForNode(node.url);
    const client = localClient(node.url);
    const programs = await compileAll({ quiet: true });
    bscLocal = await startLocalBsc({ port: Number(local.LOCAL_BSC_PORT), chainId: Number(local.LOCAL_BSC_CHAIN_ID) });
    deployed = await deployLocal({ client, programs, overrides: bscLocal.overrides });
    console.log(`Programs checked with the node's rules and deployed (${Object.keys(deployed.addresses).length}).`);
    if (bscLocal.anvil) {
        bsc = { ...bscLocal, ...(await deployBscLocal(bscLocal, { bwsc: deployed.addresses })) };
        console.log(`Local BSC (anvil) at ${bsc.anvil.url}, chain id ${bsc.anvil.chainId}: ${Object.keys(bsc.addresses).length} contracts deployed.`);
    } else {
        console.log("No local BSC: anvil (Foundry) is not installed. The bridge page needs it: curl -L https://foundry.paradigm.xyz | bash && foundryup");
    }
    running = services.start ? await services.start({ deployed, bsc, local, client, nodeUrl: node.url }) : null;

    if (project.seed && SEED > 0) {
        await project.seed({ client, deployed, count: SEED, onProgress: (i) => {
            if (i % 10 === 0 || i === SEED) process.stdout.write(`\rSample data ${i}/${SEED}`);
        } });
        process.stdout.write("\n");
    }

    console.log([
        "",
        `Local chain ready at ${node.url} (chain id ${CHAIN_ID}, explorer at ${node.url}/)`,
        ...Object.entries(deployed.addresses).map(([ key, address ]) => `  ${key.padEnd(26)} ${address}`),
        ...(project.summary ? await project.summary(deployed) : []),
        ...(bsc ? Object.entries(bsc.addresses).map(([ key, address ]) => `  ${`${key} (BSC)`.padEnd(26)} ${address}`) : []),
        ...(running?.lines ?? []),
        `  ${"Owner / admin".padEnd(26)} ${devSigner(0).address}`,
        "",
        `Your own wallet: add network ${node.url}/evm with chain id ${CHAIN_ID} (the Connect window does it for you), then fund it from the test panel.`,
        "",
    ].join("\n"));
} catch (error) {
    console.error(error.isCompileError ? `✖ ${error.message}` : error);
    shutdown(1);
}

/* ------------------------------------ 6. website */

// These exist only while testing (Vite gives process env priority)
const app = spawn(path.join(ROOT, "node_modules/.bin/vite"), [], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
        ...process.env,
        ...websiteEnv(deployed),
        VITE_NETWORK: "local",
        // Public test key (devKey 1): pays coins and test tokens for the test panel
        VITE_DEV_FUNDER_KEY: devKey(1),
        VITE_DEV_FUND_GAS: local.LOCAL_FUND_GAS,
        VITE_DEV_FUND_AMOUNT: local.LOCAL_FUND_AMOUNT,
        VITE_RPC_LATENCY: local.LOCAL_RPC_LATENCY,
        ...bscWebsiteEnv(bsc),
        // Merged over settings/config.js while testing (the file itself is never touched)
        VITE_CONFIG: JSON.stringify(testConfig({ nodeUrl: node.url, local, deployed, bsc, signerUrl: running?.signerUrl, extraChains: running?.chains ?? [], extraTokens: running?.tokens ?? [] })),
    },
});
children.push(app);
app.on("exit", (code) => shutdown(code ?? 0));
