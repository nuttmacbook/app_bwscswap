/*
 * YOUR CODE (local only). Services this project runs next to the local chains during npm run dev and npm run test:app.
 * Here: pairs and staking pools (deploy-kit/settings/test-setup.json), bridge liquidity on both sides, a second EVM
 * chain (project/secondChain.mjs: the bridge always has more than one chain), and the bridge signer (bridge-signer/)
 * with the local signer key (test key #4) for every chain.
 *
 * start({ deployed, bsc, local, client, nodeUrl, port, chain2Port }) → { signerUrl (for the website), chains (more chains
 *   for the website settings), evm (chainId → provider, for the test wallet), lines (printed when ready), stop() }
 * bsc is null when anvil is not installed: the bridge then has no BSC side and the page says so.
 */

import { ethers } from "ethers";
import { createClient } from "bwscbox";
import { devKey } from "../engine/node.mjs";
import { createBridgeSigner } from "../../bridge-signer/src/signer.mjs";
import { createSignerServer } from "../../bridge-signer/src/http.mjs";
import { createRelayer } from "../../bridge-signer/src/relayer.mjs";
import { keyWalletSigner } from "bwscbox";
import { seedBridge } from "./seed.mjs";
import { setupPairs, setupPools, setupLimitOrders } from "./test-setup.mjs";
import { startSecondChain } from "./secondChain.mjs";

async function start({ deployed, bsc, local, nodeUrl, port = Number(local.LOCAL_SIGNER_PORT), chain2Port = Number(local.LOCAL_CHAIN2_PORT) }) {
    const pairs = await setupPairs(deployed);
    const pools = await setupPools(deployed, local);
    const orders = await setupLimitOrders(deployed);
    const poolLine = [ `  ${"Pairs".padEnd(26)} ${pairs.join(", ") || "none"}`, `  ${"Staking pools".padEnd(26)} ${pools.join(", ") || "none"}`, `  ${"Limit orders".padEnd(26)} ${orders} open` ];
    await seedBridge({ deployed, bsc });
    if (!bsc) return { signerUrl: "", chains: [], tokens: [], evm: new Map(), lines: poolLine, stop: () => {} };
    const signerAddress = new ethers.Wallet(devKey(4)).address;
    const second = await startSecondChain({ deployed, bsc, local, signerAddress, port: chain2Port });
    const signer = createBridgeSigner({ ethers, createClient }, {
        key: devKey(4),
        hub: { nodeUrl, bridge: deployed.addresses.BwscBridge },
        chains: [
            { key: "bsc", rpcUrl: bsc.anvil.url, bridge: bsc.addresses.BwscBridgeEvm, confirmations: 0 },
            ...(second ? [ { key: second.chain.key, rpcUrl: second.chain.rpcUrl, bridge: second.chain.bridge, confirmations: 0 } ] : []),
        ],
    });
    // Automatic delivery, like the real signer (bridgeSigner.autoDeliver): the same test key #4 pays the claims' gas,
    // and a wallet with no BWSC gets 0.5 BWSC with its first delivery of another coin
    const relayer = createRelayer({ ethers, createClient, keyWalletSigner }, {
        signer,
        key: devKey(4),
        hub: { key: "bwsc", nodeUrl, bridge: deployed.addresses.BwscBridge, gasDrop: ethers.parseEther("0.5") },
        chains: [
            { key: "bsc", rpcUrl: bsc.anvil.url, bridge: bsc.addresses.BwscBridgeEvm, gasDrop: 0n },
            ...(second ? [ { key: second.chain.key, rpcUrl: second.chain.rpcUrl, bridge: second.chain.bridge, gasDrop: 0n } ] : []),
        ],
        intervalMs: 1000,
        log: { log: () => {}, error: (m) => console.error(`  ${m}`) },
    });
    await relayer.start();
    const server = createSignerServer(signer, { allowOrigin: "*", perMinute: 600, relayer });
    await new Promise((resolve) => server.listen(port, resolve));
    const url = `http://127.0.0.1:${port}`;
    const evm = new Map([ [ Number(bsc.anvil.chainId), bsc.anvil.provider ], ...(second ? [ [ Number(second.chain.chainId), second.anvil.provider ] ] : []) ]);
    return {
        signerUrl: url,
        chains: second ? [ second.chain ] : [],
        tokens: second ? second.listed : [],
        secondChain: second,
        relayer,
        evm,
        lines: [ ...poolLine,
            ...(second ? [ `  ${"Second chain".padEnd(26)} ${second.chain.name} at ${second.chain.rpcUrl} (chain ${second.chain.chainId}), bridge ${second.chain.bridge}` ] : []),
            `  ${"Bridge signer".padEnd(26)} ${url}  (key: public test key #4, ${signer.address}), ${second ? "2 chains" : "1 chain"}, delivers by itself` ],
        stop: () => { server.close(); relayer.stop(); signer.stop(); second?.stop(); },
    };
}

export { start };
