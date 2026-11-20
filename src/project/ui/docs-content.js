/*
 * YOUR CODE (off-chain). The docs' text (#/docs). Every fact comes from the chain's own code and docs (Program VM:
 * server.js, HANDOFF.md) or from this site's programs; change the words here if the chain changes.
 *
 * A page: { slug, group, title, lead, blocks } · blocks:
 *   ["h2", text]  ["p", text]  ["list", [text…]]  ["code", { file, lang, code }]  ["table", [head…], [[cell…]…]]
 *   ["note", text]  ["warn", text]  ["steps", [{ title, text }…]]  ["cards", [{ title, text, href }…]]
 * Text: `code`, **bold**, [label](#/docs?p=slug or https://…).
 * {NODE} {RPC} {CHAIN_ID} {SYMBOL} {NAME} {EXPLORER} are filled in from settings/config.js.
 */

const COUNTER = `function program() {
    function initialization(params) {
        writeDB("owner", params.context.sender);
    }

    // Anyone: add 1 to your own counter
    function add(params) {
        const key = map("count", params.context.sender);
        const next = (readDB(key) || 0n) + 1n;
        writeDB(key, next);
        emit("Added", { who: params.context.sender, count: next });
        return next;
    }

    // A read: free when called with /query
    function countOf(params) {
        return readDB(map("count", params.input.who)) || 0n;
    }

    return { add, countOf };
}`;

