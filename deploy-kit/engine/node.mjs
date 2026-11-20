/*
 * ENGINE (same in every project, do not edit).
 *
 * The local BWSC chain: the real node (server.js of the programvm package, in memory) started as a child process,
 * plus the public test keys it is funded with. Used by npm run dev and npm test.
 * With --mock (npm run dev:mock, test:mock, test:app) it starts deploy-kit/engine/mock/server.mjs instead: same HTTP API,
 * your program files run as they are, no chain package needed (see that file for what differs).
 *
 * Test keys come from the well-known hardhat test phrase. They are public: never send real coins to them.
 *   devKey(0)        owner, deployer and the chain's admin (approves new programs, like the chain team does)
 *   devKey(1)        funder of the test panel and the sample data
 *   devKey(2)        "stranger" in tests
 *   devKey(10 + n)   people: sample data and t.newWallet() in tests (funded in the genesis, so no setup transactions)
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { createClient, keyWalletSigner } from "bwscbox";

const DEV_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DEV_DIR, "..");
const TEST_PHRASE = "test test test test test test test test test test test junk";
const PEOPLE_FROM = 10;

const keys = new Map();
/** Private key number i of the public test phrase */
const devKey = (i) => {
    if (!keys.has(i)) keys.set(i, ethers.HDNodeWallet.fromPhrase(TEST_PHRASE, undefined, `m/44'/60'/0'/0/${i}`).privateKey);
    return keys.get(i);
};
const devWallet = (i) => new ethers.Wallet(devKey(i));
/** bwscbox signer for test key i */
const devSigner = (i) => keyWalletSigner(devWallet(i));
const personSigner = (n) => devSigner(PEOPLE_FROM + n);

/** Folder of the installed chain (the programvm package: server.js, standards, autoreview) */
const chainDir = () => path.dirname(fileURLToPath(import.meta.resolve("programvm")));

/** True when this run uses the mock node (--mock on the command line, or BWSC_NODE=mock) */
const isMock = () => process.argv.includes("--mock") || process.env.BWSC_NODE === "mock";
if (isMock()) process.env.BWSC_NODE = "mock";   // child scripts started from here see it too

/**
 * Starts a fresh in-memory chain.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {number} options.chainId
 * @param {number} options.blockMs      how often a block closes while transactions wait
 * @param {number} options.people       how many people keys get coins in the genesis
 * @param {string} options.balance      whole coins for every funded key
 * @param {string} options.coinName     name / symbol the wallet shows (GET /evm)
 * @param {string} options.coinSymbol
 * @param {string|null} options.logFile node output goes here (null = discarded)
 * @returns {{ child, url, stop }}
 */
function startNode({ port, chainId, blockMs, people, balance, coinName, coinSymbol, logFile = null }) {
    const genesisFile = path.join(DEV_DIR, "generated", `genesis-${port}.json`);
    const wei = `${ethers.parseEther(String(balance))}n`;
    const funded = [ 0, 1, 2, 3, 4, ...Array.from({ length: people }, (_, n) => PEOPLE_FROM + n) ];
    const balances = Object.fromEntries(funded.map((i) => [ devWallet(i).address.toLowerCase(), wei ]));
    fs.mkdirSync(path.dirname(genesisFile), { recursive: true });
    // The live Bluewolfchain's gas table (genesis "forks": { "bluewolf": 0 }): 15,000 gas per transaction and unit prices
    // 2.5x the defaults. Tests use it too, so gas limits measured here hold on the real chain.
    fs.writeFileSync(genesisFile, JSON.stringify({ chainId, balances, forks: { bluewolf: 0 } }));

    const out = logFile ? fs.openSync(logFile, "w") : "ignore";
    const server = isMock() ? path.join(DEV_DIR, "engine", "mock", "server.mjs") : path.join(chainDir(), "server.js");
    const child = spawn(process.execPath, [ server ], {
        cwd: isMock() ? DEV_DIR : chainDir(),
        stdio: [ "ignore", out, out ],
        env: {
            ...process.env,
            PORT: String(port),
            HOST: "127.0.0.1",
            DEV: "1",
            GENESIS: genesisFile,
            CHAIN_ID: String(chainId),
            BLOCK_MS: String(blockMs),
            // Only devKey(0) may approve new programs and upgrades, as on a real network
            ADMINS: devWallet(0).address.toLowerCase(),
            RATE_LIMIT: "0",
            EVM_RATE_LIMIT: "0",
            EVM_NAME: coinName,
            EVM_SYMBOL: coinSymbol,
            DATA: "",
        },
    });
    const url = `http://127.0.0.1:${port}`;
    const stop = () => { try { child.kill(); } catch {} try { fs.rmSync(genesisFile, { force: true }); } catch {} };
    return { child, url, stop };
}

/** Waits until the node answers GET /genesis */
async function waitForNode(url, timeoutMs = 30_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            const response = await fetch(`${url}/genesis`);
            if (response.ok) return await response.json();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`The local ${isMock() ? "mock node" : "chain"} did not start at ${url}. See deploy-kit/generated/node.log.`);
}

const localClient = (url) => createClient({ node: url });

export { DEV_DIR, ROOT, PEOPLE_FROM, devKey, devWallet, devSigner, personSigner, chainDir, isMock, startNode, waitForNode, localClient };
