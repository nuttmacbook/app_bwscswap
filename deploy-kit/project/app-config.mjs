/*
 * TEST CHAIN ONLY. What the local test chains deployed, in the shape of settings/config.js.
 * npm run dev and the app tests hand this to the website as VITE_CONFIG (merged over settings/config.js;
 * your file is never touched).
 */

/**
 * @param {object} o
 * @param {string} o.nodeUrl     the local BWSC node
 * @param {object} o.local       deploy-kit/settings/local.env
 * @param {object} o.deployed    BWSC side (addresses, tokens)
 * @param {object|null} o.bsc    the local BSC (anvil), or null when anvil is not installed
 * @param {string} o.signerUrl   the local bridge signer ("" without BSC)
 * @param {object[]} o.extraChains / o.extraTokens  more local chains (project/secondChain.mjs) and their coins
 */
const testConfig = ({ nodeUrl, local, deployed, bsc, signerUrl, extraChains = [], extraTokens = [] }) => ({
    hub: {
        chainId: Number(local.LOCAL_CHAIN_ID),
        nodeUrl,
        explorerUrl: nodeUrl,
        native: { symbol: local.LOCAL_COIN_SYMBOL, name: local.LOCAL_COIN_NAME, decimals: 18 },
    },
    programs: {
        dex: deployed.addresses.BwscDex ?? "",
        staking: deployed.addresses.BwscStaking ?? "",
        limit: deployed.addresses.BwscLimit ?? "",
        bridge: deployed.addresses.BwscBridge ?? "",
    },
    chains: [ {
        key: "bsc",
        name: "BNB Smart Chain (local)",
        short: "BSC",
        chainId: bsc ? Number(bsc.anvil.chainId) : Number(local.LOCAL_BSC_CHAIN_ID),
        rpcUrl: bsc?.anvil.url ?? "",
        explorerUrl: "",
        native: { symbol: "BNB", name: "BNB", decimals: 18 },
        bridge: bsc?.addresses.BwscBridgeEvm ?? "",
        confirmations: 0,
    }, ...extraChains ],
    bridgeSigner: { url: signerUrl || "", autoDeliver: true },
    // The four example games of settings/config.js, three of them live on the local chain (example.com links)
    directory: {
        apps: [
        { id: "wolf-runner", name: "Wolf Runner", category: "games", url: "https://example.com/wolf-runner", addedAt: new Date().toISOString().slice(0, 10), featured: true,
            logo: "/apps/wolf-runner.svg", cover: "/apps/wolf-runner-cover.svg", developer: "Night Pack Studio",
            description: "Run through the night forest, dodge traps and collect coins. Best scores win weekly prizes.",
            about: "An endless runner in a forest that changes every night. Jump, slide and dash past traps and collect BWSC on the way.\n\nThe best ten scores of each week share the prize pool. Scores are written to the chain, so anyone can check the leaderboard.",
            tags: [ "arcade", "runner", "leaderboard" ], risk: "low",
            audit: { by: "Example Audits", url: "https://example.com/audits/wolf-runner.pdf", date: "2026-11" },
            links: { website: "https://example.com/wolf-runner", x: "https://x.com/example" } },
        { id: "chain-chess", name: "Chain Chess", category: "games", url: "https://example.com/chain-chess", addedAt: "2026-10-01", featured: true, status: "beta",
            logo: "/apps/chain-chess.svg", cover: "/apps/chain-chess-cover.svg", developer: "Bluewolfchain",
            description: "Play chess against anyone. Every move is a transaction, every game can be replayed from the chain.",
            about: "Challenge anyone to a game of chess. Every move is a transaction, so a game can never be changed afterwards and can be replayed move by move from the chain.\n\nPlay for fun or put a stake on the game: the program holds both stakes and pays the winner.",
            tags: [ "board", "pvp", "strategy" ], core: true, risk: "low",
            links: { website: "https://example.com/chain-chess", github: "https://github.com/example/chain-chess" } },
        { id: "moon-dice", name: "Moon Dice", category: "games", url: "https://example.com/moon-dice", addedAt: "2026-09-01",
            logo: "/apps/moon-dice.svg", cover: "/apps/moon-dice-cover.svg", developer: "Lucky Labs",
            description: "Roll against the program. Odds and payouts are in the code for anyone to read.",
            about: "A dice game of pure chance against the program. The odds and payouts are written in the program's code for anyone to read.\n\nThis is gambling: you can lose what you bet. Only play with what you can afford to lose.",
            tags: [ "dice", "luck", "chance" ], risk: "high",
            links: { website: "https://example.com/moon-dice", telegram: "https://t.me/example" } },
        { id: "pixel-farm", name: "Pixel Farm", category: "games", url: "", addedAt: "2026-09-20",
            logo: "/apps/pixel-farm.svg", cover: "/apps/pixel-farm-cover.svg", developer: "Tiny Acres",
            description: "Grow crops, trade harvests with neighbours and build the biggest farm on the chain.",
            about: "A slow, friendly farming game. Plant crops, wait for the harvest and trade it with neighbours.\n\nOpening soon.",
            tags: [ "farming", "idle", "nft" ], risk: "medium" },
        ],
    },
    tokens: [
        { chain: "bwsc", address: deployed.addresses.USDT ?? "", symbol: "USDT", name: "Tether USD" },
        { chain: "bwsc", address: deployed.addresses.WBWSC ?? "", symbol: "wBWSC", name: "Wrapped BWSC", wraps: "native" },
        { chain: "bsc", address: bsc?.tokens.USDT?.address ?? "", symbol: "USDT", name: "Tether USD (BSC)" },
        { chain: "bsc", address: bsc?.tokens.tBWSC?.address ?? "", symbol: "BWSC", name: "Bluewolfchain (BEP-20)" },
        ...extraTokens,
    ],
});

export { testConfig };
