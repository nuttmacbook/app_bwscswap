/*
 * YOUR CODE (on-chain, local only). Test panel buttons for THIS project only, shown under "This project".
 * Tools every project needs (coins for gas, tokens, demo wallet) are already in the panel: deploy-kit/engine/web.
 *
 * Each button: { label, run(tools, progress) }
 *   tools     tools.wallet (active wallet), newWallet(), fundGas(address), fundToken(address, symbol, amount),
 *             tokenAs(symbol, signer), programAs(program, signer), readerOf(program), client, funder, utils
 *   progress  (text) => shows text in the toast while it runs
 */

import { DexProgram } from "../../src/project/chain/programs";
import { config } from "../../src/engine/settings";

const ZERO = "0x0000000000000000000000000000000000000000";

/** `count` new people each swap once (half BWSC → USDT, half USDT → BWSC) on the first pair with the native coin */
const traders = (count) => async ({ newWallet, fundGas, fundToken, tokenAs, readerOf, programAs, utils }, progress) => {
    const view = await readerOf(DexProgram).read.getView({ account: "", offset: "0n", limit: "1n" });
    const pair = view.pairs[0];
    if (!pair) throw new Error("No pair yet.");
    const other = pair.tokenA === view.wrapped ? pair.tokenB : pair.tokenA;
    const token = view.tokens.find((t) => t.address === other);
    for (let i = 1; i <= count; i++) {
        const person = newWallet();
        const nativeIn = i % 2 === 1;
        await fundGas(person.address, nativeIn ? 25 : 1);
        if (nativeIn) {
            const amountIn = utils.toUnits("20", 18);
            await (await programAs(DexProgram, person.signer).swap({ path: [ ZERO, other ], amountIn: `${amountIn}n`, minOut: "0n" }, { value: String(amountIn) })).wait();
        } else {
            const amountIn = utils.toUnits("15", Number(token.decimals));
            await fundToken(person.address, token.symbol, 15);
            await (await tokenAs(token.symbol, person.signer).approve({ spender: DexProgram.address, amount: `${amountIn}n` })).wait();
            await (await programAs(DexProgram, person.signer).swap({ path: [ other, ZERO ], amountIn: `${amountIn}n`, minOut: "0n" })).wait();
        }
        progress(`${i} of ${count} swapped…`);
    }
};

/** Owner (test key 0 deployed everything) pauses or resumes the exchange */
const togglePause = async ({ programAs, readerOf, ethers }) => {
    const view = await readerOf(DexProgram).read.getView({ account: "", offset: "0n", limit: "1n" });
    const owner = ownerSigner(ethers);
    // The website's program file only lists the functions pages use; owner tools need the full program
    await (await programAs({ name: DexProgram.name, address: DexProgram.address }, owner).setPaused({ paused: !view.paused })).wait();
};

// The local owner key is the public test key #0 (deploy-kit/engine/node.mjs); never a real key
const ownerSigner = (ethers) => {
    const wallet = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/0");
    return { address: wallet.address.toLowerCase(), signTransaction: (tx) => import("bwscbox").then(({ keyWalletSigner }) => keyWalletSigner(wallet).signTransaction(tx)) };
};

/* ------------------------------------ the local EVM chains (anvil), for the bridge */

// Every chain in the website's settings `chains` (the local BSC and the second local chain), with its listed tokens.
// Test tokens there are MockTokens: anyone may mint, so the funder (test key #1) mints to the wallet.
const localChains = (config.chains ?? []).filter((c) => /^http:\/\/(127\.0\.0\.1|localhost)/.test(String(c.rpcUrl ?? "")));
const short = (c) => String(c.short ?? c.key).toUpperCase();

const fundOn = (chain, symbol, amount) => async ({ wallet, ethers }) => {
    if (!wallet?.address) throw new Error("Connect a wallet or turn on the demo wallet first.");
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true, cacheTimeout: -1 });
    const funder = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/1").connect(provider);
    if (!symbol) {
        await (await funder.sendTransaction({ to: wallet.address, value: ethers.parseEther(String(amount)) })).wait();
        return;
    }
    const listed = (config.tokens ?? []).find((t) => t.chain === chain.key && t.symbol === symbol);
    const token = new ethers.Contract(listed.address, [ "function mint(address to, uint256 amount)", "function decimals() view returns (uint8)" ], funder);
    await (await token.mint(wallet.address, ethers.parseUnits(String(amount), await token.decimals()))).wait();
};

const chainActions = localChains.flatMap((c) => [
    { label: `+1 ${c.native?.symbol ?? "coin"} on ${short(c)} (gas)`, run: fundOn(c, "", 1) },
    ...(config.tokens ?? []).filter((t) => t.chain === c.key && t.address).map((t) => ({ label: `+1000 ${t.symbol} on ${short(c)}`, run: fundOn(c, t.symbol, 1000) })),
]);

/** The demo wallet becomes the owner (test key #0: deployed everything), e.g. to add staking rewards on the page */
const ownerAsDemo = async ({ ethers }) => {
    const owner = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/0");
    try {
        localStorage.setItem("bwsc.local.demoKey", owner.privateKey);
        localStorage.setItem("bwsc.local.demoOn", "1");
    } catch {}
    // No reload needed: the panel refreshes the page, and the demo wallet is read from storage again
};

const devActions = [
    { label: "4 people swap", run: traders(4) },
    { label: "Pause / resume swaps (owner)", run: togglePause },
    { label: "Demo wallet = owner", run: ownerAsDemo },
    ...chainActions,
];

export { devActions };
