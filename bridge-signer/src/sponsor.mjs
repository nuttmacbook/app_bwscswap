/*
 * Gas sponsor: the relayer wallet pays the gas of one kind of transaction, so a wallet that ran out of BWSC can buy
 * some back. Only this (settings/config.js bridgeSigner.gasSponsor):
 *
 *   swap USDT → BWSC on BwscDex       method "swap", path exactly [USDT, native], amountIn ≥ minIn, paid to the sender
 *   approve USDT for BwscDex          the step before the swap, amount ≥ minIn
 *
 * and only for a wallet that holds less than `belowBalance` BWSC right now, at most `perWalletPerDay` times a day per
 * wallet and `perDay` times a day in all (UTC days). The transaction must carry the sender's own valid signature, send
 * no coins (value 0), give no tip, and ask for at most `maxGasLimit` gas at no more than 3 × the base fee.
 * The chain's `sponsor` field does the rest: the sender signs as usual, the relayer signs the same transaction as the
 * one who pays its gas, and the node charges the gas to the relayer. Nothing else can be sponsored.
 *
 * createGasSponsor(libs, options) → { info(), sign({ tx, signature }) → { sponsorSignature, sponsor } }
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const lower = (a) => String(a ?? "").toLowerCase();
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ""));
const big = (v) => {
    try { return BigInt(String(v ?? 0).replace(/n$/, "") || 0); } catch { return null; }
};

class SponsorError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

/**
 * @param {{ ethers, createClient, keyWalletSigner, typedData }} libs
 * @param {object} o
 * @param {string} o.key           the relayer wallet's private key (it pays the gas)
 * @param {string} o.nodeUrl       the BWSC node
 * @param {string} o.dex           BwscDex
 * @param {string} o.coin          the coin that may be swapped for BWSC (USDT on BWSC)
 * @param {bigint} o.minIn         the least amount of `coin` a sponsored swap or approval moves (wei)
 * @param {bigint} o.belowBalance  only wallets with less BWSC than this (wei)
 * @param {number} [o.perWalletPerDay]  sponsored transactions per wallet per UTC day (approve + swap count apart)
 * @param {number} [o.perDay]           sponsored transactions per UTC day in all
 * @param {number} [o.maxGasLimit]
 * @param {() => number} [o.now]   ms clock (tests)
 */