const PAGES = [
    /* ------------------------------------------------------------ getting started */
    {
        slug: "introduction", group: "Getting started", title: "Introduction",
        lead: "{NAME} is a layer 1 network that runs smart contracts written in JavaScript, with EVM-compatible wallets and tools.",
        blocks: [
            [ "p", "Programs (the chain's smart contracts) are plain JavaScript. A program is one function: it keeps its data with `readDB` / `writeDB`, calls other programs with `runProgram`, and returns the functions people may call. Numbers are `BigInt`, so amounts are exact." ],
            [ "p", "Wallets talk to the chain the way they talk to any EVM network: the node answers standard JSON-RPC at `{RPC}`. People sign readable EIP-712 fields (the program, the function and its inputs) from whatever network their wallet has open." ],
            [ "h2", "At a glance" ],
            [ "table", [ "", "" ], [
                [ "Chain ID", "`{CHAIN_ID}`" ],
                [ "Native coin", "**{SYMBOL}**, 18 decimals: gas and value" ],
                [ "Block time", "2 seconds (a block is made when transactions are waiting)" ],
                [ "Block size", "5,000,000 gas" ],
                [ "Fees", "EIP-1559 base fee, at least 10,000 gwei, burned; a tip goes to the block producer" ],
                [ "Programs", "JavaScript, run in a sandbox, reviewed automatically and approved before they go live" ],
            ] ],
            [ "h2", "Where to go next" ],
            [ "cards", [
                { title: "Connect a wallet", text: "Network values, and how signing works.", href: "#/docs?p=network" },
                { title: "Your first program", text: "Write, deploy and call a counter in a few minutes.", href: "#/docs?p=first-program" },
                { title: "Build an app", text: "Read programs and send transactions from a website.", href: "#/docs?p=reading" },
                { title: "Use the apps", text: "Swap, limit orders, pools, the bridge and staking.", href: "#/docs?p=swap" },
            ] ],
        ],
    },
    {
        slug: "network", group: "Getting started", title: "Network and wallets",
        lead: "The values a wallet or tool needs, and what you sign.",
        blocks: [
            [ "h2", "Network values" ],
            [ "table", [ "Field", "Value" ], [
                [ "Network name", "{NAME}" ],
                [ "RPC URL", "`{RPC}`" ],
                [ "Chain ID", "`{CHAIN_ID}`" ],
                [ "Currency symbol", "{SYMBOL}" ],
                [ "Block explorer", "{EXPLORER}" ],
            ] ],
            [ "p", "The **Add automatically** button on the [home page](#/) adds these to your wallet. Tools can also read them from `GET {NODE}/evm`, which returns the values of `wallet_addEthereumChain`." ],
            [ "h2", "You do not need to switch networks" ],
            [ "p", "Transactions are signed as EIP-712 typed data. The signature does not depend on the network your wallet has open, so you can stay on any network and still sign for {NAME}. Adding the network only lets the wallet show your {SYMBOL} balance." ],
            [ "h2", "What you sign" ],
            [ "p", "Each transaction shows readable fields in the wallet, under the domain `Bluewolfchain`, version `2`:" ],
            [ "table", [ "Field", "Meaning" ], [
                [ "`chainId`", "the chain the transaction is for ({CHAIN_ID})" ],
                [ "`action`", "what it does: `call`, `transfer`, `deploy`, `upgrade`, …" ],
                [ "`from`, `to`", "your address, and the program or wallet it goes to" ],
                [ "`method`, `input`", "the program's function and its inputs, as text" ],
                [ "`value`", "{SYMBOL} sent with it (wei)" ],
                [ "`nonce`", "your transaction count, so it cannot be replayed" ],
                [ "`gasLimit`, fees", "`gasPrice`, or `maxFeePerGas` and `maxPriorityFeePerGas`" ],
                [ "`signedOnChainId`", "the network your wallet had open when you signed" ],
                [ "`sponsor`", "optional: a wallet that pays the gas instead of you" ],
            ] ],
            [ "note", "A sponsor signs the same transaction too. Apps can use it to pay the gas for people who hold no {SYMBOL} yet." ],
        ],
    },
    {
        slug: "fees", group: "Getting started", title: "Blocks and fees",
        lead: "How fast transactions land and what they cost.",
        blocks: [
            [ "h2", "Blocks" ],
            [ "list", [
                "The producer closes a block every **2 seconds** when transactions are waiting; an idle chain makes no empty blocks.",
                "A block holds up to **5,000,000 gas** and up to 500 transactions.",
                "One transaction may run for at most 5 seconds; an endless loop runs out of gas long before that.",
            ] ],
            [ "h2", "Fees (EIP-1559)" ],
            [ "list", [
                "Every block has a **base fee** per unit of gas, never below **10,000 gwei**.",
                "When blocks are more than half full the base fee goes up, when they are emptier it goes down: at most 12.5% per block.",
                "The base fee is **burned**. A tip (priority fee) goes to the block producer.",
                "You pay `gas used × (base fee + tip)`, never more than the `maxFeePerGas` you signed.",
            ] ],
            [ "h2", "Checked before it is queued" ],
            [ "p", "The node runs every transaction once before accepting it. If it would fail (not enough balance, a program error, a bad signature), it is refused at once with the reason, and it costs nothing." ],
            [ "note", "The live base fee is in `GET {NODE}/genesis` (`baseFee`, for the next block) and in `eth_gasPrice` on the RPC." ],
        ],
    },

    /* ------------------------------------------------------------ apps */
    {
        slug: "swap", group: "Using the apps", title: "Swap and pools",
        lead: "Trade any two coins, or earn fees by adding liquidity.",
        blocks: [
            [ "h2", "Swap" ],
            [ "steps", [
                { title: "Pick two coins", text: "The native coin and every token in a pool are listed, with your balances." },
                { title: "Type an amount", text: "In **You pay** for an exact input, or in **You get** for an exact output. The best route is found through up to three pools." },
                { title: "Check and sign", text: "The page shows the rate, the price impact and the least you will get. Large price impacts ask you to confirm again." },
            ] ],
            [ "p", "Slippage and the deadline are set once in the swap settings and used for every trade. A trade that would get less than your minimum, or arrives after the deadline, is refused and nothing changes." ],
            [ "h2", "Pools" ],
            [ "p", "A pool holds two coins. Adding liquidity puts both in at the pool's current ratio and gives you a share; every swap through the pool pays a fee that stays in it, so your share grows. Remove your share at any time." ],
        ],
    },
    {
        slug: "limit-orders", group: "Using the apps", title: "Limit orders",
        lead: "Trade coin for coin at the price you name.",
        blocks: [
            [ "p", "Put up one coin and ask for another: for example 100 {SYMBOL} for 230 USDT. Your coins wait in the program until someone buys or you cancel." ],
            [ "list", [
                "Orders in each market are sorted best rate first, and each one shows how it compares with the Swap price.",
                "Every order shows its **seller's address**. Filter by a seller (or open a link `#/limit?seller=0x…`) to buy from a friend directly. **Copy my link** in My orders gives you yours.",
                "Allow buying in parts, or sell all at once. Choose when the order ends: 1, 7, 30 days or never.",
                "Cancel at any time and get back what was not sold, even when trading is paused or the order has ended.",
                "Each listed coin has its own small fee, taken from what the buyer receives. Only coins listed by the chain team can be traded.",
            ] ],
        ],
    },
    {
        slug: "bridge", group: "Using the apps", title: "Bridge",
        lead: "Move coins between {NAME} and other chains.",
        blocks: [
            [ "p", "Every connected chain bridges with {NAME}. Send from one side and the coins arrive on the other by themselves: there is nothing to claim and no gas to pay on the receiving side." ],
            [ "steps", [
                { title: "Pick From, To and the coin", text: "Chains that are paused or unreachable are marked." },
                { title: "Send", text: "Your wallet locks the coins in the bridge on the source chain." },
                { title: "Arrives by itself", text: "Once the source chain confirms it, the bridge's relayer delivers it to the same address on the other chain." },
            ] ],
            [ "p", "To move between two other chains, bridge to {NAME} first, then on. Running totals are kept on both sides, so anyone can check that every coin out matches a coin in." ],
            [ "note", "Use a normal wallet address, not a contract wallet: the coins arrive at the same address on the other chain." ],
        ],
    },
    {
        slug: "stake", group: "Using the apps", title: "Staking",
        lead: "Stake a coin and earn rewards every second.",
        blocks: [
            [ "p", "Each pool pays one coin for staking another. Rewards are added in streams with an amount and a duration; each second's reward is shared by everyone staked at that second, by stake size." ],
            [ "list", [
                "Claim whenever you like; rewards keep counting while you wait.",
                "Rewards put into a pool can never be taken back by anyone, the owner included.",
                "Take your stake out at any time.",
            ] ],
        ],
    },
    {
        slug: "multi-transfer", group: "Using the apps", title: "Multi transfer",
        lead: "Send {SYMBOL} or a token to hundreds of wallets at once.",
        blocks: [
            [ "p", "Paste a list, type it, or upload a CSV file: one wallet per line, the address then the amount, with a comma, space, tab or = between them. A first line such as `address,amount` is skipped." ],
            [ "code", { lang: "csv", file: "list.csv", code: "address,amount\n0x1111111111111111111111111111111111111111,1.5\n0x2222222222222222222222222222222222222222,20" } ],
            [ "list", [
                "Every line is checked as you type. A line with a problem is listed by its number, and nothing can be sent until it is fixed.",
                "A wallet listed twice gets both amounts. **Merge** turns it into one line with the amounts added up.",
                "Turn on **Same amount for everyone** to list only addresses.",
                "Each transaction pays up to 200 wallets: all of them or none. A longer list is split into several transactions, each confirmed in your wallet.",
                "If one stops, the ones already sent are marked with their transaction, and the button sends only the rest.",
            ] ],
            [ "p", "A token needs one approval for the total first; then each amount goes straight from your wallet to each wallet. {SYMBOL} passes through the program within the same transaction. The program has no owner and no fee, and never keeps any coins." ],
            [ "note", "The network fee grows with the list: a token transfer uses about 4,500 gas per wallet and {SYMBOL} about 1,300. Keep enough {SYMBOL} for the fee." ],
        ],
    },

    /* ------------------------------------------------------------ programs */
    {
        slug: "first-program", group: "Programs", title: "Your first program",
        lead: "Write a counter, deploy it, and call it.",
        blocks: [
            [ "h2", "1. Write it" ],
            [ "code", { file: "counter.js", code: COUNTER } ],
            [ "p", "`initialization` runs once, when the program goes live. The functions in the final `return { … }` are the ones anyone can call; everything else stays private." ],
            [ "h2", "2. Deploy it" ],
            [ "steps", [
                { title: "Open the explorer's deploy page", text: "Paste the code. Add the first input as JSON if `initialization` needs one (this one does not: `{}`)." },
                { title: "Choose an upgrader, or none", text: "With no upgrader the code can never change. With one, that wallet can propose new versions later." },
                { title: "Sign", text: "The code is reviewed automatically as it arrives. The chain team then approves it, `initialization` runs and the program gets its address." },
            ] ],
            [ "h2", "3. Call it" ],
            [ "p", "Writes are transactions signed by a wallet; reads are free and need no wallet:" ],
            [ "code", { file: "read.sh", lang: "sh", code: `curl -s {NODE}/query \\
  -H "content-type: application/json" \\
  -d '{ "programUuid": "0xYOUR_PROGRAM", "functionName": "countOf", "input": { "who": "0xYOUR_WALLET" } }'` } ],
            [ "code", { file: "answer.json", lang: "json", code: `{ "status": "success", "result": "1n", "gasUsed": 4210, "readOnly": true }` } ],
            [ "note", "Numbers leave the chain as text ending in `n` (`\"1n\"`). Read them with `BigInt(value.slice(0, -1))`, never `Number()`." ],
        ],
    },
    {
        slug: "structure", group: "Programs", title: "Program structure",
        lead: "One function, its private helpers, and the functions it returns.",
        blocks: [
            [ "code", { file: "shape.js", code: `function program() {
    function initialization(params) { /* once, when it goes live */ }
    function migrate(params) { /* once, when an upgrade is approved */ }

    function helper() { /* not returned: private */ }

    const onlyOwner = (fn) => (params) => {
        if (params.context.sender !== readDB("owner")) throw new Error("Only the owner");
        return fn(params);
    };

    const setFee = onlyOwner(function (params) {
        writeDB("fee", params.input.fee);
    });

    function feeOf() { return readDB("fee") || 0n; }

    return { setFee, feeOf };   // must be the last line
}` } ],
            [ "h2", "Rules of the shape" ],
            [ "list", [
                "The whole file is one function (any name). No `import` or `export`.",
                "`return { … }` is the **last line** and lists the public functions.",
                "`initialization` and `migrate` can never be called from outside, even if returned.",
                "Throw an `Error` to stop: everything the call changed is rolled back.",
            ] ],
            [ "h2", "params" ],
            [ "table", [ "Field", "What it is" ], [
                [ "`params.input`", "the caller's input object (numbers are BigInt)" ],
                [ "`params.context.sender`", "who called: a wallet, or the program that called this one" ],
                [ "`params.context.origin`", "the wallet that signed the transaction" ],
                [ "`params.value`", "{SYMBOL} sent with the call, in wei" ],
                [ "`params.block.timestamp`", "the block's time in milliseconds (BigInt); `/ 1000n` for seconds" ],
            ] ],
            [ "p", "The block number is `BlockNumber()`." ],
        ],
    },
    {
        slug: "storage", group: "Programs", title: "Storage",
        lead: "Keys and values that belong to your program.",
        blocks: [
            [ "code", { file: "storage.js", code: `writeDB("paused", false);
writeDB(map("balance", who), 100n);                // "balance:<who>"
writeDB(map("allowance", owner, spender), 5n);      // keys of several parts

const balance = readDB(map("balance", who)) || 0n; // missing → undefined
deleteDB(map("allowance", owner, spender));` } ],
            [ "list", [
                "Values can be text, BigInt, booleans, arrays and plain objects; BigInt comes back as BigInt.",
                "Keys are text. Build them with `map(name, ...parts)` rather than by hand.",
                "There is no loop over all keys: keep a count and store items by number (`map(\"itemAt\", n)`) when you need a list.",
            ] ],
            [ "note", "Every program's storage is public. Anyone can read it in the explorer or with `GET {NODE}/program/<address>/storage`." ],
        ],
    },
    {
        slug: "coins", group: "Programs", title: "Coins and other programs",
        lead: "Receive and send {SYMBOL}, use tokens, call programs.",
        blocks: [
            [ "h2", "The native coin" ],
            [ "code", { file: "native.js", code: `function deposit(params) {
    if (params.value === 0n) throw new Error("Send some ${"{SYMBOL}"}");
    const key = map("deposit", params.context.sender);
    writeDB(key, (readDB(key) || 0n) + params.value);
}

function withdraw(params) {
    const key = map("deposit", params.context.sender);
    const amount = readDB(key) || 0n;
    writeDB(key, 0n);                                // change state first
    transferNative(params.context.sender, amount);   // then pay
}` } ],
            [ "p", "`ThisBalance()` is the program's own {SYMBOL}; `BalanceOf(address)` anyone's." ],
            [ "h2", "Calling other programs" ],
            [ "code", { file: "call.js", code: `// A token: move the caller's tokens into this program (they approved it first)
runProgram(TOKEN, "transferFrom", { from: params.context.sender, to: ThisAddress(), amount });

// A read only: the other program cannot change anything
const balance = runProgram(TOKEN, "balanceOf", { who: ThisAddress() }, { readonly: true });

// Send ${"{SYMBOL}"} along with a call
runProgram(VAULT, "deposit", {}, { value: 10n ** 18n });` } ],
            [ "p", "Inside the called program, `params.context.sender` is your program. If it throws, the whole transaction is rolled back unless you catch the error." ],
            [ "p", "Tokens follow the standard shape: `name`, `ticker`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `transfer`, `approve`, `transferFrom`." ],
        ],
    },
    {
        slug: "events", group: "Programs", title: "Events",
        lead: "Tell apps what happened.",
        blocks: [
            [ "code", { file: "events.js", code: `emit("Transfer", { from, to, amount }, { indexed: ["from", "to"] });` } ],
            [ "list", [
                "Up to 3 fields can be **indexed**, so apps can search by their value.",
                "Events are part of the transaction's receipt, and listed newest first by the node.",
            ] ],
            [ "code", { file: "events.sh", lang: "sh", code: `# Newest first; next page with ?cursor=<next>
curl -s "{NODE}/program/0xYOUR_PROGRAM/events?name=Transfer&to=0xSOMEONE"` } ],
        ],
    },
    {
        slug: "api", group: "Programs", title: "Built-in functions",
        lead: "Everything a program can call.",
        blocks: [
            [ "table", [ "Function", "What it does" ], [
                [ "`readDB(key)` `writeDB(key, value)` `deleteDB(key)` `map(...parts)`", "storage" ],
                [ "`runProgram(to, fn, input, { value })`", "call another program" ],
                [ "`runProgram(to, fn, input, { readonly: true })`", "read another program; it cannot change anything" ],
                [ "`cloneProgram(template, input, { salt, value })`", "create a program from an approved one (a factory)" ],
                [ "`transferNative(to, amount)`", "send {SYMBOL} from the program" ],
                [ "`emit(name, data, { indexed })`", "an event" ],
                [ "`setMetadata(field, value)`", "the program's public details (e.g. `abi`, `description`)" ],
                [ "`ThisAddress()` `ThisBalance()` `BalanceOf(a)` `IsProgram(a)` `MetadataOf(a, field)`", "addresses and balances" ],
                [ "`BlockNumber()` `BlockHash(n)` `ChainId()` `BaseFee()` `GasPrice()` `GasLeft()` `Coinbase()`", "the block and the transaction" ],
                [ "`keccak256(value)` `sha256` `ripemd160` `blake2b` `keccak256Bytes(hex)`", "hashes" ],
                [ "`ecrecover(value, sig)` `ecrecoverDigest(digest, sig)` `eip712Digest(domain, types, type, message)`", "signatures" ],
                [ "`modexp(base, exp, mod)` `CodeHashOf(a)` `CodeSizeOf(a)`", "math and code" ],
                [ "`Date`, `Math`", "the block's time; `Math.random()` is tied to the transaction, so replays give the same result" ],
            ] ],
        ],
    },
    {
        slug: "rules", group: "Programs", title: "Rules and review",
        lead: "What the automatic review accepts.",
        blocks: [
            [ "p", "New code is reviewed the moment it is sent. The review allows only known-safe JavaScript, so a program behaves the same on every node." ],
            [ "h2", "Numbers" ],
            [ "p", "Every number is a BigInt: write `10n`, not `10`. A plain number is refused." ],
            [ "h2", "Not allowed" ],
            [ "table", [ "Not allowed", "Use instead" ], [
                [ "`obj[key]`, `arr[i]` (computed access)", "`map(…)` keys in storage, `arr.at(i)`, named fields" ],
                [ "regular expressions", "`includes`, `startsWith`, `slice`" ],
                [ "`class`, `async` / `await`, generators, `this`, `for…in`", "functions and plain objects" ],
                [ "`.sort`, `.bind`, `.call`, `.apply`, `toLocale…`", "write the loop yourself" ],
                [ "`new` other than `Error` and `Date`", "plain objects" ],
                [ "`process`, `require`, `fetch`, `eval`, `globalThis`", "nothing outside the program can be reached" ],
            ] ],
            [ "warn", "Programs also run in a sandbox with gas and a time limit, so even code that passed review cannot reach the machine or run forever." ],
        ],
    },
    {
        slug: "upgrades", group: "Programs", title: "Deploy and upgrade",
        lead: "From review to a live program, and new versions later.",
        blocks: [
            [ "steps", [
                { title: "Deploy", text: "Send the code and its first input, with an upgrader or none. It waits for approval." },
                { title: "Approve", text: "The chain team approves (or rejects) it. On approval `initialization` runs and the program goes live." },
                { title: "Upgrade", text: "The upgrader sends new code. It is reviewed like a deploy and waits for approval." },
                { title: "Migrate", text: "On approval the new code replaces the old one, storage stays as it is, and `migrate` runs once. If `migrate` throws, nothing changes." },
            ] ],
            [ "list", [
                "No upgrader = the code can never change.",
                "The upgrader can hand the role to another wallet, or give it up for good.",
                "Every past version stays on record, with the block it was replaced at.",
            ] ],
        ],
    },

    /* ------------------------------------------------------------ build apps */
    {
        slug: "reading", group: "Build apps", title: "Reading data",
        lead: "Everything an app reads, over plain HTTP. No wallet, no gas.",
        blocks: [
            [ "h2", "Call a program's function" ],
            [ "code", { file: "read.js", code: `const res = await fetch("{NODE}/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ programUuid: PROGRAM, functionName: "countOf", input: { who: ADDRESS } }),
});
const answer = await res.json();          // { status, result, gasUsed, events, ... }
const count = BigInt(answer.result.slice(0, -1));` } ],
            [ "p", "A query runs on the latest state; anything it changes is thrown away." ],
            [ "h2", "Other reads" ],
            [ "table", [ "Request", "Returns" ], [
                [ "`GET /address/:a`", "balance, nonce, metadata, whether it is a program" ],
                [ "`GET /program/:a`", "code, metadata, storage (first page), recent events" ],
                [ "`GET /program/:a/events?name=`", "events, newest first, `{ items, next }`" ],
                [ "`GET /address/:a/tokens`", "the tokens an address holds" ],
                [ "`GET /nonce/:a`", "the next nonce, counting transactions still waiting" ],
                [ "`GET /tx/:hash` · `GET /tx/:hash/receipt`", "a transaction, its result, events and call trace" ],
                [ "`GET /genesis`", "chain id, latest block, base fee, gas settings" ],
            ] ],
        ],
    },
    {
        slug: "sending", group: "Build apps", title: "Sending transactions",
        lead: "Build the fields, have the wallet sign them, send.",
        blocks: [
            [ "steps", [
                { title: "Get the nonce and the fee", text: "`GET /nonce/:address` and `GET /genesis` (`baseFee`)." },
                { title: "Sign the fields", text: "Ask the wallet for `eth_signTypedData_v4` with the domain `{ name: \"Bluewolfchain\", version: \"2\" }` and the fields in [Network and wallets](#/docs?p=network)." },
                { title: "Send", text: "`POST /sendtx` with `{ tx, signature }`. The node runs it once first: a failing transaction comes back with its reason and is not queued." },
                { title: "Wait", text: "`GET /tx/:hash` until it is in a block (about 2 seconds), then read the receipt." },
            ] ],
            [ "code", { file: "send.js", code: `// bwscbox: the client library this website uses (vendor/bwscbox in its source)
import { createClient, walletSigner } from "bwscbox";

const client = createClient({ node: "{NODE}" });
const signer = await walletSigner(window.ethereum);     // asks the wallet for eth_signTypedData_v4

const sent = await client.send({ action: "call", to: PROGRAM, method: "add", input: {} }, signer);
const receipt = await client.waitReceipt(sent.hash);   // in a block about 2 seconds later` } ],
            [ "h2", "The typed data" ],
            [ "code", { file: "types.json", lang: "json", code: `{
  "domain": { "name": "Bluewolfchain", "version": "2" },
  "primaryType": "Transaction",
  "fields": ["chainId", "action", "from", "to", "method", "input", "value", "nonce", "gasLimit",
             "maxFeePerGas", "maxPriorityFeePerGas", "signedOnChainId", "sponsor (optional)"]
}` } ],
            [ "p", "`input` is signed as canonical JSON: keys sorted, no spaces, BigInt written as `\"123n\"`. Legacy transactions sign `gasPrice` in place of the two EIP-1559 fields." ],
            [ "note", "Reading this website's own source (`src/project/chain/`) shows every call above in a working app." ],
        ],
    },
    {
        slug: "evm", group: "Build apps", title: "EVM JSON-RPC",
        lead: "Use ethers, viem, MetaMask or an indexer as with any EVM chain.",
        blocks: [
            [ "code", { file: "evm.js", code: `import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider("{RPC}");
const block = await provider.getBlockNumber();
const balance = await provider.getBalance("0xSOMEONE");` } ],
            [ "list", [
                "`POST {RPC}`: JSON-RPC 2.0, batches too. `ws` on the same path adds `eth_subscribe` (`newHeads`, `logs`, `newPendingTransactions`).",
                "Blocks, transactions, receipts, logs (`eth_getLogs`, up to 1,000 blocks a call), balances, nonces and fees.",
                "`eth_call` works for tokens (ERC-20), NFTs (ERC-721), multi-tokens (ERC-1155) and programs that publish an ABI with `setMetadata(\"abi\", …)`.",
                "`eth_sendRawTransaction` goes through the same checks as `/sendtx`.",
                "Explorer links follow EIP-3091: `{NODE}/evm/explorer/tx/<hash>`.",
            ] ],
        ],
    },
    {
        slug: "listing", group: "Build apps", title: "List your app",
        lead: "Get your app into the Apps page.",
        blocks: [
            [ "p", "Apps are listed by the chain team. Send your app's name, link, a one-line description, a square logo and a wide cover picture, the addresses of its programs, and an audit report if you have one." ],
            [ "p", "Listed apps carry badges: **Core** (made by the chain team), **Audited** (with the report linked), and a risk level. A listing is not an endorsement." ],
        ],
    },

    /* ------------------------------------------------------------ reference */
    {
        slug: "http-api", group: "Reference", title: "HTTP API",
        lead: "Every response is JSON; numbers are text ending in n (\"123n\"). Lists take ?limit (up to 200).",
        blocks: [
            [ "h2", "Write" ],
            [ "table", [ "Request", "Body / answer" ], [
                [ "`POST /sendtx`", "`{ tx, signature, sponsorSignature? }` → `{ queued: true, hash }` or `400 { error }`" ],
                [ "`POST /query`", "`{ programUuid, functionName, input }` → `{ status, result, gasUsed, events }`" ],
            ] ],
            [ "h2", "Read" ],
            [ "table", [ "Request", "Returns" ], [
                [ "`GET /genesis`", "chain id, latest block, base fee, gas settings, producers" ],
                [ "`GET /blocks` · `GET /block/latest` · `GET /block/:n`", "block headers (`?full=1` for receipts)" ],
                [ "`GET /tx/:hash` · `/tx/:hash/receipt`", "a transaction and its receipt" ],
                [ "`GET /address/:a` · `/address/:a/txs` · `/address/:a/incoming`", "an address and its transactions" ],
                [ "`GET /address/:a/tokens` · `/address/:a/nfts`", "what it holds" ],
                [ "`GET /program/:a` · `/program/:a/storage` · `/program/:a/events` · `/program/:a/abi` · `/program/:a/versions`", "a program" ],
                [ "`GET /token/:a` · `/token/:a/holders`", "a token" ],
                [ "`GET /nonce/:a`", "the next nonce" ],
                [ "`GET /name/:namespace`", "a program's address by its name" ],
                [ "`GET /proof?key=…`", "Merkle proofs of state against the latest state root" ],
                [ "`GET /pending` · `GET /health`", "the queue, the node's health" ],
            ] ],
            [ "h2", "EVM" ],
            [ "table", [ "Request", "" ], [
                [ "`POST /evm` · `ws /evm`", "JSON-RPC 2.0 ([EVM JSON-RPC](#/docs?p=evm))" ],
                [ "`GET /evm`", "the values for `wallet_addEthereumChain`" ],
            ] ],
        ],
    },
];

export { PAGES };
