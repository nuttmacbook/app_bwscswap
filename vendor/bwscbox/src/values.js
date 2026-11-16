/*
 * Values between the page and a BWSC chain.
 * The chain writes every bigint as "123n" in JSON and only accepts "123n" (never a JS number) inside program input.
 */

export const ZERO = "0x0000000000000000000000000000000000000000";

/** "123n" → 123n, at any depth (other values stay as they are) */
export function fromChainValue(value) {
    if (typeof value === "string" && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1));
    if (Array.isArray(value)) return value.map(fromChainValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ key, fromChainValue(item) ]));
    return value;
}

/** 123n → "123n", at any depth: the form program input needs */
export const toChainValue = (value) => JSON.parse(JSON.stringify(value ?? null, (key, item) => (typeof item === "bigint" ? `${item}n` : item)));

/**
 * "1.5" with 6 decimals → 1500000n. Throws on anything that is not a plain positive decimal number,
 * or that has more decimals than the token, so a typo never becomes a different amount.
 */
export function toUnits(text, decimals = 18) {
    const clean = String(text ?? "").trim().replace(/,/g, "");
    if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") throw new Error("Enter a number, like 1.5");
    const [ whole = "0", fraction = "" ] = clean.split(".");
    if (fraction.length > Number(decimals)) throw new Error(`Use at most ${decimals} decimals`);
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((fraction || "0").padEnd(Number(decimals), "0") || "0");
}

/** 1500000n with 6 decimals → "1.5" (no rounding, no trailing zeros) */
export function fromUnits(amount, decimals = 18) {
    const value = BigInt(amount ?? 0);
    const sign = value < 0n ? "-" : "";
    const abs = value < 0n ? -value : value;
    const base = 10n ** BigInt(decimals);
    const fraction = (abs % base).toString().padStart(Number(decimals), "0").replace(/0+$/, "");
    return `${sign}${abs / base}${fraction ? `.${fraction}` : ""}`;
}

/**
 * For people: 1234567.891234 → "1,234,567.8912". Takes a number, a decimal string or (amount, decimals) bigint.
 * Rounds down, so a balance is never shown bigger than it is.
 */
export function formNumber(value, maxDecimals = 4, decimals = null) {
    const text = typeof value === "bigint" && decimals !== null ? fromUnits(value, decimals) : String(value ?? "0");
    const [ rawWhole, rawFraction = "" ] = text.replace(/^-/, "").split(".");
    const whole = (rawWhole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = rawFraction.slice(0, maxDecimals).replace(/0+$/, "");
    return `${text.startsWith("-") ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** 0x1234…abcd */
export const shortAddress = (address, head = 6, tail = 4) => {
    const text = String(address ?? "");
    return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text;
};

/** Block time (ms on this chain) → "2026-10-25 13:05 UTC" */
export const timestampToUTC = (ms) => {
    const date = new Date(Number(ms ?? 0));
    return Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isAddress = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
