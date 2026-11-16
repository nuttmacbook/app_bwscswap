/*
 * What a wallet signs for one transaction on a BWSC (Program VM) chain: EIP-712 typed data.
 *
 * This is a copy of normalizeTransaction / buildTypedData / canonicalJson from the chain
 * (src/crypto/signature.js + src/core/encoding.js of the node). It must stay byte-for-byte the same:
 * one different character and the node rejects every signature. test/typedData.test.mjs compares
 * the two on many transactions and fails if they ever drift apart.
 *
 * Format 2 (node ad98bc4, Nov 2026): the domain has no chainId, so a wallet can sign while it has any EVM chain open
 * (no need to add or switch to BWSC). The chain's id is in the message instead (the node checks it: no replay on
 * another chain), plus signedOnChainId = the chain the wallet had open when it signed (shown on the explorer).
 */

export const DOMAIN_NAME = "Bluewolfchain";
export const DOMAIN_VERSION = "2";
export const DOMAIN_TYPE = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
];

const HEX_PATTERN = /^0x[0-9a-f]+$/i;

const SIGNED_ON_FIELD = { name: "signedOnChainId", type: "uint256" };
const BASE_FIELDS = [
    { name: "chainId", type: "uint256" },
    { name: "action", type: "string" },
    { name: "from", type: "address" },
    { name: "to", type: "string" },
    { name: "method", type: "string" },
    { name: "input", type: "string" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "gasLimit", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
];

// Field order matters; signedOnChainId closes every kind (before sponsor)
export const TRANSACTION_TYPE = [ ...BASE_FIELDS, SIGNED_ON_FIELD ];

// EIP-1559 transactions swap gasPrice for these two fields (same type name, so the digest never collides)
export const TRANSACTION_TYPE_1559 = [
    ...BASE_FIELDS.filter((field) => field.name !== "gasPrice"),
    { name: "maxFeePerGas", type: "uint256" },
    { name: "maxPriorityFeePerGas", type: "uint256" },
    SIGNED_ON_FIELD,
];

export const SPONSOR_FIELD = { name: "sponsor", type: "address" };

const ACTIONS = new Set([ "call", "deploy", "transfer", "metadata", "init", "reject", "upgrade", "setUpgrader", "initUpgrade", "rejectUpgrade", "setGasConfig" ]);

export const isSponsoredTx = (tx = {}) => tx.sponsor !== undefined && tx.sponsor !== null && tx.sponsor !== "";
export const isFeeMarketTx = (tx = {}) => (tx.maxFeePerGas ?? null) !== null || (tx.maxPriorityFeePerGas ?? null) !== null;
export const transactionTypeOf = (tx = {}) => [ ...(isFeeMarketTx(tx) ? TRANSACTION_TYPE_1559 : TRANSACTION_TYPE), ...(isSponsoredTx(tx) ? [ SPONSOR_FIELD ] : []) ];

/** Addresses on the chain are always lower case */
export const normalizeAddress = (value) => (typeof value === "string" ? value.toLowerCase() : value);

const normalizeHex = (value) => (typeof value === "string" && HEX_PATTERN.test(value) ? value.toLowerCase() : value);

/** Every 0x… hex value and key, at any depth, to lower case (the node does the same before hashing) */
export function normalizeHexDeep(value) {
    if (Array.isArray(value)) return value.map(normalizeHexDeep);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ normalizeHex(key), normalizeHexDeep(item) ]));
    }
    return normalizeHex(value);
}

/** Sorted keys, no spaces, bigint → "123n": the same string on every machine */
export function canonicalJson(value) {
    if (typeof value === "bigint") return JSON.stringify(`${value}n`);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
        return `{${entries.join(",")}}`;
    }
    try {
        const json = JSON.stringify(value === undefined ? null : value);
        return json === undefined ? JSON.stringify(String(value)) : json;
    } catch {
        return JSON.stringify(String(value));
    }
}

/** Numbers in a transaction: safe integer, bigint, "123" or "123n" */
export function parseUint(value) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^\d+n?$/.test(value)) return BigInt(value.replace(/n$/, ""));
    return null;
}

function feeOf(tx) {
    if (!isFeeMarketTx(tx)) return { gasPrice: tx.gasPrice ?? 0 };
    if (parseUint(tx.gasPrice ?? 0)) throw new Error("gasPrice cannot be used together with maxFeePerGas / maxPriorityFeePerGas");
    return { maxFeePerGas: tx.maxFeePerGas ?? 0, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? 0 };
}

/** Fills the fields that were left out and lower-cases addresses, exactly like the node */
export function normalizeTransaction(tx = {}) {
    const action = tx.action ?? "call";
    if (!ACTIONS.has(action)) throw new Error(`Unknown action: ${action}`);
    const chainId = tx.chainId ?? 1;
    if (parseUint(chainId) === null) throw new Error("chainId must be a whole number");
    const signedOnChainId = tx.signedOnChainId ?? chainId;   // left out = signed on this chain (scripts, key wallets)
    if (parseUint(signedOnChainId) === null) throw new Error("signedOnChainId must be a whole number");
    return {
        chainId: Number(parseUint(chainId)),
        signedOnChainId: Number(parseUint(signedOnChainId)),
        action,
        from: normalizeAddress(tx.from ?? ""),
        to: normalizeAddress(tx.to ?? ""),
        method: tx.method ?? "",
        input: normalizeHexDeep(tx.input ?? {}),
        code: tx.code ?? null,
        ...(tx.upgrader === undefined || tx.upgrader === null || tx.upgrader === "" ? {} : { upgrader: normalizeAddress(tx.upgrader) }),
        value: tx.value ?? 0,
        nonce: tx.nonce ?? 0,
        gasLimit: tx.gasLimit ?? 0,
        ...feeOf(tx),
        ...(isSponsoredTx(tx) ? { sponsor: normalizeAddress(tx.sponsor) } : {}),
    };
}

/** EIP-712 payload of a transaction (numbers may be "5n"; the node accepts it) */
export function buildTypedData(rawTx) {
    const tx = normalizeTransaction(rawTx);
    return {
        domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION },
        types: {
            EIP712Domain: DOMAIN_TYPE,
            Transaction: transactionTypeOf(tx),
        },
        primaryType: "Transaction",
        message: {
            chainId: tx.chainId,
            action: tx.action,
            from: tx.from,
            to: tx.to,
            method: tx.method,
            input: canonicalJson({ input: tx.input, code: tx.code, upgrader: tx.upgrader }),
            value: tx.value,
            nonce: tx.nonce,
            gasLimit: tx.gasLimit,
            ...(isFeeMarketTx(tx) ? { maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : { gasPrice: tx.gasPrice }),
            signedOnChainId: tx.signedOnChainId,
            ...(tx.sponsor ? { sponsor: tx.sponsor } : {}),
        },
    };
}

/**
 * The same payload for a wallet (MetaMask eth_signTypedData_v4, ethers signTypedData): uint256 fields become plain
 * decimal strings, because wallets cannot read "5n". The digest does not change.
 */
export function walletTypedData(tx) {
    const typed = buildTypedData(tx);
    const message = { ...typed.message };
    for (const field of typed.types.Transaction) {
        if (field.type === "uint256" && message[field.name] !== undefined) message[field.name] = String(parseUint(message[field.name]) ?? message[field.name]);
    }
    return { ...typed, message };
}