function createGasSponsor({ ethers, createClient, keyWalletSigner, typedData }, o) {
    const client = createClient({ node: o.nodeUrl });
    const wallet = new ethers.Wallet(o.key);
    const sponsor = keyWalletSigner(wallet);
    const dex = lower(o.dex);
    const coin = lower(o.coin);
    const perWalletPerDay = Number(o.perWalletPerDay ?? 3);
    const perDay = Number(o.perDay ?? 300);
    const maxGasLimit = BigInt(o.maxGasLimit ?? 600_000);
    const now = o.now ?? (() => Date.now());
    if (!isAddress(dex) || !isAddress(coin)) throw new Error("gasSponsor needs programs.dex and the coin's address.");
    let chainId = null;
    let day = "";
    let total = 0;
    const used = new Map();

    const today = () => new Date(now()).toISOString().slice(0, 10);
    const resetIfNewDay = () => {
        if (day === today()) return;
        day = today();
        total = 0;
        used.clear();
    };

    /** What kind of sponsored transaction this is, or a SponsorError saying why it is not one */
    function kindOf(tx) {
        const input = tx.input ?? {};
        if (tx.to === coin && tx.method === "approve") {
            if (lower(input.spender) !== dex) throw new SponsorError("Only an approval for the exchange can be sponsored.");
            const amount = big(input.amount);
            if (amount === null || amount < o.minIn) throw new SponsorError("The amount is below the sponsored minimum.");
            return "approve";
        }
        if (tx.to === dex && tx.method === "swap") {
            const path = Array.isArray(input.path) ? input.path.map(lower) : [];
            if (path.length !== 2 || path[0] !== coin || path[1] !== ZERO) throw new SponsorError("Only a direct swap of this coin for BWSC can be sponsored.");
            if (input.to !== undefined && input.to !== null && input.to !== "" && lower(input.to) !== tx.from) throw new SponsorError("A sponsored swap must pay the wallet that signs it.");
            const amount = big(input.amountIn);
            if (amount === null || amount < o.minIn) throw new SponsorError("The amount is below the sponsored minimum.");
            return "swap";
        }
        throw new SponsorError("Only a swap of this coin for BWSC (and its approval) can be sponsored.");
    }

    async function sign({ tx: raw, signature } = {}) {
        if (!raw || typeof raw !== "object") throw new SponsorError("Send { tx, signature }.");
        let tx;
        try { tx = typedData.normalizeTransaction(raw); } catch (error) { throw new SponsorError(`The transaction is not valid: ${error.message}`); }
        if (tx.action !== "call") throw new SponsorError("Only a program call can be sponsored.");
        if (tx.sponsor !== lower(sponsor.address)) throw new SponsorError(`The transaction must name ${sponsor.address} as its sponsor.`);
        if (big(tx.value) !== 0n) throw new SponsorError("A sponsored transaction cannot send coins.");
        const kind = kindOf(tx);

        // The sender's own signature over exactly this transaction
        let signer = "";
        try {
            const typed = typedData.walletTypedData(raw);
            const { EIP712Domain, ...types } = typed.types;
            signer = lower(ethers.verifyTypedData(typed.domain, types, typed.message, String(signature ?? "")));
        } catch { /* reported below */ }
        if (!tx.from || signer !== tx.from) throw new SponsorError("The wallet's signature does not match this transaction.");

        // Gas: no tip, a sane limit, a fee cap near the base fee
        const genesis = await client.genesis();
        chainId ??= Number(genesis.chainId);
        if (tx.chainId !== chainId) throw new SponsorError("Wrong chain.");
        const baseFee = big(genesis.baseFee ?? genesis.gasPrice) ?? 0n;
        if (tx.maxFeePerGas === undefined || big(tx.maxPriorityFeePerGas) !== 0n) throw new SponsorError("A sponsored transaction pays no tip.");
        if ((big(tx.maxFeePerGas) ?? 0n) > baseFee * 3n) throw new SponsorError("The fee cap is too high.");
        const gasLimit = big(tx.gasLimit) ?? 0n;
        if (gasLimit <= 0n || gasLimit > maxGasLimit) throw new SponsorError("The gas limit is too high.");

        // Only for a wallet that is (nearly) out of BWSC
        const balance = await client.balance(tx.from);
        if (balance >= o.belowBalance) throw new SponsorError("This wallet has enough BWSC to pay its own gas.");

        resetIfNewDay();
        if ((used.get(tx.from) ?? 0) >= perWalletPerDay) throw new SponsorError("This wallet used its free swaps for today. Try again tomorrow (UTC).", 429);
        if (total >= perDay) throw new SponsorError("Free swaps are used up for today. Try again tomorrow (UTC).", 429);
        const sponsorSignature = await sponsor.signTransaction(raw);
        used.set(tx.from, (used.get(tx.from) ?? 0) + 1);
        total++;
        console.log(`Gas sponsor: ${kind} for ${tx.from} (${used.get(tx.from)}/${perWalletPerDay} today, ${total}/${perDay} in all)`);
        return { sponsor: lower(sponsor.address), sponsorSignature, kind };
    }

    function info() {
        resetIfNewDay();
        return {
            sponsor: lower(sponsor.address),
            dex,
            coin,
            minIn: String(o.minIn),
            belowBalance: String(o.belowBalance),
            perWalletPerDay,
            perDay,
            usedToday: total,
        };
    }

    return { info, sign, address: lower(sponsor.address), usedBy: (account) => { resetIfNewDay(); return used.get(lower(account)) ?? 0; } };
}

export { createGasSponsor, SponsorError };
