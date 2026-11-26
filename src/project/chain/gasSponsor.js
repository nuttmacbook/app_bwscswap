/*
 * YOUR CODE (off-chain + on-chain). Free gas for buying BWSC (settings/config.js bridgeSigner.gasSponsor).
 *
 * A wallet that holds less than `belowBalance` BWSC cannot pay gas, so it could never swap its USDT back into BWSC.
 * When it swaps at least `minIn` USDT for BWSC on the direct USDT / wBWSC pair, the relayer of the bridge signer pays
 * the gas of the swap and of its approval: the wallet signs as usual, the transaction names the relayer as its
 * `sponsor`, the signer (bridge-signer/src/sponsor.mjs) checks it and signs as the one who pays, and the node charges
 * the gas to the relayer. The signer checks every rule again, so this file only decides what the page offers.
 *
 *   freeGasFor(data, from, to, amountIn)   → { free, reason }   (data = getDexData)
 *   sponsoredSigner(wallet)                → { signer, sponsor } for box.createProgram(…, signer).fn(input, { sponsor })
 */

import { config, ZERO } from "../../engine/settings";
import { toUnits } from "../../engine/ui/helpers";

const RULES = config.bridgeSigner?.gasSponsor ?? {};
const SIGNER_URL = String(config.bridgeSigner?.url ?? "").replace(/\/+$/, "");
const lower = (a) => String(a ?? "").toLowerCase();
const COIN = lower(RULES.coin);
const ON = RULES.enabled === true && Boolean(SIGNER_URL) && /^0x[0-9a-f]{40}$/.test(COIN);

const unitsOr = (text, decimals, fallback) => { try { return toUnits(String(text), decimals); } catch { return fallback; } };

/** Whether this swap's gas is paid by the relayer (the page shows it; swapCoins sends it that way) */
function freeGasFor(data, from, to, amountIn) {
    if (!ON || !data?.isReady || !data.isConnected) return { free: false, reason: "off" };
    if (lower(from) !== COIN || lower(to) !== ZERO) return { free: false, reason: "pair" };
    const coin = data.tokens?.find((t) => t.address === COIN);
    if (!coin) return { free: false, reason: "pair" };
    const pair = data.pairs?.find((p) => [ p.tokenA.address, p.tokenB.address ].includes(COIN) && [ p.tokenA.address, p.tokenB.address ].includes(data.wrapped));
    if (!pair || !(pair.reserveA > 0n && pair.reserveB > 0n)) return { free: false, reason: "pair" };
    if (data.native.balance >= unitsOr(RULES.belowBalance ?? "5", data.native.decimals ?? 18, 0n)) return { free: false, reason: "balance" };
    const minIn = unitsOr(RULES.minIn ?? "1", coin.decimals, 0n);
    if (!(amountIn >= minIn)) return { free: false, reason: "min", minIn, symbol: coin.symbol };
    return { free: true, pair, minIn, symbol: coin.symbol };
}

/** The relayer's address (asked once from the signer) */
let sponsorAddress = null;
async function relayerAddress() {
    if (sponsorAddress) return sponsorAddress;
    const answer = await fetch(`${SIGNER_URL}/sponsor`).then((r) => r.json()).catch(() => null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(answer?.sponsor ?? ""))) throw new Error("Free gas is not available right now. Try again soon.");
    sponsorAddress = lower(answer.sponsor);
    return sponsorAddress;
}

/**
 * The wallet's signer, plus a sponsor that sends each transaction (with the wallet's signature) to the bridge signer
 * and gets back the relayer's signature as the one who pays the gas.
 */
async function sponsoredSigner(wallet) {
    const address = await relayerAddress();
    let lastSignature = "";
    const signer = {
        ...wallet.signer,
        address: wallet.signer.address,
        signTransaction: async (tx) => {
            lastSignature = await wallet.signer.signTransaction(tx);
            return lastSignature;
        },
    };
    const sponsor = {
        address,
        signTransaction: async (tx) => {
            const response = await fetch(`${SIGNER_URL}/sponsor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx, signature: lastSignature }) })
                .catch(() => null);
            const answer = response ? await response.json().catch(() => ({})) : {};
            if (!response?.ok || !answer.sponsorSignature) throw new Error(`Free gas was refused: ${answer.error ?? "the signer did not answer"}.`);
            return answer.sponsorSignature;
        },
    };
    return { signer, sponsor };
}

export { freeGasFor, sponsoredSigner };
