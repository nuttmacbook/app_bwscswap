/*
 * HTTP client for one BWSC node (Program VM server). Works in the browser and in Node 18+.
 *
 *   const client = createClient({ node: "https://node.example" });
 *   await client.query({ program, method: "balanceOf", input: { who } })   // read, no wallet, no gas
 *   const sent = await client.send({ action: "call", to, method, input }, signer)
 *   const receipt = await client.waitReceipt(sent.hash)
 *
 * Every request goes through onRequest(path) first, so an app can count how many calls a page makes.
 */

import { toChainValue, fromChainValue } from "./values.js";
import { nodeMessage } from "./messages.js";

export const DEFAULT_GAS_LIMIT = 500_000;

/** An answer from the node that is not 2xx (body = what the node sent, e.g. a failed simulation) */
export class ChainError extends Error {
    constructor(message, { status, body, code } = {}) {
        super(message);
        this.name = "ChainError";
        this.status = status;
        this.body = body;
        this.code = code;
    }
}

/** Reads the most useful message out of anything the node returns when something failed (node messages in English) */
export const errorText = (data) => {
    const pick = (value) => (typeof value === "string" ? value : typeof value?.message === "string" ? value.message : null);
    const text = pick(data?.simulation?.error) ?? pick(data?.error) ?? pick(data?.reason) ?? pick(data?.result?.error)
        ?? (Array.isArray(data?.issues) && data.issues.length ? data.issues.map((issue) => `line ${issue.line}: ${issue.message}`).join("; ") : null);
    return text === null ? null : nodeMessage(text);
};

/**
 * @param {object} options
 * @param {string} options.node            base URL of the node (no trailing /)
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.gasLimit]       default gas limit for transactions
 * @param {(path: string) => void} [options.onRequest]
 */
