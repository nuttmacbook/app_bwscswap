/*
 * The bridge signer service: node src/main.mjs (or npm start).
 * Chains, node, bridge addresses: settings/config.js (the same file the website uses; CONFIG_FILE points elsewhere).
 * The secret: bridge-signer/.env (copy .env.example) — SIGNER_PRIVATE_KEY (+ RELAYER_PRIVATE_KEY), PORT, TRUST_PROXY.
 * Keep it on a server you control: whoever has SIGNER_PRIVATE_KEY can sign any total.
 * With bridgeSigner.autoDeliver (the default) it also runs the relayer (relayer.mjs): every transfer is delivered by
 * itself, users never press "claim". The relayer wallet pays that gas on every chain: keep it topped up.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ethers } from "ethers";
import { createClient } from "bwscbox";
import { createBridgeSigner } from "./signer.mjs";
import { createSignerServer } from "./http.mjs";
import { createRelayer } from "./relayer.mjs";
import { createGasSponsor } from "./sponsor.mjs";
import { keyWalletSigner, typedData } from "bwscbox";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(DIR, ".env");
if (!fs.existsSync(envFile)) {
    console.error("bridge-signer/.env is missing: copy .env.example to .env and fill it in.");
    process.exit(1);
}
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => [ l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim() ]));
for (const [ k, v ] of Object.entries(process.env)) if ([ "SIGNER_PRIVATE_KEY", "RELAYER_PRIVATE_KEY", "PORT", "TRUST_PROXY", "CONFIG_FILE", "ALLOW_ORIGINS", "STATE_FILE" ].includes(k) && v) env[k] = v;
const missing = [ "SIGNER_PRIVATE_KEY", "PORT" ].filter((k) => !env[k]);
if (missing.length) {
    console.error(`Set ${missing.join(", ")} in bridge-signer/.env.`);
    process.exit(1);
}

const configFile = path.resolve(DIR, env.CONFIG_FILE || "../settings/config.js");
if (!fs.existsSync(configFile)) {
    console.error(`${configFile} is missing: copy settings/config.js next to this folder, or set CONFIG_FILE in .env.`);
    process.exit(1);
}
const config = (await import(pathToFileURL(configFile).href)).default;
const chains = (config.chains ?? []).map((c) => ({ key: c.key, rpcUrl: c.rpcUrl, bridge: c.bridge, confirmations: c.confirmations }));
const unset = [
    !config.hub?.nodeUrl && "hub.nodeUrl",
    !config.programs?.bridge && "programs.bridge",
    ...chains.filter((c) => !c.bridge).map((c) => `chains (${c.key}).bridge`),
].filter(Boolean);
if (unset.length) {
    console.error(`Fill in ${unset.join(", ")} in ${path.relative(process.cwd(), configFile)}.`);
    process.exit(1);
}

const signer = createBridgeSigner({ ethers, createClient }, {
    key: env.SIGNER_PRIVATE_KEY,
    hub: { nodeUrl: config.hub.nodeUrl, bridge: config.programs.bridge },
    chains,
});
try {
    const s = await signer.status();
    console.log(`Bridge signer ${s.signer}: BWSC ${s.hub.chainId} ↔ ${s.chains.map((c) => `${c.key} ${c.chainId} (${c.confirmations} confirmations)`).join(", ")}`);
} catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
}
// Only the website may call it from a browser: its address in settings/config.js app.siteUrl, plus ALLOW_ORIGINS
// from .env (e.g. http://localhost:5173 while you run the website on your computer)
const origins = [ config.app?.siteUrl, ...String(env.ALLOW_ORIGINS ?? "").split(",") ].map((o) => String(o ?? "").trim().replace(/\/+$/, "")).filter(Boolean);
const allowOrigin = origins.join(",") || "*";

// Automatic delivery (settings/config.js bridgeSigner.autoDeliver, on unless false)
let relayer = null;
if (config.bridgeSigner?.autoDeliver !== false) {
    const drop = (key, decimals = 18) => {
        const amount = String(config.bridgeSigner?.gasDrop?.[key] ?? "0");
        try { return ethers.parseUnits(amount, decimals); } catch { console.error(`✖ bridgeSigner.gasDrop.${key} is ${JSON.stringify(amount)}, not an amount.`); process.exit(1); }
    };
    const hubKey = config.hub?.key ?? "bwsc";
    relayer = createRelayer({ ethers, createClient, keyWalletSigner }, {
        signer,
        key: env.RELAYER_PRIVATE_KEY || env.SIGNER_PRIVATE_KEY,
        hub: { key: hubKey, nodeUrl: config.hub.nodeUrl, bridge: config.programs.bridge, gasDrop: drop(hubKey, config.hub?.native?.decimals ?? 18) },
        chains: (config.chains ?? []).map((c) => ({ key: c.key, rpcUrl: c.rpcUrl, bridge: c.bridge, gasDrop: drop(c.key, c.native?.decimals ?? 18) })),
        stateFile: path.resolve(DIR, env.STATE_FILE || "relayer-state.json"),
    });
    const r = await relayer.start();
    console.log(`Relayer ${r.address} delivers every transfer. Gas money: ${Object.entries(r.balances).map(([ k, v ]) => `${k} ${v ?? "?"}`).join(", ")}`);
    console.log(`  Gas drop for empty wallets: ${Object.entries(r.gasDrop).map(([ k, v ]) => `${k} ${v}`).join(", ")}`);
} else {
    console.log("Automatic delivery is off (bridgeSigner.autoDeliver: false): users claim themselves.");
}
// Gas sponsor (settings/config.js bridgeSigner.gasSponsor): the relayer wallet pays the gas when a wallet that is
// (nearly) out of BWSC swaps USDT for BWSC
let sponsor = null;
const gs = config.bridgeSigner?.gasSponsor;
if (gs?.enabled) {
    if (!config.programs?.dex || !gs.coin) {
        console.error("✖ bridgeSigner.gasSponsor needs programs.dex and gasSponsor.coin.");
        process.exit(1);
    }
    const node = createClient({ node: config.hub.nodeUrl });
    const decimals = Number(await node.query({ program: String(gs.coin).toLowerCase(), method: "decimals" }).catch(() => 18n));
    const units = (value, d, name) => {
        try { return ethers.parseUnits(String(value), d); } catch { console.error(`✖ bridgeSigner.gasSponsor.${name} is ${JSON.stringify(value)}, not an amount.`); process.exit(1); }
    };
    sponsor = createGasSponsor({ ethers, createClient, keyWalletSigner, typedData }, {
        key: env.RELAYER_PRIVATE_KEY || env.SIGNER_PRIVATE_KEY,
        nodeUrl: config.hub.nodeUrl,
        dex: config.programs.dex,
        coin: gs.coin,
        minIn: units(gs.minIn ?? "1", decimals, "minIn"),
        belowBalance: units(gs.belowBalance ?? "5", config.hub?.native?.decimals ?? 18, "belowBalance"),
        perWalletPerDay: gs.perWalletPerDay,
        perDay: gs.perDay,
    });
    const i = sponsor.info();
    console.log(`Gas sponsor ${i.sponsor}: swaps of at least ${gs.minIn ?? "1"} of ${i.coin} for BWSC, wallets below ${gs.belowBalance ?? "5"} BWSC, ${i.perWalletPerDay}/wallet/day, ${i.perDay}/day`);
}
createSignerServer(signer, { allowOrigin, trustProxy: env.TRUST_PROXY === "true", relayer, sponsor }).listen(Number(env.PORT), () => console.log(`Listening on port ${env.PORT} (website: ${allowOrigin})`));
