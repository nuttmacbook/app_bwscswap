/*
 * ENGINE (same in every project, do not edit).
 *
 * Off-chain helpers the UI uses: number and address formatting, explorer links, telling a rejection
 * from a failure. UI code imports these instead of reaching into engine/chain.
 */

import { utils } from "bwscbox";
import { shortAddress, timestampToUTC, txUrl, addressUrl } from "../chain/connect";
import { isUserReject } from "../chain/txError";

/** Escapes text before it goes into innerHTML (anything that came from the network or a user) */
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Money for people: formNumber(1234567n, 6, 2) → "1.23" (bigint in smallest units, token decimals, decimals shown).
 * Plain numbers / decimal strings: formNumber("1234.5", 0, 2) → "1,234.5". Rounds down, never shows more than there is.
 */
const formNumber = (value, decimals = 0, places = 2) => (typeof value === "bigint"
    ? utils.formNumber(value, places, decimals)
    : utils.formNumber(String(value ?? "0"), places));

/** "1.5" → 1500000n for 6 decimals; throws a readable error on anything else */
const toUnits = (text, decimals) => utils.toUnits(text, decimals);
/** 1500000n → "1.5" for 6 decimals (exact, for input fields) */
const fromUnits = (amount, decimals) => utils.fromUnits(amount, decimals);

/** "86.64370061646714305" → "86.643700" → "86.6437": at most `places` decimals, cut down (for amounts shown in a field) */
const shortAmount = (text, places = 6) => {
    const value = String(text ?? "");
    if (!value.includes(".")) return value;
    return value.slice(0, value.indexOf(".") + 1 + places).replace(/\.?0+$/, "") || "0";
};

export { shortAmount, formNumber, shortAddress, timestampToUTC, txUrl, addressUrl, isUserReject, escapeHtml, toUnits, fromUnits };
