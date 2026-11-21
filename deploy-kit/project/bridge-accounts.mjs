/*
 * YOUR CODE (a tool). Moving the BSC bridge to a new contract (deploy-kit/README.md, "Moving the BSC bridge").
 *
 *   node project/bridge-accounts.mjs --old 0xOLD [--rpc URL] [--from BLOCK]
 *       Every wallet that ever used the old bridge (its BridgeIn and ClaimOut events), as the list to paste into
 *       the new bridge's importAccounts in Remix.
 *   node project/bridge-accounts.mjs --old 0xOLD --new 0xNEW [--rpc URL] [--from BLOCK]
 *       After the import: compares every wallet's running totals on both bridges, token by token. Close the
 *       migration only when it says "all the same".
 *
 * --rpc: a BSC RPC that answers eth_getLogs (default https://bsc-rpc.publicnode.com).
 * --from: the block the old bridge was deployed in (faster); without it the tool finds it.
 * Reads only: no key, nothing is sent.
 */

import { ethers } from "ethers";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith("--") ? [ ...out, [ a.slice(2), all[i + 1] ] ] : out), []));
const RPC = args.rpc ?? "https://bsc-rpc.publicnode.com";
const STEP = 5_000;          // blocks per eth_getLogs (public RPCs refuse big ranges)

const ABI = [
    "event BridgeIn(address indexed account, address indexed token, uint256 amount, uint256 fee, uint256 total)",
    "event ClaimOut(address indexed account, address indexed token, uint256 paid, uint256 total, address by)",
    "function tokenList() view returns (address[])",
    "function bridgedInOf(address account, address token) view returns (uint256)",
    "function claimedOutOf(address account, address token) view returns (uint256)",
    "function paused() view returns (bool)",
];

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** The first block where the contract has code (binary search) */
async function deployBlock(provider, address, latest) {
    let lo = 0;
    let hi = latest;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if ((await provider.getCode(address, mid)) === "0x") lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

async function accountsOf(provider, address, from, to) {
    const bridge = new ethers.Contract(address, ABI, provider);
    const topics = [ [ bridge.interface.getEvent("BridgeIn").topicHash, bridge.interface.getEvent("ClaimOut").topicHash ] ];
    const accounts = new Set();
    for (let start = from; start <= to; start += STEP) {
        const end = Math.min(start + STEP - 1, to);
        const logs = await provider.getLogs({ address, topics, fromBlock: start, toBlock: end });
        for (const log of logs) accounts.add(ethers.getAddress(ethers.dataSlice(log.topics[1], 12)));
        process.stderr.write(`\rReading blocks ${start}…${end} (${accounts.size} wallets)   `);
    }
    process.stderr.write("\n");
    return [ ...accounts ];
}

async function main() {
    if (!args.old || !ethers.isAddress(args.old)) fail("Usage: node project/bridge-accounts.mjs --old 0xOLD_BRIDGE [--new 0xNEW_BRIDGE] [--rpc URL] [--from BLOCK]");
    const provider = new ethers.JsonRpcProvider(RPC);
    const latest = await provider.getBlockNumber();
    const from = args.from ? Number(args.from) : await deployBlock(provider, args.old, latest);
    console.error(`Old bridge ${args.old}: blocks ${from} to ${latest}`);
    const accounts = await accountsOf(provider, args.old, from, latest);

    if (!args.new) {
        console.error(`${accounts.length} wallets used the old bridge. Paste this into importAccounts (more than ~100: split into several calls):`);
        console.log(JSON.stringify(accounts));
        return;
    }

    if (!ethers.isAddress(args.new)) fail("--new must be an address.");
    const old = new ethers.Contract(args.old, ABI, provider);
    const fresh = new ethers.Contract(args.new, ABI, provider);
    const tokens = await old.tokenList();
    let wrong = 0;
    for (const account of accounts) {
        for (const token of tokens) {
            const [ a, b, c, d ] = await Promise.all([ old.bridgedInOf(account, token), fresh.bridgedInOf(account, token), old.claimedOutOf(account, token), fresh.claimedOutOf(account, token) ]);
            if (a !== b || c !== d) {
                wrong++;
                console.log(`NOT THE SAME ${account} token ${token}: bridgedIn ${a} → ${b}, claimedOut ${c} → ${d}`);
            }
        }
    }
    if (wrong) fail(`${wrong} totals differ: run importAccounts for those wallets, then check again.`);
    console.log(`All the same: ${accounts.length} wallets × ${tokens.length} tokens. You may close the migration.`);
}

main().catch((error) => fail(error?.shortMessage ?? error?.message ?? String(error)));
