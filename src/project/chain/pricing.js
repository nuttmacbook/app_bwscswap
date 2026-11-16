/*
 * YOUR CODE (on-chain math for previews). The page shows what a swap or deposit would give while you type,
 * without asking the node on every key press. Same formulas as the BwscDex program (deploy-kit/bwsc/BwscDex.js);
 * the program checks the real numbers again (minOut / minShares), so a stale preview can never cost money.
 */

const BPS = 10_000n;

/** Tokens out for `amountIn` with the pool's reserves and fee (x · y = k) */
const amountOut = (amountIn, reserveIn, reserveOut, feeBps) => {
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
    const inAfterFee = amountIn * (BPS - feeBps);
    return (inAfterFee * reserveOut) / (reserveIn * BPS + inAfterFee);
};

/** Exact out: the least that must go in to get `amountOut` (rounded up), or null when the pool cannot give it */
const amountIn = (amountOut, reserveIn, reserveOut, feeBps) => {
    if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n || amountOut >= reserveOut) return null;
    return (reserveIn * amountOut * BPS) / ((reserveOut - amountOut) * (BPS - feeBps)) + 1n;
};

/** The lowest amount you accept: out less the slippage (in basis points) */
const withSlippage = (amount, slippageBps) => (amount * (BPS - BigInt(slippageBps))) / BPS;

/** The most you pay on an exact-out swap: in plus the slippage (rounded up) */
const withSlippageUp = (amount, slippageBps) => (amount * (BPS + BigInt(slippageBps)) + BPS - 1n) / BPS;

/**
 * Everything the swap page shows for one input.
 * @returns {{ out: bigint, minOut: bigint, fee: bigint, impactBps: number }}
 */
function swapPreview({ amountIn, reserveIn, reserveOut, feeBps, slippageBps }) {
    const out = amountOut(amountIn, reserveIn, reserveOut, feeBps);
    // Price impact: how much worse than the pool's current price (before fee)
    const ideal = reserveIn > 0n ? (amountIn * reserveOut) / reserveIn : 0n;
    const impactBps = ideal > 0n ? Number(((ideal - out) * BPS) / ideal) - Number(feeBps) : 0;
    return { out, minOut: withSlippage(out, slippageBps), fee: (amountIn * feeBps) / BPS, impactBps: Math.max(0, impactBps) };
}

/** The other side of a deposit at the current price (both free for the first deposit) */
const pairedAmount = (amount, reserveFrom, reserveTo) => (reserveFrom > 0n ? (amount * reserveTo) / reserveFrom : 0n);

/** Shares a deposit would mint, and what removing shares pays */
const sqrt = (value) => {
    if (value < 2n) return value;
    let x = value;
    let y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + value / x) / 2n; }
    return x;
};
function depositPreview({ amountA, amountB, reserveA, reserveB, totalShares, minimumLiquidity }) {
    if (amountA <= 0n || amountB <= 0n) return { shares: 0n, amountA: 0n, amountB: 0n };
    if (totalShares === 0n) {
        const root = sqrt(amountA * amountB);
        return { shares: root > minimumLiquidity ? root - minimumLiquidity : 0n, amountA, amountB };
    }
    let a = amountA;
    let b = amountB;
    const neededB = (amountA * reserveB) / reserveA;
    if (neededB <= amountB) b = neededB;
    else a = (amountB * reserveA) / reserveB;
    const byA = (a * totalShares) / reserveA;
    const byB = (b * totalShares) / reserveB;
    return { shares: byA < byB ? byA : byB, amountA: a, amountB: b };
}
const withdrawPreview = ({ shares, reserveA, reserveB, totalShares }) => (totalShares > 0n
    ? { amountA: (shares * reserveA) / totalShares, amountB: (shares * reserveB) / totalShares }
    : { amountA: 0n, amountB: 0n });

export { amountOut, withSlippage, swapPreview, pairedAmount, depositPreview, withdrawPreview, amountIn, withSlippageUp };
