/*
 * YOUR CODE (on-chain, tests). wBWSC: wrap / unwrap 1 : 1, a standard token in between, always fully backed.
 */

import { utils } from "bwscbox";

const units = (text) => utils.toUnits(String(text), 18);

// What a transaction paid for gas (the receipt's fee), so balance checks are exact whatever the node's base fee is
const feeOf = (receipt) => BigInt(String(receipt?.fee ?? 0).replace(/n$/, ""));

export default async function (t) {
    const W = t.deployed.addresses.WBWSC;
    const view = (account = "") => t.read("WBWSC", "getView", { account });
    const alice = t.newWallet();
    const bob = t.newWallet();
    const backed = async () => { const v = await view(); return v.totalSupply === v.held; };

    let v = await view();
    // The test chain's owner wrapped LOCAL_WRAP coins right after deploying
    t.check("a standard token: name, ticker, 18 decimals", v.symbol === "wBWSC" && v.decimals === 18n && (await t.read("WBWSC", "name")) === "Wrapped BWSC");
    t.check("fully backed from the start", await backed());

    const n0 = await t.balance(alice.address);
    const r = await t.send(alice, "WBWSC", "deposit", {}, { value: units(10) });
    t.gas("deposit", r);
    t.check("deposit 10: alice gets 10 wBWSC", (await t.read("WBWSC", "balanceOf", { who: alice.address })) === units(10) && r.result === units(10));
    t.check("…and pays 10 coins (plus gas)", n0 - (await t.balance(alice.address)) >= units(10));
    t.check("deposit with no value is refused", await t.doesRevert(() => t.send(alice, "WBWSC", "deposit", {}), "greater than 0"));

    await t.send(alice, "WBWSC", "transfer", { to: bob.address, amount: units(3) });
    t.check("transfer works like any token", (await t.read("WBWSC", "balanceOf", { who: bob.address })) === units(3));
    t.check("sending coins with transfer is refused", await t.doesRevert(() => t.send(alice, "WBWSC", "transfer", { to: bob.address, amount: 1n }, { value: 1n }), "Do not send"));
    t.check("transfer to 0x0…0 is refused (use withdraw)", await t.doesRevert(() => t.send(alice, "WBWSC", "transfer", { to: "0x0000000000000000000000000000000000000000", amount: 1n }), "withdraw"));

    await t.send(alice, "WBWSC", "approve", { spender: bob.address, amount: units(2) });
    await t.send(bob, "WBWSC", "transferFrom", { from: alice.address, to: bob.address, amount: units(2) });
    t.check("approve + transferFrom", (await t.read("WBWSC", "balanceOf", { who: bob.address })) === units(5) && (await t.read("WBWSC", "allowance", { owner: alice.address, spender: bob.address })) === 0n);
    t.check("transferFrom above the allowance is refused", await t.doesRevert(() => t.send(bob, "WBWSC", "transferFrom", { from: alice.address, to: bob.address, amount: 1n }), "allowance"));

    const b0 = await t.balance(bob.address);
    const w = await t.send(bob, "WBWSC", "withdraw", { amount: units(5) });
    t.gas("withdraw", w);
    t.check("withdraw 5: bob's wBWSC is burned and 5 coins come back", (await t.read("WBWSC", "balanceOf", { who: bob.address })) === 0n && (await t.balance(bob.address)) - b0 === units(5) - feeOf(w));
    t.check("withdrawing more than you have is refused", await t.doesRevert(() => t.send(bob, "WBWSC", "withdraw", { amount: 1n }), "less wBWSC"));
    t.check("still fully backed: supply = coins held", await backed());

    v = await view(alice.address);
    t.check("getView: your wBWSC and your coins in one read", v.balance === units(5) && v.nativeBalance > 0n && v.address === W);
}
