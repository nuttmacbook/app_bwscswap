/*
 * YOUR CODE (on-chain, tests). BwscMultiSend: the native coin and tokens to many wallets in one transaction, all or
 * nothing, the exact total as value, nothing left in the program, every bad row refused before anything moves,
 * the 200-wallet limit (and that 200 fits in one block's gas), and the read the website makes.
 */

import { ethers } from "ethers";
import { utils } from "bwscbox";
import { deployToken } from "./tools.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text) => utils.toUnits(String(text), 18);
const gasOf = (receipt) => BigInt(String(receipt?.gasUsed ?? 0).replace(/n$/, ""));
const fresh = (n) => Array.from({ length: n }, () => ethers.Wallet.createRandom().address.toLowerCase());

export default async function (t) {
    const MULTI = t.deployed.addresses.BwscMultiSend;
    const USDT = t.deployed.addresses.USDT;
    const view = (account, token) => t.read("BwscMultiSend", "getView", { account, token });
    const send = (who, token, transfers, value = 0n, opts = {}) => t.send(who, "BwscMultiSend", "send", { token, transfers }, { value, ...opts });
    const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0n);
    const sender = t.newWallet();

    /* ------------------------------------ the native coin */

    const three = fresh(3).map((to, i) => ({ to, amount: units(i + 1) }));
    const before = await t.balance(sender.address);
    const r = await send(sender, ZERO, three, sum(three));
    const got = await Promise.all(three.map((x) => t.balance(x.to)));
    t.check("native: each wallet gets its amount (1, 2, 3)", got.every((g, i) => g === three.at(i).amount));
    t.check("native: the program returns the count and the total", r.result.count === 3n && r.result.total === units(6) && r.result.token === ZERO);
    t.check("native: the sender pays the total (+ gas), the program keeps nothing", before - (await t.balance(sender.address)) >= units(6) && (await t.balance(MULTI)) === 0n);
    t.check("native: value must be exactly the total (less refused)", await t.doesRevert(() => send(sender, ZERO, three, units(5)), "exactly the total"));
    t.check("native: value must be exactly the total (more refused)", await t.doesRevert(() => send(sender, ZERO, three, units(7)), "exactly the total"));
    const num = (x) => String(x).replace(/n$/, "");
    const events = (await t.client.get(`/program/${MULTI}/events?name=MultiSent&limit=10`))?.items ?? [];
    t.check("native: one MultiSent event with sender, coin, count and total", events.some((e) => String(e.data.sender).toLowerCase() === sender.address.toLowerCase() && e.data.token === ZERO && num(e.data.count) === "3" && num(e.data.total) === String(units(6))), JSON.stringify(events.at(0)?.data ?? null));

    /* ------------------------------------ a token */

    const GOLD = await deployToken(t, "GOLD");
    await t.send(t.owner, GOLD, "transfer", { to: sender.address, amount: units(1000) });
    const five = fresh(5).map((to, i) => ({ to, amount: units(10 * (i + 1)) }));
    t.check("token: without approval nothing is sent", await t.doesRevert(() => send(sender, GOLD, five)));
    await t.send(sender, GOLD, "approve", { spender: MULTI, amount: sum(five) });
    let v = await view(sender.address, GOLD);
    t.check("read: balance, allowance, decimals, symbol and the limit for the website", v.balance === units(1000) && v.allowance === units(150) && v.decimals === 18n && v.symbol === "GOLD" && v.maxTransfers === 200n && v.baseFee > 0n && v.gasBalance === (await t.balance(sender.address)));
    t.check("token: native value attached is refused", await t.doesRevert(() => send(sender, GOLD, five, 1n), "Do not attach"));
    await send(sender, GOLD, five);
    const gold = await Promise.all(five.map((x) => t.read(GOLD, "balanceOf", { who: x.to })));
    t.check("token: each wallet gets its amount straight from the sender", gold.every((g, i) => g === five.at(i).amount));
    v = await view(sender.address, GOLD);
    t.check("token: the sender's balance and allowance drop by the total; the program holds none", v.balance === units(850) && v.allowance === 0n && (await t.read(GOLD, "balanceOf", { who: MULTI })) === 0n);

    // The same wallet twice: both rows are paid
    const twice = fresh(1).at(0);
    await t.send(sender, GOLD, "approve", { spender: MULTI, amount: units(3) });
    await send(sender, GOLD, [ { to: twice, amount: units(1) }, { to: twice, amount: units(2) } ]);
    t.check("token: a wallet listed twice gets both amounts", (await t.read(GOLD, "balanceOf", { who: twice })) === units(3));

    // All or nothing: not enough for the last row → nobody gets anything
    const poor = t.newWallet();
    await t.send(t.owner, GOLD, "transfer", { to: poor.address, amount: units(5) });
    await t.send(poor, GOLD, "approve", { spender: MULTI, amount: units(100) });
    const two = fresh(2);
    t.check("all or nothing: one row short fails the whole transaction", await t.doesRevert(() => send(poor, GOLD, [ { to: two.at(0), amount: units(4) }, { to: two.at(1), amount: units(4) } ])));
    t.check("all or nothing: the first wallet got nothing, the sender still has all 5", (await t.read(GOLD, "balanceOf", { who: two.at(0) })) === 0n && (await t.read(GOLD, "balanceOf", { who: poor.address })) === units(5));

    /* ------------------------------------ bad lists */

    const one = fresh(1).at(0);
    t.check("an empty list is refused", await t.doesRevert(() => send(sender, ZERO, [], 0n), "at least one"));
    t.check("a row with amount 0 is refused (row number in the error)", await t.doesRevert(() => send(sender, ZERO, [ { to: one, amount: 1n }, { to: one, amount: 0n } ], 1n), "Row 2"));
    t.check("a row without a wallet address is refused", await t.doesRevert(() => send(sender, ZERO, [ { to: "0x1234", amount: 1n } ], 1n), "Row 1: to must be"));
    t.check("sending to 0x0…0 is refused", await t.doesRevert(() => send(sender, ZERO, [ { to: ZERO, amount: 1n } ], 1n), "Row 1"));
    t.check("a token that is not an address is refused", await t.doesRevert(() => send(sender, "USDT", [ { to: one, amount: 1n } ]), "token must be"));
    t.check("more than 200 rows is refused", await t.doesRevert(() => send(sender, ZERO, fresh(201).map((to) => ({ to, amount: 1n })), 201n), "At most 200"));

    /* ------------------------------------ 200 wallets fit in one transaction */

    const big = fresh(200).map((to) => ({ to, amount: units("0.01") }));
    const rn = await send(sender, ZERO, big, sum(big), { gasLimit: 4_900_000 });
    const nativeGas = gasOf(rn);
    t.check("200 wallets of the native coin in one transaction (under a block's 5M gas)", rn.result.count === 200n && (await t.balance(big.at(199).to)) === units("0.01") && nativeGas > 0n && nativeGas < 5_000_000n, `${nativeGas} gas`);
    await t.send(t.owner, USDT, "approve", { spender: MULTI, amount: units(200) });
    const bigT = fresh(200).map((to) => ({ to, amount: units(1) }));
    const rt = await send(t.owner, USDT, bigT, 0n, { gasLimit: 4_900_000 });
    const tokenGas = gasOf(rt);
    t.check("200 wallets of a token in one transaction (under a block's 5M gas)", rt.result.count === 200n && (await t.read(USDT, "balanceOf", { who: bigT.at(199).to })) === units(1) && tokenGas < 5_000_000n, `${tokenGas} gas`);
    t.gas("send 200 native", rn);
    t.gas("send 200 token", rt);
}
