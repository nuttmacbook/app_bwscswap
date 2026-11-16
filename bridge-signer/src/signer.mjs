/*
 * Bridge signer: reads a running total on the SOURCE chain and signs it for the DESTINATION chain.
 * BWSC is the hub; every other chain (BSC today, more later) bridges with BWSC through BwscBridgeEvm.
 *
 *   chain → BWSC : total = BwscBridgeEvm.bridgedInOf(account, token) on that chain, read `confirmations` blocks back
 *                  (or at "finalized") → signed for the BwscBridge program on BWSC (claimIn)
 *   BWSC → chain : total = BwscBridge.bridgedOutOf(chainId, account, token) on BWSC (one producer: a block is final)
 *                  → signed for BwscBridgeEvm on that chain (claimOut)
 *
 * Signature: EIP-712 { name: "BwscBridge", version: "2", chainId: destination, verifyingContract: destination bridge }
 *            Claim { account, sourceChainId, token: the coin paid on the destination, total }
 * The destination pays total − already claimed, so signing the same or a larger total again is always safe.
 * Routes are read from BOTH bridges and must point at each other, with the same decimals; anything else is refused.
 *
 * No packages are imported here: ethers and bwscbox are passed in (the service and the test tools each have their own).
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const CLAIM_TYPES = { Claim: [ { name: "account", type: "address" }, { name: "sourceChainId", type: "uint256" }, { name: "token", type: "address" }, { name: "total", type: "uint256" } ] };
const DOMAIN = { name: "BwscBridge", version: "2" };
// Public test keys ("test test … junk"): fine on local chains, never on a real one
const TEST_PHRASE = "test test test test test test test test test test test junk";
const LOCAL_CHAINS = new Set([ 31337, 31338, 31339, 1337 ]);

const EVM_ABI = [
    "function bridgedInOf(address account, address token) view returns (uint256)",
    "function getRoute(address token) view returns (tuple(bool listed, bool enabled, address remoteToken, uint256 feeBps, uint256 min, uint256 held, uint256 fees, uint256 totalBridgedIn, uint256 totalClaimedOut))",
    "function signer() view returns (address)",
    "function remoteChainId() view returns (uint256)",
    "function decimals() view returns (uint8)",
];

class SignerError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

/**
 * @param {{ ethers, createClient }} libs
 * @param {object} config
 * @param {string} config.key                                       signer private key
 * @param {{ nodeUrl, bridge }} config.hub                         BWSC
 * @param {Array<{ key, rpcUrl, bridge, confirmations }>} config.chains   every other chain ("finalized" or a number of blocks)
 */
