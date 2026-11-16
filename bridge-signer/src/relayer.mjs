/*
 * The relayer: delivers every bridge transfer by itself, so nobody has to press "claim".
 *
 *   1. It watches the bridges: BridgeIn on every other chain (eth_getLogs) and BridgeOut on BWSC (the node's event list).
 *      The website also tells it right after a transfer (GET /deliver), which only makes it quicker.
 *   2. For each (from, to, account, coin) it asks the signer for the signed running total (signer.mjs claim(): the
 *      source chain read at its safe block, the same checks as always), and when that total is more than what was
 *      already paid on the destination, it sends the claim there itself and pays the gas.
 *   3. Gas drop (optional, settings/config.js bridgeSigner.gasDrop): a wallet that has none of the destination's own
 *      coin gets a little of it once, with its first delivery of another coin, so a brand-new wallet can pay gas.
 *
 * The claims pay the account in the signature, never the sender: the relayer cannot send coins anywhere else, and a
 * claim that was already paid does nothing. Users can still claim themselves if the relayer is down.
 *
 * createRelayer(libs, options) → { start, stop, tick, enqueue, pending, status, pause, resume }
 */

import fs from "node:fs";

const ZERO = "0x0000000000000000000000000000000000000000";
const EVM_ABI = [
    "event BridgeIn(address indexed account, address indexed token, uint256 amount, uint256 fee, uint256 total)",
    "function claimOut(address account, address token, uint256 total, bytes signature) returns (uint256)",
    "function claimedOutOf(address account, address token) view returns (uint256)",
];
const lower = (a) => String(a ?? "").toLowerCase();
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ""));
const big = (v) => BigInt(String(v ?? 0).replace(/n$/, "") || 0);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;

/**
 * @param {{ ethers, createClient, keyWalletSigner }} libs
 * @param {object} o
 * @param {object} o.signer        createBridgeSigner(…) (signs; the relayer only sends)
 * @param {string} o.key           the relayer wallet's private key: it pays the gas on every chain
 * @param {{ key, nodeUrl, bridge, gasDrop }} o.hub      gasDrop in wei (0n = off)
 * @param {Array<{ key, rpcUrl, bridge, gasDrop }>} o.chains
 * @param {string} [o.stateFile]   where it remembers how far it read (and who got a gas drop); none = memory only
 * @param {number} [o.intervalMs]  how often it looks (default 4 s)
 * @param {number} [o.lookbackBlocks]  on the first start, how far back it reads each chain (default 20,000 blocks)
 */
