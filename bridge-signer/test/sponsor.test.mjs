/*
 * The gas sponsor's rules (src/sponsor.mjs) and its HTTP route (src/http.mjs), against a stand-in node.
 * Run: node --test test/   (from bridge-signer/)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { keyWalletSigner, typedData } from "bwscbox";
import { createGasSponsor } from "../src/sponsor.mjs";
import { createSignerServer } from "../src/http.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEX = "0x49e79ee25dcd834fc4b32317604e702760992422";
const USDT = "0xf49205a9bdc40d66586e373b7f5ce4b3456c513d";
const OTHER = "0x93ade50b1d98ad2f8706e19cf5582411d8de62ca";
const CHAIN = 41234;
const BASE = 10_000_000_000_000n;      // 10,000 gwei
const one = 10n ** 18n;

const relayer = ethers.Wallet.createRandom();
const balances = new Map();
let clock = Date.parse("2026-11-26T05:00:00Z");
const fakeClient = () => ({
    genesis: async () => ({ chainId: CHAIN, baseFee: `${BASE}n` }),
    balance: async (a) => balances.get(String(a).toLowerCase()) ?? 0n,
});
const makeSponsor = (extra = {}) => createGasSponsor({ ethers, createClient: fakeClient, keyWalletSigner, typedData }, {
    key: relayer.privateKey, nodeUrl: "http://node", dex: DEX, coin: USDT, minIn: one, belowBalance: 5n * one,
    perWalletPerDay: 3, perDay: 300, now: () => clock, ...extra,
});

let nonce = 0;
const txOf = (user, over = {}) => ({
    action: "call", chainId: CHAIN, from: user.address.toLowerCase(), to: DEX, method: "swap",
    input: { path: [ USDT, ZERO ], amountIn: `${2n * one}n`, minOut: "1n", deadline: "9999999999n" },
    value: "0", nonce: nonce++, gasLimit: 500000, maxFeePerGas: String(BASE * 2n), maxPriorityFeePerGas: "0",
    signedOnChainId: 56, sponsor: relayer.address.toLowerCase(), ...over,
});
const signed = async (user, over) => {
    const tx = txOf(user, over);
    return { tx, signature: await keyWalletSigner(user).signTransaction(tx) };
};
const refused = async (sponsor, body, pattern) => {
    await assert.rejects(() => sponsor.sign(body), (e) => { assert.match(e.message, pattern); return true; });
};

test("pays for a USDT → BWSC swap of at least 1 USDT by a wallet below 5 BWSC", async () => {
    const sponsor = makeSponsor();
    const user = ethers.Wallet.createRandom();
    const body = await signed(user);
    const out = await sponsor.sign(body);
    assert.equal(out.kind, "swap");
    assert.equal(out.sponsor, relayer.address.toLowerCase());
    // The relayer's signature is over the same transaction, the way the node checks it
    const typed = typedData.walletTypedData(body.tx);
    const { EIP712Domain, ...types } = typed.types;
    assert.equal(ethers.verifyTypedData(typed.domain, types, typed.message, out.sponsorSignature).toLowerCase(), relayer.address.toLowerCase());
});

test("pays for the USDT approval for the exchange too", async () => {
    const sponsor = makeSponsor();
    const user = ethers.Wallet.createRandom();
    const out = await sponsor.sign(await signed(user, { to: USDT, method: "approve", input: { spender: DEX, amount: `${one}n` } }));
    assert.equal(out.kind, "approve");
});

test("refuses everything else", async () => {
    const sponsor = makeSponsor();
    const user = ethers.Wallet.createRandom();
    await refused(sponsor, await signed(user, { input: { path: [ USDT, ZERO ], amountIn: `${one - 1n}n`, minOut: "1n" } }), /below the sponsored minimum/);
    await refused(sponsor, await signed(user, { input: { path: [ OTHER, ZERO ], amountIn: `${2n * one}n`, minOut: "1n" } }), /direct swap/);
    await refused(sponsor, await signed(user, { input: { path: [ ZERO, USDT ], amountIn: `${2n * one}n`, minOut: "1n" } }), /direct swap/);
    await refused(sponsor, await signed(user, { input: { path: [ USDT, OTHER, ZERO ], amountIn: `${2n * one}n`, minOut: "1n" } }), /direct swap/);
    await refused(sponsor, await signed(user, { method: "swapExactOut" }), /can be sponsored/);
    await refused(sponsor, await signed(user, { input: { path: [ USDT, ZERO ], amountIn: `${2n * one}n`, minOut: "1n", to: OTHER } }), /pay the wallet that signs/);
    await refused(sponsor, await signed(user, { to: USDT, method: "transfer", input: { to: OTHER, amount: `${2n * one}n` } }), /can be sponsored/);
    await refused(sponsor, await signed(user, { to: USDT, method: "approve", input: { spender: OTHER, amount: `${2n * one}n` } }), /approval for the exchange/);
    await refused(sponsor, await signed(user, { value: "1" }), /cannot send coins/);
    await refused(sponsor, await signed(user, { maxPriorityFeePerGas: "1" }), /no tip/);
    await refused(sponsor, await signed(user, { maxFeePerGas: String(BASE * 4n) }), /fee cap/);
    await refused(sponsor, await signed(user, { gasLimit: 5_000_000 }), /gas limit/);
    await refused(sponsor, await signed(user, { sponsor: OTHER }), /as its sponsor/);
    await refused(sponsor, await signed(user, { chainId: 1 }), /Wrong chain/);
});

test("refuses a signature that is not the sender's (or a changed transaction)", async () => {
    const sponsor = makeSponsor();
    const user = ethers.Wallet.createRandom();
    const someoneElse = ethers.Wallet.createRandom();
    const body = await signed(user);
    await refused(sponsor, { tx: body.tx, signature: await keyWalletSigner(someoneElse).signTransaction(body.tx) }, /signature does not match/);
    await refused(sponsor, { tx: { ...body.tx, input: { ...body.tx.input, amountIn: `${3n * one}n` } }, signature: body.signature }, /signature does not match/);
    await refused(sponsor, { tx: body.tx }, /signature does not match/);
});

test("only for wallets below 5 BWSC", async () => {
    const sponsor = makeSponsor();
    const user = ethers.Wallet.createRandom();
    balances.set(user.address.toLowerCase(), 5n * one);
    await refused(sponsor, await signed(user), /enough BWSC/);
    balances.set(user.address.toLowerCase(), 5n * one - 1n);
    assert.equal((await sponsor.sign(await signed(user))).kind, "swap");
});

test("3 per wallet per UTC day, 300 in all, and a new day starts again", async () => {
    const sponsor = makeSponsor({ perDay: 5 });
    const a = ethers.Wallet.createRandom();
    for (let i = 0; i < 3; i++) await sponsor.sign(await signed(a));
    await refused(sponsor, await signed(a), /used its free swaps/);
    const b = ethers.Wallet.createRandom();
    await sponsor.sign(await signed(b));
    await sponsor.sign(await signed(b));
    await refused(sponsor, await signed(ethers.Wallet.createRandom()), /used up for today/);
    assert.equal(sponsor.info().usedToday, 5);
    clock += 24 * 3600 * 1000;
    assert.equal((await sponsor.sign(await signed(a))).kind, "swap");
    assert.equal(sponsor.info().usedToday, 1);
});

test("HTTP: GET /sponsor, POST /sponsor with CORS for the website", async () => {
    const sponsor = makeSponsor();
    const signer = { status: async () => ({}) };
    const server = createSignerServer(signer, { allowOrigin: "https://www.bluewolfchain.com", sponsor });
    await new Promise((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${server.address().port}/sponsor`;
    const origin = { origin: "https://www.bluewolfchain.com" };
    try {
        const info = await fetch(url, { headers: origin }).then((r) => r.json());
        assert.equal(info.sponsor, relayer.address.toLowerCase());
        assert.equal(info.minIn, String(one));
        const pre = await fetch(url, { method: "OPTIONS", headers: origin });
        assert.equal(pre.headers.get("access-control-allow-origin"), "https://www.bluewolfchain.com");
        assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
        assert.match(pre.headers.get("access-control-allow-headers") ?? "", /content-type/);
        const user = ethers.Wallet.createRandom();
        const ok = await fetch(url, { method: "POST", headers: { ...origin, "content-type": "application/json" }, body: JSON.stringify(await signed(user)) });
        assert.equal(ok.status, 200);
        assert.ok((await ok.json()).sponsorSignature.startsWith("0x"));
        const bad = await fetch(url, { method: "POST", headers: { ...origin, "content-type": "application/json" }, body: JSON.stringify(await signed(user, { value: "5" })) });
        assert.equal(bad.status, 400);
        assert.match((await bad.json()).error, /cannot send coins/);
        const notJson = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
        assert.equal(notJson.status, 400);
        const otherPost = await fetch(url.replace("/sponsor", "/claim"), { method: "POST" });
        assert.equal(otherPost.status, 405);
    } finally {
        server.close();
    }
});

test("HTTP: /sponsor is 404 when the sponsor is off", async () => {
    const server = createSignerServer({ status: async () => ({}) }, {});
    await new Promise((r) => server.listen(0, r));
    try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/sponsor`);
        assert.equal(r.status, 404);
    } finally {
        server.close();
    }
});