export function createClient({ node, fetch: fetchImpl = globalThis.fetch, gasLimit = DEFAULT_GAS_LIMIT, onRequest = () => {} } = {}) {
    if (!node) throw new Error("bwscbox: the node URL is not set");
    if (typeof fetchImpl !== "function") throw new Error("bwscbox: fetch is not available");
    const base = String(node).replace(/\/+$/, "");
    const id = (value) => encodeURIComponent(String(value));
    const queues = new Map();   // sender → last send in flight

    async function request(path, { method = "GET", body } = {}) {
        onRequest(path);
        let response;
        try {
            // text/plain keeps the POST a "simple" CORS request: no preflight, which the node only answers on /evm.
            // The node parses the body as JSON whatever the content type says.
            response = await fetchImpl(base + path, method === "GET" ? {} : {
                method, headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(toChainValue(body)),
            });
        } catch (error) {
            throw new ChainError(`The network did not answer (${base}).`, { status: 0, code: "NETWORK", body: { error: error?.message } });
        }
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
        if (!response.ok) throw new ChainError(errorText(data) ?? `HTTP ${response.status}`, { status: response.status, body: data, code: data?.error?.code ?? data?.code });
        return data;
    }
    const get = (path) => request(path);
    const post = (path, body) => request(path, { method: "POST", body });

    const client = {
        node: base,
        get,
        post,

        /** { chainId, latest, baseFee, gasPrice, … } */
        genesis: () => get("/genesis"),
        /** wallet_addEthereumChain parameters: { chainId (hex), chainName, nativeCurrency, rpcUrls, blockExplorerUrls } */
        chainParams: () => get("/evm"),
        health: () => get("/health"),
        nonce: async (address) => (await get(`/nonce/${id(address)}`))?.nonce,
        address: (address) => get(`/address/${id(address)}`),
        /** Native balance in wei as bigint */
        balance: async (address) => fromChainValue((await client.address(address))?.native?.balance ?? "0n") ?? 0n,
        transaction: (hash) => get(`/tx/${id(hash)}`),
        receipt: (hash) => get(`/tx/${id(hash)}/receipt`),
        program: (address) => get(`/program/${id(address)}`),

        /**
         * Runs a program function without a transaction and returns its result (bigint values already converted).
         * A throw inside the program becomes a ChainError with the program's message.
         */
        async query({ program, method, input = {}, from } = {}) {
            const answer = await post("/query", { programUuid: program, functionName: method, input, ...(from ? { context: { sender: String(from).toLowerCase(), origin: String(from).toLowerCase() } } : {}) });
            return fromChainValue(answer?.result);
        },

        /** Adds chainId / from / nonce / EIP-1559 fees that were left out → a transaction ready to sign */
        async prepare(fields = {}, { from } = {}) {
            const sender = String(fields.from ?? from ?? "").toLowerCase();
            if (!sender) throw new Error("bwscbox: a transaction needs from (or a signer)");
            const needsFee = fields.gasPrice === undefined && fields.maxFeePerGas === undefined;
            const info = fields.chainId === undefined || needsFee ? await client.genesis() : null;
            const baseFee = BigInt(String(info?.baseFee ?? info?.gasPrice ?? 1).replace(/n$/, ""));
            return {
                action: "call", to: "", method: "", input: {}, value: "0", gasLimit,
                ...(needsFee ? { maxFeePerGas: String(baseFee * 2n), maxPriorityFeePerGas: "0" } : {}),
                ...fields,
                chainId: fields.chainId ?? info?.chainId,
                from: sender,
                nonce: fields.nonce ?? (await client.nonce(sender)),
            };
        },

        /** POST /sendtx with a signed transaction */
        submit: ({ tx, signature, sponsorSignature }) => post("/sendtx", { tx, signature, ...(sponsorSignature ? { sponsorSignature } : {}) }),

        /**
         * prepare → sign → /sendtx. The node simulates first and refuses a transaction that would fail,
         * so a failing call throws here with the program's message and costs nothing.
         * @returns {{ hash, sender, tx, signature, simulation }}
         */
        async send(fields, signer, { sponsor } = {}) {
            if (!signer?.signTransaction) throw new Error("bwscbox: send needs a signer");
            // One sender at a time: two sends started together would otherwise read the same nonce from the node
            const key = String(signer.address ?? "").toLowerCase();
            const previous = queues.get(key) ?? Promise.resolve();
            const run = previous.catch(() => {}).then(async () => {
                const tx = toChainValue(await client.prepare(sponsor ? { ...fields, sponsor: sponsor.address } : fields, { from: signer.address }));
                // Format 2: a wallet signs from whatever chain it has open; that chain id is part of what it signs
                const signedOn = signer.signingChainId ? await signer.signingChainId().catch(() => null) : null;
                if (signedOn) tx.signedOnChainId = signedOn;
                const signature = await signer.signTransaction(tx);
                const sponsorSignature = sponsor ? await sponsor.signTransaction(tx) : undefined;
                const queued = await client.submit({ tx, signature, sponsorSignature });
                if (queued?.queued === false) throw new ChainError(errorText(queued) ?? "The node did not accept the transaction.", { status: 400, body: queued });
                return { ...queued, tx, signature };
            });
            queues.set(key, run);
            run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => {});
            return run;
        },

        /**
         * Waits until a transaction is in a block (follows replacements) and returns the /tx record.
         * Rejected → returned as is (status "rejected"). Too long → ChainError 408.
         */
        async wait(hash, { timeoutMs = 60_000, intervalMs = 400 } = {}) {
            const deadline = Date.now() + timeoutMs;
            let current = hash;
            for (;;) {
                let found = null;
                try { found = await client.transaction(current); } catch (error) { if (error.status !== 404) throw error; }
                if (found?.status === "replaced" && found.replacedBy) { current = found.replacedBy; continue; }
                if (found && found.status !== "pending" && (found.status === "rejected" || Number.isInteger(found.blockNumber))) return { ...found, hash: current };
                if (Date.now() >= deadline) throw new ChainError(`Still waiting for ${current} after ${Math.round(timeoutMs / 1000)}s.`, { status: 408, code: "TIMEOUT" });
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
        },

        /**
         * wait() + the receipt. Throws a ChainError when the transaction was rejected or the program threw,
         * so `await` only passes for a transaction that really worked (like ethers' tx.wait()).
         */
        async waitReceipt(hash, options) {
            const done = await client.wait(hash, options);
            if (done?.status === "rejected") throw new ChainError(nodeMessage(done.reason ?? "The transaction was rejected."), { status: 400, body: done, code: done.code });
            const receipt = await client.receipt(done.hash);
            const status = receipt?.status ?? done?.status;
            if (status !== "success") throw new ChainError(errorText(receipt) ?? "The transaction failed.", { status: 400, body: receipt, code: receipt?.error?.code ?? "FAILED" });
            return { ...receipt, blockNumber: done.blockNumber ?? receipt?.blockNumber, transactionHash: done.hash, result: fromChainValue(receipt?.result) };
        },
    };
    return client;
}
