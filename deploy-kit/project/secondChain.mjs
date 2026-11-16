/*
 * YOUR CODE (local only). A second EVM chain next to the local BSC, so the bridge is always tested with more than one
 * chain (as on the real network, where more chains will be added). Same contracts as BSC (deploy-kit/bsc/), its own
 * coins, its own routes on the BWSC hub, liquidity on both sides. The website and the bridge signer get it like any
 * chain in settings/config.js `chains`.
 *
 * startSecondChain({ deployed, bsc, local, signerAddress }) → { chain (for the website / signer), anvil, tokens, addresses, stop() } | null
 *   null when anvil is not installed (then there is no BSC either).
 */

import { ethers } from "ethers";
import { startAnvil } from "../engine/bsc/anvil.mjs";
import { proxied, runBscStep } from "../engine/bsc/deploy.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (x) => ethers.parseUnits(String(x), 18);

async function startSecondChain({ deployed, bsc, local, signerAddress, port = Number(local.LOCAL_CHAIN2_PORT), chainId = Number(local.LOCAL_CHAIN2_ID) }) {
    if (!bsc) return null;
    const anvil = await startAnvil({ port, chainId });
    if (!anvil) return null;
    const contracts = bsc.contracts;
    const deployer = anvil.wallet(0);
    const owner = (await deployer.getAddress()).toLowerCase();
    const deploy = async (c, args) => { const x = await new ethers.ContractFactory(c.abi, c.bytecode, deployer).deploy(...args); await x.waitForDeployment(); return (await x.getAddress()).toLowerCase(); };

    // Its coins: the BWSC coin there and a USDT with 18 decimals
    // MockTokens (anyone may mint), like the local BSC's test tokens, so the test panel can hand them out
    const coin = await deploy(contracts.MockToken, [ local.LOCAL_COIN_NAME, local.LOCAL_COIN_SYMBOL, 18 ]);
    const usdt = await deploy(contracts.MockToken, [ "Tether USD (chain 2)", "USDT", 18 ]);
    for (const token of [ coin, usdt ]) await (await new ethers.Contract(token, contracts.MockToken.abi, deployer).mint(owner, units(100_000_000))).wait();

    // Its bridge, routed to BWSC: the BWSC coin ↔ BWSC's native coin, USDT ↔ USDT on BWSC
    const ctx = { owner, contracts };
    const step = proxied({
        name: "BwscBridgeEvm",
        init: () => [ owner, signerAddress, BigInt(local.LOCAL_CHAIN_ID), [ coin, usdt ], [ ZERO, deployed.addresses.USDT ], [ 10n, 10n ], [ units(1), units(5) ] ],
    });
    const bridge = (await runBscStep(step, { wallet: deployer, contracts, ctx })).address;

    // The hub's routes to it (owner = test key #0 deployed everything)
    await deployed.send(deployed.owner, "BwscBridge", "setRoute", { chainId: BigInt(chainId), token: ZERO, remoteToken: coin, enabled: true, feeBps: 10n, min: units(1) });
    await deployed.send(deployed.owner, "BwscBridge", "setRoute", { chainId: BigInt(chainId), token: deployed.addresses.USDT, remoteToken: usdt, enabled: true, feeBps: 10n, min: units(5) });

    // Liquidity there, and coins for the test wallets (the first 10 test keys)
    const evm = new ethers.Contract(bridge, contracts.BwscBridgeEvm.abi, deployer);
    for (const token of [ coin, usdt ]) {
        const c = new ethers.Contract(token, contracts.MockToken.abi, deployer);
        await (await c.approve(bridge, units(1_000_000))).wait();
        await (await evm.addLiquidity(token, units(1_000_000))).wait();
        for (let i = 1; i < 10; i++) await (await c.transfer(await anvil.wallet(i).getAddress(), units(10_000))).wait();
    }

    return {
        anvil,
        addresses: { BwscBridgeEvm: bridge },
        tokens: { [local.LOCAL_COIN_SYMBOL]: { address: coin, decimals: 18 }, USDT: { address: usdt, decimals: 18 } },
        // Its coins for settings/config.js `tokens`
        listed: [
            { chain: "eth", address: usdt, symbol: "USDT", name: "Tether USD (Ethereum)" },
            { chain: "eth", address: coin, symbol: "BWSC", name: "Bluewolfchain (ERC-20)" },
        ],
        chain: {
            key: "eth",
            name: "Ethereum (local)",
            short: "ETH",
            chainId,
            rpcUrl: anvil.url,
            explorerUrl: "",
            native: { symbol: "ETH", name: "Ether", decimals: 18 },
            bridge,
            confirmations: 0,
        },
        stop: () => anvil.stop(),
    };
}

export { startSecondChain };