function createBridgeSigner({ ethers, createClient }, config) {
    const wallet = new ethers.Wallet(config.key);
    const me = wallet.address.toLowerCase();
    const lower = (a) => String(a ?? "").toLowerCase();
    const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ""));
    const hub = createClient({ node: config.hub.nodeUrl });
    const hubBridge = lower(config.hub.bridge);
    const hubQuery = (method, input) => hub.query({ program: hubBridge, method, input });

    // One provider and contract per chain. cacheTimeout -1: always the chain's current answer
    const chains = (config.chains ?? []).filter((c) => c.rpcUrl && isAddress(c.bridge)).map((c) => {
        const provider = new ethers.JsonRpcProvider(c.rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
        return {
            key: c.key,
            provider,
            bridgeAddress: lower(c.bridge),
            bridge: new ethers.Contract(c.bridge, EVM_ABI, provider),
            confirmations: c.confirmations === "finalized" ? "finalized" : Number(c.confirmations ?? 15),
            headBlock: async () => Number(await provider.send("eth_blockNumber", [])),
            chainId: 0,
        };
    });

    // A failed read says WHICH chain and what it answered, so the website (and this terminal) show the real cause.
    // URLs are hidden: an RPC address may carry an API key.
    const reason = (e) => String(e?.shortMessage ?? e?.reason ?? e?.message ?? e).replace(/https?:\/\/[^\s)]+/g, "<rpc>").replace(/\s+/g, " ").slice(0, 180);
    const read = (label, load) => Promise.resolve().then(load).catch((e) => {
        if (e instanceof SignerError) throw e;
        throw new SignerError(`The signer could not read ${label}: ${reason(e)}`, 502);
    });

    /**
     * The block a deposit must be in before it is signed, as a NUMBER: "finalized" is looked up first, then the total
     * is read at that number. (Some public RPCs, e.g. load-balanced pools, answer eth_call with the "finalized" tag
     * from a node that is behind and revert; a block number works on every node.)
     */
    async function safeBlock(c) {
        if (c.confirmations !== "finalized") return Math.max(0, (await c.headBlock()) - c.confirmations);
        const block = await c.provider.send("eth_getBlockByNumber", [ "finalized", false ]);
        if (!block?.number) throw new Error(`this RPC has no "finalized" block: use another rpcUrl, or set confirmations to a number of blocks`);
        return Number(block.number);
    }

    /** load(), tried up to 3 times (a public RPC pool may send one call to a node that is a little behind) */
    async function retry(load) {
        for (let i = 0; ; i++) {
            try { return await load(); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
        }
    }

    let ready = null;
    /** Chain ids and signer checks, once */
    function setup() {
        ready ??= (async () => {
            const [ genesis, view ] = await read("BWSC (hub.nodeUrl, programs.bridge)", () => Promise.all([ hub.genesis(), hubQuery("getView", { account: "", offset: 0n, limit: 1n }) ]));
            const hubChainId = Number(genesis.chainId);
            if (lower(view.signer) !== me) throw new SignerError(`BwscBridge's signer is ${view.signer}, but this key is ${wallet.address}.`, 500);
            for (const c of chains) {
                const [ network, signer, remote ] = await read(`${c.key} (its rpcUrl, and bridge = the BwscBridgeEvm proxy)`, () => Promise.all([ c.provider.getNetwork(), c.bridge.signer(), c.bridge.remoteChainId() ]));
                c.chainId = Number(network.chainId);
                if (lower(signer) !== me) throw new SignerError(`The bridge on ${c.key}'s signer is ${signer}, but this key is ${wallet.address}.`, 500);
                if (Number(remote) !== hubChainId) throw new SignerError(`The bridge on ${c.key} bridges with chain ${remote}, not BWSC (${hubChainId}).`, 500);
            }
            const isTestKey = Array.from({ length: 30 }, (_, i) => lower(ethers.HDNodeWallet.fromPhrase(TEST_PHRASE, undefined, `m/44'/60'/0'/0/${i}`).address)).includes(me);
            const allLocal = LOCAL_CHAINS.has(hubChainId) && chains.every((c) => LOCAL_CHAINS.has(c.chainId));
            if (isTestKey && !allLocal) throw new SignerError("The signer key is a public test key: never use it on a real chain. Set SIGNER_PRIVATE_KEY to your own key.", 500);
            return { hubChainId };
        })().catch((error) => { ready = null; throw error; });
        return ready;
    }

    /** A chain by key ("bsc") or chain id; "bwsc" / the hub's id is the hub */
    async function chainOf(name) {
        const { hubChainId } = await setup();
        const text = String(name ?? "").toLowerCase();
        if (text === "bwsc" || text === "hub" || Number(text) === hubChainId) return null;
        const c = chains.find((x) => lower(x.key) === text || String(x.chainId) === text);
        if (!c) throw new SignerError(`Unknown chain "${name}". Chains: bwsc, ${chains.map((x) => `${x.key} (${x.chainId})`).join(", ")}.`);
        return c;
    }

    const evmDecimals = (c, token) => (lower(token) === ZERO ? 18 : new ethers.Contract(token, EVM_ABI, c.provider).decimals().then(Number));
    const hubDecimals = (token) => (lower(token) === ZERO ? 18 : hub.query({ program: lower(token), method: "decimals", input: {} }).then(Number));
    async function sameDecimals(c, evmToken, hubToken) {
        const [ a, b ] = await read(`the coin's decimals (${c.key} and BWSC)`, () => Promise.all([ evmDecimals(c, evmToken), hubDecimals(hubToken) ]));
        if (a !== b) throw new SignerError(`The coin has ${a} decimals on ${c.key} and ${b} on BWSC: the bridge pays 1:1, so it will not sign this route.`, 409);
    }

    /**
     * Signs the running total of `account` for `token` (the SOURCE chain's coin; 0x0…0 = that chain's own coin).
     * @param {{ from, to, account, token }} q  from / to: "bwsc" or a chain key / id (one of them must be BWSC)
     * @returns {Promise<{ from, to, account, sourceToken, token, total, signature, chainId, sourceChainId, bridge }>}
     *          signature is null when the total is 0 (nothing bridged yet)
     */
    async function claim({ from, to, account, token }) {
        if (!isAddress(account) || lower(account) === ZERO) throw new SignerError("account must be an address.");
        if (!isAddress(token)) throw new SignerError("token must be the coin's address on the source chain (0x0…0 for its own coin).");
        const { hubChainId } = await setup();
        const src = await chainOf(from);
        const dst = await chainOf(to ?? (src ? "bwsc" : ""));
        if ((src === null) === (dst === null)) throw new SignerError("One side must be BWSC: from a chain to bwsc, or from bwsc to a chain.");
        const who = lower(account);
        const sourceToken = lower(token);
        let total;
        let destToken;
        let sourceChainId;
        let chainId;
        let bridge;
        let confirmations = 0;
        let atBlock = null;
        if (src) {
            // chain → BWSC
            const route = await read(`the route on ${src.key}`, () => src.bridge.getRoute(sourceToken));
            if (!route.listed) throw new SignerError(`That coin has no route on ${src.key}.`);
            destToken = lower(route.remoteToken);
            const back = await read("the route on BWSC", () => hubQuery("getRoute", { chainId: BigInt(src.chainId), token: destToken }));
            if (!back || lower(back.remoteToken) !== sourceToken) throw new SignerError("The route is not the same on both bridges. Ask the owner to fix setRoute.", 409);
            await sameDecimals(src, sourceToken, destToken);
            const at = atBlock = await read(`the ${src.confirmations === "finalized" ? "finalized" : "latest"} block on ${src.key}`, () => retry(() => safeBlock(src)));
            total = await read(`your total on ${src.key} at block ${at} (if this keeps failing, use another rpcUrl for ${src.key})`, () => retry(() => src.bridge.bridgedInOf(who, sourceToken, { blockTag: at })));
            sourceChainId = src.chainId;
            chainId = hubChainId;
            bridge = hubBridge;
            confirmations = src.confirmations;
        } else {
            // BWSC → chain
            const route = await read("the route on BWSC", () => hubQuery("getRoute", { chainId: BigInt(dst.chainId), token: sourceToken }));
            if (!route) throw new SignerError(`That coin has no route to ${dst.key} on BWSC.`);
            destToken = lower(route.remoteToken);
            const back = await read(`the route on ${dst.key}`, () => dst.bridge.getRoute(destToken));
            if (!back.listed || lower(back.remoteToken) !== sourceToken) throw new SignerError("The route is not the same on both bridges. Ask the owner to fix setRoute.", 409);
            await sameDecimals(dst, destToken, sourceToken);
            total = await read("your total on BWSC", () => hubQuery("bridgedOutOf", { chainId: BigInt(dst.chainId), account: who, token: sourceToken }));
            sourceChainId = hubChainId;
            chainId = dst.chainId;
            bridge = dst.bridgeAddress;
        }
        total = BigInt(total);
        // atBlock: the source chain's block the total was read at (null when the source is BWSC: final at once)
        const out = { from: src ? src.key : "bwsc", to: dst ? dst.key : "bwsc", account: who, sourceToken, token: destToken, total: total.toString(), chainId, sourceChainId, bridge, confirmations, atBlock, signature: null };
        if (total === 0n) return out;
        out.signature = await wallet.signTypedData({ ...DOMAIN, chainId, verifyingContract: bridge }, CLAIM_TYPES, { account: who, sourceChainId, token: destToken, total });
        return out;
    }

    /** For /status: who signs, the chains, how far back each is read */
    async function status() {
        const { hubChainId } = await setup();
        return { signer: me, hub: { chainId: hubChainId, bridge: hubBridge }, chains: chains.map((c) => ({ key: c.key, chainId: c.chainId, bridge: c.bridgeAddress, confirmations: c.confirmations })) };
    }

    return { claim, status, address: me, stop: () => chains.forEach((c) => c.provider.destroy()) };
}

export { createBridgeSigner, SignerError, CLAIM_TYPES, DOMAIN };
