/*
 * ⚙️  THE settings file. Everything you can change without touching code is here, in one place:
 * the website, the chains, the coins, the program addresses — and the bridge signer reads the same file.
 *
 * After deploying (deploy-kit/README.md), paste the addresses into `programs`, `chains[].bridge` and `tokens[].address`.
 * An empty address means "not deployed yet": the page that needs it says so, the rest of the site works.
 * Everything here ends up in the public website: never put a private key in this file.
 */

export default {
    /* ------------------------------------------------------------ the website */
    app: {
        // This site is the chain's main website: the home page presents the chain, the other pages are its apps
        name: "Bluewolfchain",
        tagline: "Smart contracts in plain JavaScript.",
        description: "BWSC is a blockchain whose programs you can read like any JavaScript file. Every transaction is checked before it is queued, and the wallet you already use signs it in readable fields. Swap, bridge and stake are live on it today.",
        // Public address of the site (no trailing slash): link previews, and the only site the bridge signer answers
        siteUrl: "https://swap.example.com",
    },

    /* ------------------------------------------------------------ BWSC: the chain the site runs on (the bridge hub) */
    hub: {
        key: "bwsc",
        name: "Bluewolfchain",
        chainId: 41234,
        nodeUrl: "https://syncblock.network",
        explorerUrl: "https://syncblock.network",
        // The chain's own coin (as the node's GET /evm reports it)
        native: { symbol: "BWSC", name: "Bluewolfchain", decimals: 18, logo: "/coins/bwsc.svg" },
        // Pictures in public/: logo = the chain's mark (chain badges), native.logo = the coin (also used for wBWSC)
        logo: "/logo.svg",
    },

    /* ------------------------------------------------------------ programs on BWSC (deploy-kit/bwsc/) */
    programs: {
        dex: "0x49e79ee25dcd834fc4b32317604e702760992422",          // BwscDex: every swap pair
        staking: "0xd76511e694ac1db3feb6e77b2f7461b81f1bb08a",      // BwscStaking: every stake pool
        limit: "0xc1dfaf06b56fb3b38f13ece2e93cb07904475b1c",        // BwscLimit: limit orders (coin for coin at your price)
        bridge: "0x73a504d7dd9f60ba8fd24f41a27f11e537bfd4f3",       // BwscBridge: the bridge hub
    },

    /* ------------------------------------------------------------ the app directory (#/apps, the home page, the header search) */
    // The chain's own tools (Swap, Limit orders, Pool, Bridge, Stake, Explorer) are always listed with the Core badge.
    // Add every other app here: games, other projects, tools. Order = the order shown under "Featured".
    // Each app has a card in the list (logo, name, category color, badges, one line) and its own page #/app?id=…
    //   id           a short unique name (a-z, 0-9, -)
    //   name, category (one of `categories`), description (one line for the card)
    //   url          "https://…" another site (opens in a new tab) · "#/page" a page of this site · "" = Coming soon
    //   logo         square picture, 128 px+ · cover: wide picture for the app's page (about 3:1, 1200×400)
    //                "https://…" or a file in public/ ("/apps/my-game.png")
    //   about        the full text for the app's page (blank line = new paragraph)
    //   screenshots  [ "/apps/shot-1.png", … ] for the app's page
    //   developer    who made it · links: { website, docs, x, telegram, discord, github } (https://)
    //   programs     [ { label: "Game", address: "0x…" } ] its programs on this chain (linked to the explorer)
    // Badges (shown on the card and explained on the app's page):
    //   core: true          made by the chain team (Core)
    //   audit: { by, url, date }   audited, with a link to the report (Audited)
    //   risk: "low" | "medium" | "high"
    //   status: "beta" (Beta) · addedAt: "2026-11-15" (New for 30 days, and "Newest") · no url (Coming soon)
    //   featured: true      on the home page and first in the list · tags: more words the search finds
    directory: {
        categories: [
            // tone: the category's color (sky, fuchsia, emerald, amber, violet, rose, zinc, brand)
            { id: "defi", label: "DeFi", tone: "sky" },
            { id: "games", label: "Games", tone: "fuchsia" },
            { id: "tools", label: "Tools", tone: "zinc" },
            { id: "nft", label: "NFT", tone: "violet" },
            { id: "social", label: "Social", tone: "emerald" },
        ],
        apps: [
            // EXAMPLES: four games to show how the directory looks (pictures in public/apps/). Replace with your real apps;
            // fill url to make one live ("" = Coming soon).
            // { id: "wolf-runner", name: "Wolf Runner", category: "games", url: "", addedAt: "2026-11-15", featured: true,
            //     logo: "/apps/wolf-runner.svg", cover: "/apps/wolf-runner-cover.svg", developer: "Night Pack Studio",
            //     description: "Run through the night forest, dodge traps and collect coins. Best scores win weekly prizes.",
            //     about: "An endless runner in a forest that changes every night. Jump, slide and dash past traps and collect BWSC on the way.\n\nThe best ten scores of each week share the prize pool. Scores are written to the chain, so anyone can check the leaderboard.",
            //     tags: [ "arcade", "runner", "leaderboard" ], risk: "low",
            //     audit: { by: "Example Audits", url: "https://example.com/audits/wolf-runner.pdf", date: "2026-11" },
            //     links: { website: "https://example.com/wolf-runner", x: "https://x.com/example" } },
            // { id: "chain-chess", name: "Chain Chess", category: "games", url: "", addedAt: "2026-10-01", featured: true, status: "beta",
            //     logo: "/apps/chain-chess.svg", cover: "/apps/chain-chess-cover.svg", developer: "Bluewolfchain",
            //     description: "Play chess against anyone. Every move is a transaction, every game can be replayed from the chain.",
            //     about: "Challenge anyone to a game of chess. Every move is a transaction, so a game can never be changed afterwards and can be replayed move by move from the chain.\n\nPlay for fun or put a stake on the game: the program holds both stakes and pays the winner.",
            //     tags: [ "board", "pvp", "strategy" ], core: true, risk: "low",
            //     links: { website: "https://example.com/chain-chess", github: "https://github.com/example/chain-chess" } },
            // { id: "moon-dice", name: "Moon Dice", category: "games", url: "", addedAt: "2026-09-01",
            //     logo: "/apps/moon-dice.svg", cover: "/apps/moon-dice-cover.svg", developer: "Lucky Labs",
            //     description: "Roll against the program. Odds and payouts are in the code for anyone to read.",
            //     about: "A dice game of pure chance against the program. The odds and payouts are written in the program's code for anyone to read.\n\nThis is gambling: you can lose what you bet. Only play with what you can afford to lose.",
            //     tags: [ "dice", "luck", "chance" ], risk: "high",
            //     links: { website: "https://example.com/moon-dice", telegram: "https://t.me/example" } },
            // { id: "pixel-farm", name: "Pixel Farm", category: "games", url: "", addedAt: "2026-09-20",
            //     logo: "/apps/pixel-farm.svg", cover: "/apps/pixel-farm-cover.svg", developer: "Tiny Acres",
            //     description: "Grow crops, trade harvests with neighbours and build the biggest farm on the chain.",
            //     about: "A slow, friendly farming game. Plant crops, wait for the harvest and trade it with neighbours.\n\nOpening soon.",
            //     tags: [ "farming", "idle", "nft" ], risk: "medium" },
        ],
    },

    /* ------------------------------------------------------------ other chains the bridge reaches (deploy-kit/bsc/) */
    // Every chain bridges with Bluewolfchain (the hub). Any EVM chain works: deploy BwscBridgeEvm there (the same
    // contract on every chain), add its routes on BOTH bridges (setRoute), add the chain to bridge-signer/ and add one
    // entry here. The bridge page, the wallet and the signer pick it up; no code changes.
    //   key           a short id used in `tokens` below and by the bridge signer (the same key there)
    //   short         a few letters shown on small screens (optional; the key in capitals otherwise)
    //   bridge        the PROXY address of BwscBridgeEvm on that chain
    //   confirmations how long a deposit waits before the signer signs it: "finalized" or a number of blocks
    //                 (the same value as in bridge-signer/; shown on the bridge page)
    // Example of one more chain:
    //   { key: "eth", short: "ETH", name: "Ethereum", chainId: 1, rpcUrl: "https://ethereum-rpc.publicnode.com",
    //     explorerUrl: "https://etherscan.io", native: { symbol: "ETH", name: "Ether", decimals: 18 }, bridge: "0x…",
    //     confirmations: "finalized" },
    chains: [
        {
            logo: "/brand/bnbchain.png",
            key: "bsc",
            short: "BSC",
            name: "BNB Smart Chain",
            chainId: 56,
            rpcUrl: "https://bsc-dataseed.bnbchain.org",
            explorerUrl: "https://bscscan.com",
            native: { symbol: "BNB", name: "BNB", decimals: 18 },
            bridge: "0x3Bb85299a595c9B80F7dA1777a26A1dDF0105e45",
            confirmations: 20,
        },
    ],

    /* ------------------------------------------------------------ wallet connection (Reown AppKit / WalletConnect) */
    wallet: {
        // Project ID from https://dashboard.reown.com (free). Public, not a secret. In the dashboard, add your site's
        // domain (app.siteUrl) to the project's allowed domains, or wallets will not connect.
        reownProjectId: "4b2194bd0448ba60db7cf89f36a94c0f",
    },

    /* ------------------------------------------------------------ the bridge signer (bridge-signer/, on your server) */
    bridgeSigner: {
        url: "https://signer.example.com",
        // Automatic delivery: the signer's relayer sends every claim itself and pays its gas, so users only press
        // "Bridge" and the coins arrive. false = users press "Claim" on the bridge page themselves.
        autoDeliver: true,
        // A little of the destination chain's own coin, sent once to a wallet that has none, with its first delivery
        // of another coin (e.g. USDT in from BSC), so a brand-new wallet can pay its first gas. Whole coins per chain
        // key; "0" = off. The relayer wallet pays it: keep the bridge minimum (`min` of each route) well above it.
        gasDrop: { bwsc: "0.5", bsc: "0" },
    },

    /* ------------------------------------------------------------ coins */
    // The coins people see by name. chain = "bwsc" or a key from `chains`. The chain itself tells symbol and decimals;
    // these add a friendly name and the order in lists. There are no prices here: prices come from the pools (see `prices`).
    // A coin that is in a pool but not here still works; it shows its on-chain ticker and is marked "not in the list".
    // wraps: "native" = this token is the chain's coin, wrapped 1 : 1 (wBWSC); the swap page wraps / unwraps it directly.
    // logo (optional) = a picture in public/ ("/coins/usdt.svg") or an https:// link; without it the coin shows its first letter.
    tokens: [
        { chain: "bwsc", address: "0xf49205a9bdc40d66586e373b7f5ce4b3456c513d", symbol: "USDT", name: "Tether USD", logo: "/coins/tether-256.png" },
        { chain: "bwsc", address: "0x93ade50b1d98ad2f8706e19cf5582411d8de62ca", symbol: "wBWSC", name: "Wrapped BWSC", wraps: "native" },
        { chain: "bsc", address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD (BSC)" },
        { chain: "bsc", address: "0x251DbFdb9Eee5Ff3f90B337DcB8fc84E566830a5", symbol: "BWSC", name: "Bluewolfchain (BEP-20)", logo: "/coins/bwsc-256.png" },
    ],

    /* ------------------------------------------------------------ prices */
    // Every price on the site (APR on the stake page, values) is read from the exchange's pools at that moment, never
    // typed in. `unit` = the hub token prices are counted in (a stablecoin from `tokens`, chain "bwsc"). A coin with no
    // route to it has no price, and the page shows "—" instead of a guess.
    prices: { unit: "USDT" },

    /* ------------------------------------------------------------ swap */
    swap: {
        // Starting slippage and the slippage buttons, in basis points (50 = 0.5%). Each visitor can change theirs
        // (any value from 0.01% to 50%); the page remembers it in that browser.
        slippageBps: 50,
        slippageChoices: [ 10, 50, 100 ],
        // Starting transaction deadline in minutes: a swap / deposit / withdrawal still waiting after this is refused
        // by the exchange, so it can never fill at an old price. Visitors can change it (1 minute to 3 days).
        deadlineMinutes: 20,
        // Longest route the swap page looks for (pairs in a row: 1 to 3)
        maxHops: 3,
    },
};
