/*
 * ENGINE (same in every project, do not edit).
 *
 * A local BSC for the bridge: anvil (from Foundry) on this computer, in memory, with the public test keys funded.
 * Found at ANVIL_BIN, on PATH, or in ~/.foundry/bin. Not installed → null, and the bridge runs without a BSC side.
 * Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { ethers } from "ethers";

const TEST_PHRASE = "test test test test test test test test test test test junk";

/** Path of the anvil binary, or null */
function findAnvil() {
    const candidates = [ process.env.ANVIL_BIN, "anvil", path.join(os.homedir(), ".foundry", "bin", "anvil") ].filter(Boolean);
    for (const bin of candidates) {
        try {
            execFileSync(bin, [ "--version" ], { stdio: "ignore" });
            return bin;
        } catch { /* next */ }
    }
    return null;
}

/**
 * Starts anvil. Returns null when it is not installed.
 * @returns {Promise<{ url, chainId, provider, stop(), wallet(i) } | null>}
 */
async function startAnvil({ port, chainId, blockTime = 0 }) {
    const bin = findAnvil();
    if (!bin) return null;
    const args = [ "--port", String(port), "--chain-id", String(chainId), "--mnemonic", TEST_PHRASE, "--accounts", "30", "--balance", "100000", "--silent" ];
    if (blockTime > 0) args.push("--block-time", String(blockTime));
    const child = spawn(bin, args, { stdio: "ignore" });
    const url = `http://127.0.0.1:${port}`;
    // cacheTimeout -1: no cached answers, so every send reads the real next nonce (anvil mines at once)
    const provider = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true, pollingInterval: 200, cacheTimeout: -1 });
    for (let i = 0; ; i++) {
        try {
            await provider.getBlockNumber();
            break;
        } catch (error) {
            if (i > 100 || child.exitCode !== null) {
                child.kill();
                throw new Error(`anvil did not start on port ${port} (${error.message}). Is the port in use?`);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    // Plain wallets (no NonceManager: it skips a nonce when a send fails before it is sent, and the next tx waits forever)
    const wallet = (i) => ethers.HDNodeWallet.fromPhrase(TEST_PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
    return { url, chainId, provider, wallet, stop: () => { provider.destroy(); child.kill(); } };
}

export { findAnvil, startAnvil };