function createRelayer({ ethers, createClient, keyWalletSigner }, o) {
    const log = o.log ?? console;
    const intervalMs = o.intervalMs ?? 4000;
    const lookback = o.lookbackBlocks ?? 20_000;
    const reorgWindow = 50;          // blocks read again each time, in case a block was replaced
    const maxRange = 500;            // blocks per eth_getLogs (public RPCs limit the range)
    const wallet = new ethers.Wallet(o.key);
    const me = lower(wallet.address);
    const hubKey = o.hub.key ?? "bwsc";
    const hubBridge = lower(o.hub.bridge);
    const hub = createClient({ node: o.hub.nodeUrl });
    const hubSigner = keyWalletSigner(wallet);
    const hubGasDrop = BigInt(o.hub.gasDrop ?? 0n);
    const chains = (o.chains ?? []).filter((c) => c.rpcUrl && isAddress(c.bridge)).map((c) => {
        const provider = new ethers.JsonRpcProvider(c.rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
        const sender = new ethers.NonceManager(wallet.connect(provider));
        return { key: c.key, provider, sender, bridge: new ethers.Contract(c.bridge, EVM_ABI, sender), gasDrop: BigInt(c.gasDrop ?? 0n), chainId: 0, lock: Promise.resolve() };
    });
    const chainBy = (key) => chains.find((c) => c.key === key) ?? null;

    /* ------------------------------------ what it remembers */

    let state = { cursors: {}, hubSeen: null, dropped: {} };
    if (o.stateFile && fs.existsSync(o.stateFile)) {
        try { state = { ...state, ...JSON.parse(fs.readFileSync(o.stateFile, "utf8")) }; } catch { log.error(`relayer: ${o.stateFile} is not valid JSON, starting fresh`); }
    }
    const save = () => {
        if (!o.stateFile) return;
        try { fs.writeFileSync(`${o.stateFile}.tmp`, JSON.stringify(state, null, 2)); fs.renameSync(`${o.stateFile}.tmp`, o.stateFile); } catch (e) { log.error(`relayer: could not save ${o.stateFile}: ${e.message}`); }
    };

    /* ------------------------------------ the queue */

    const jobs = new Map();
    const jobKey = (j) => `${j.from}|${j.to}|${j.account}|${j.token}`;
    const MAX_AGE = 24 * 3600_000;
    const WEBSITE_WAIT = 15 * 60_000;     // a /deliver without a block keeps trying this long (the scan finds it anyway)

    /** Adds a delivery to do (or makes a queued one due now). from / to: "bwsc" or a chain key; one of them is BWSC */
    function enqueue({ from, to, account, token, atBlock = null, source = "scan" }) {
        from = lower(from); to = lower(to || (from === hubKey ? "" : hubKey));
        if (!isAddress(account) || lower(account) === ZERO || !isAddress(token)) throw Object.assign(new Error("account and token must be addresses."), { status: 400 });
        if ((from === hubKey) === (to === hubKey)) throw Object.assign(new Error("One side must be BWSC."), { status: 400 });
        if (!chainBy(from === hubKey ? to : from)) throw Object.assign(new Error(`Unknown chain "${from === hubKey ? to : from}".`), { status: 400 });
        const job = { from, to, account: lower(account), token: lower(token) };
        const k = jobKey(job);
        const now = Date.now();
        const had = jobs.get(k);
        if (had) {
            had.nextAt = now;
            if (atBlock !== null) had.atBlock = Math.max(had.atBlock ?? 0, atBlock);
            had.until = Math.max(had.until, now + (atBlock === null ? WEBSITE_WAIT : MAX_AGE));
        } else {
            jobs.set(k, { ...job, atBlock, since: now, until: now + (atBlock === null ? WEBSITE_WAIT : MAX_AGE), nextAt: now, tries: 0, state: "waiting", note: "", source });
        }
        return jobs.get(k);
    }

    /** One transaction at a time per destination (nonces) */
    const serial = (c, run) => { const next = c.lock.then(run, run); c.lock = next.catch(() => {}); return next; };
    let hubLock = Promise.resolve();
    const hubSerial = (run) => { const next = hubLock.then(run, run); hubLock = next.catch(() => {}); return next; };

    /* ------------------------------------ one delivery */

    /** → "delivered" | "done" (nothing more to pay) | "waiting" (not safe yet / not seen yet) */
    async function deliver(job) {
        const signed = await o.signer.claim({ from: job.from, to: job.to, account: job.account, token: job.token });
        const total = BigInt(signed.total);
        const toHub = job.to === hubKey;
        const dest = toHub ? null : chainBy(job.to);
        const claimed = toHub
            ? big(await hub.query({ program: hubBridge, method: "claimedInOf", input: { chainId: BigInt(signed.sourceChainId), account: signed.account, token: signed.token } }))
            : await dest.bridge.claimedOutOf(signed.account, signed.token);
        if (total <= claimed) {
            // Everything read so far is paid. A deposit the scan saw at block N is not in the total until the safe
            // block reaches N: keep waiting for it.
            // BWSC as the source: its total is final at once. Another chain: done once the safe block reached the
            // deposit's block (from the scan, or the website's ?block=); without a block, keep looking a while.
            const fromHub = signed.atBlock === null || signed.atBlock === undefined;
            const reached = fromHub || (job.atBlock !== null && job.atBlock !== undefined && signed.atBlock >= job.atBlock);
            return reached ? "done" : "waiting";
        }

        if (toHub) {
            await hubSerial(async () => {
                const sent = await hub.send({ action: "call", to: hubBridge, method: "claimIn", input: { chainId: `${signed.sourceChainId}n`, account: signed.account, token: signed.token, total: `${total}n`, signature: signed.signature } }, hubSigner);
                const receipt = await hub.waitReceipt(sent.hash);
                if (receipt?.status && receipt.status !== "success") throw new Error(receipt.error?.message ?? receipt.error ?? "the claim failed in its block");
                log.log(`relayer: delivered ${total - claimed} of ${short(signed.token)} to ${short(signed.account)} on BWSC (from ${job.from}) tx ${sent.hash}`);
            });
            await gasDropOnHub(signed.account, signed.token);
        } else {
            await serial(dest, async () => {
                const tx = await dest.bridge.claimOut(signed.account, signed.token, total, signed.signature);
                await tx.wait();
                log.log(`relayer: delivered ${total - claimed} of ${short(signed.token)} to ${short(signed.account)} on ${dest.key} tx ${tx.hash}`);
            });
            await gasDropOn(dest, signed.account, signed.token);
        }
        return "delivered";
    }

    /** A little BWSC for a wallet that has none (once per wallet; not when the delivery itself was BWSC) */
    async function gasDropOnHub(account, token) {
        const k = `${hubKey}:${account}`;
        if (hubGasDrop <= 0n || lower(token) === ZERO || state.dropped[k]) return;
        try {
            if ((await hub.balance(account)) >= hubGasDrop) return;
            await hubSerial(async () => {
                const sent = await hub.send({ action: "transfer", to: account, value: String(hubGasDrop) }, hubSigner);
                await hub.waitReceipt(sent.hash);
            });
            state.dropped[k] = Date.now();
            save();
            log.log(`relayer: gas drop ${ethers.formatEther(hubGasDrop)} to ${short(account)} on BWSC`);
        } catch (e) {
            log.error(`relayer: gas drop on BWSC to ${short(account)} failed: ${e.shortMessage ?? e.message}`);
        }
    }
    async function gasDropOn(c, account, token) {
        const k = `${c.key}:${account}`;
        if (c.gasDrop <= 0n || lower(token) === ZERO || state.dropped[k]) return;
        try {
            if ((await c.provider.getBalance(account)) >= c.gasDrop) return;
            await serial(c, async () => { await (await c.sender.sendTransaction({ to: account, value: c.gasDrop })).wait(); });
            state.dropped[k] = Date.now();
            save();
            log.log(`relayer: gas drop ${ethers.formatEther(c.gasDrop)} to ${short(account)} on ${c.key}`);
        } catch (e) {
            log.error(`relayer: gas drop on ${c.key} to ${short(account)} failed: ${e.shortMessage ?? e.message}`);
        }
    }

    /* ------------------------------------ finding transfers */

    async function scanChain(c) {
        const head = await c.provider.getBlockNumber();
        const last = state.cursors[c.key];
        let from = last === undefined ? Math.max(0, head - lookback) : Math.max(0, Number(last) - reorgWindow);
        while (from <= head) {
            const to = Math.min(head, from + maxRange - 1);
            const logs = await c.bridge.queryFilter(c.bridge.filters.BridgeIn(), from, to);
            for (const l of logs) enqueue({ from: c.key, to: hubKey, account: l.args.account, token: l.args.token, atBlock: l.blockNumber });
            state.cursors[c.key] = to;
            from = to + 1;
        }
        save();
    }

    const eventOrder = (e) => [ Number(e.blockNumber ?? 0), Number(e.txIndex ?? 0), Number(e.index ?? 0) ];
    const after = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

    async function scanHub() {
        const chainOfId = new Map(chains.map((c) => [ Number(c.chainId), c.key ]));
        const seen = state.hubSeen;
        let newest = seen;
        let cursor = "";
        for (let page = 0; page < 20; page++) {
            const answer = await hub.get(`/program/${hubBridge}/events?name=BridgeOut&limit=50&cursor=${encodeURIComponent(cursor)}`);
            const items = answer?.items ?? [];
            let reachedSeen = false;
            for (const e of items) {
                const order = eventOrder(e);
                if (seen && !after(order, seen)) { reachedSeen = true; break; }
                if (!newest || after(order, newest)) newest = order;
                const key = chainOfId.get(Number(big(e.data?.chainId)));
                if (key) enqueue({ from: hubKey, to: key, account: e.data?.account, token: e.data?.token, atBlock: null, source: "scan" });
            }
            // First start: only the newest page (older transfers can still be claimed by hand, or with /deliver)
            if (reachedSeen || !seen || !answer?.next) break;
            cursor = answer.next;
        }
        if (newest) { state.hubSeen = newest; save(); }
    }

    /* ------------------------------------ the loop */

    let timer = null;
    let running = null;
    let paused = false;
    let lastScan = { at: 0, errors: {} };

    /** One round: read every chain, then do what is due. A round already running is shared, not doubled */
    function tick() {
        if (paused) return Promise.resolve();
        if (running) return running;
        running = round().finally(() => { running = null; });
        return running;
    }

    async function round() {
        {
            const errors = {};
            await Promise.all([
                scanHub().catch((e) => { errors[hubKey] = e.message; }),
                ...chains.map((c) => scanChain(c).catch((e) => { errors[c.key] = e.shortMessage ?? e.message; })),
            ]);
            for (const [ k, m ] of Object.entries(errors)) if (lastScan.errors[k] !== m) log.error(`relayer: could not read ${k}: ${m}`);
            lastScan = { at: Date.now(), errors };

            const now = Date.now();
            const due = [ ...jobs.values() ].filter((j) => j.nextAt <= now);
            await Promise.all(due.map(async (j) => {
                try {
                    const result = await deliver(j);
                    j.tries = 0;
                    if (result === "waiting") {
                        j.state = "waiting"; j.note = "waiting for the source chain to confirm it";
                        j.waits = (j.waits ?? 0) + 1;
                        j.nextAt = Date.now() + Math.min(30_000, intervalMs * (1 + Math.floor(j.waits / 5)));
                        if (Date.now() > j.until) jobs.delete(jobKey(j));
                    } else {
                        jobs.delete(jobKey(j));
                    }
                } catch (e) {
                    j.tries += 1;
                    j.state = "retrying";
                    j.note = String(e.shortMessage ?? e.message ?? e).slice(0, 200);
                    j.nextAt = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(j.tries, 5));
                    if (e.status && e.status < 500) jobs.delete(jobKey(j));               // a bad request: nothing to retry
                    else if (Date.now() > j.until) jobs.delete(jobKey(j));
                    if (j.tries === 1 || j.tries % 10 === 0) log.error(`relayer: ${j.from} → ${j.to} for ${short(j.account)}: ${j.note}`);
                }
            }));
        }
    }

    async function start() {
        const s = await o.signer.status();
        for (const c of chains) c.chainId = s.chains.find((x) => x.key === c.key)?.chainId ?? 0;
        timer = setInterval(() => { tick().catch((e) => log.error(`relayer: ${e.message}`)); }, intervalMs);
        timer.unref?.();
        await tick().catch((e) => log.error(`relayer: ${e.message}`));
        return status();
    }

    /** Deliveries still on their way, for one account (the website shows them as "arriving") */
    const pending = (account) => [ ...jobs.values() ].filter((j) => !account || j.account === lower(account))
        .map(({ from, to, account: a, token, state: st, note, since }) => ({ from, to, account: a, token, state: st, note, since }));

    /** Who pays the gas and how much it still has on every chain */
    async function status() {
        const balance = async (read) => { try { return ethers.formatEther(await read()); } catch { return null; } };
        return {
            address: me,
            paused,
            queued: jobs.size,
            balances: {
                [hubKey]: await balance(() => hub.balance(me)),
                ...Object.fromEntries(await Promise.all(chains.map(async (c) => [ c.key, await balance(() => c.provider.getBalance(me)) ]))),
            },
            gasDrop: { [hubKey]: ethers.formatEther(hubGasDrop), ...Object.fromEntries(chains.map((c) => [ c.key, ethers.formatEther(c.gasDrop) ])) },
            lastScan: { at: lastScan.at, errors: lastScan.errors },
        };
    }

    return {
        address: me,
        start,
        stop: () => { clearInterval(timer); chains.forEach((c) => c.provider.destroy()); },
        tick,
        enqueue,
        pending,
        status,
        // Tests: hold deliveries for a moment (a user may still claim by hand)
        pause: () => { paused = true; },
        resume: () => { paused = false; },
    };
}

export { createRelayer };
