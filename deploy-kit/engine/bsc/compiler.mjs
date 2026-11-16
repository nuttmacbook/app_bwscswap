/*
 * ENGINE (same in every project, do not edit).
 *
 * Solidity build for the BSC side: every .sol in deploy-kit/bsc (the files you deploy in Remix) and
 * deploy-kit/engine/contracts (MockToken, test chain only) with the pinned solc 0.8.37, optimizer on, 200 runs.
 * Writes deploy-kit/generated/bsc-build/<Name>.json (what the local test BSC deploys) and checks that the website's
 * ABI files (src/project/chain/abi/) still match the contracts.
 *
 * Compiler: the "solc" package in deploy-kit/ (npm install), or a native solc 0.8.37 at SOLC_BIN / on PATH.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DEV_DIR, ROOT } from "../node.mjs";

const SOLC_VERSION = "0.8.37";
const SRC_DIR = path.join(DEV_DIR, "bsc");
const ENGINE_SRC_DIR = path.join(DEV_DIR, "engine", "contracts");
const ENGINE_PREFIX = "engine/";
const BUILD_DIR = path.join(DEV_DIR, "generated", "bsc-build");
// The website's ABI files and the contract each one must match
const APP_ABIS = [
    { file: "src/project/chain/abi/evmBridge.js", name: "BRIDGE_EVM_ABI", contract: "BwscBridgeEvm" },
    { file: "src/project/chain/abi/erc20.js", name: "ERC20_ABI", contract: "MockToken" },
];
const SIZE_LIMIT = 24_576;

const SETTINGS = {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": [ "abi", "evm.bytecode.object", "evm.deployedBytecode.object" ] } },
};

const listDir = (base, prefix = "", dir = base) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listDir(base, prefix, full);
    return entry.name.endsWith(".sol") ? [ prefix + path.relative(base, full).split(path.sep).join("/") ] : [];
});
const sourcePath = (key) => (key.startsWith(ENGINE_PREFIX) ? path.join(ENGINE_SRC_DIR, key.slice(ENGINE_PREFIX.length)) : path.join(SRC_DIR, key));

/** solc as a function (standard JSON in → standard JSON out) and its version */
async function findSolc() {
    try {
        const solc = (await import("solc")).default;
        const version = solc.version().split("+")[0];
        if (version !== SOLC_VERSION) throw new Error(`solc package is ${version}, need ${SOLC_VERSION}`);
        return { version, run: (input) => solc.compile(input) };
    } catch (packageError) {
        for (const bin of [ process.env.SOLC_BIN, "solc" ].filter(Boolean)) {
            try {
                const text = execFileSync(bin, [ "--version" ], { encoding: "utf8" });
                if (!text.includes(SOLC_VERSION)) continue;
                return { version: SOLC_VERSION, run: (input) => execFileSync(bin, [ "--standard-json" ], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) };
            } catch { /* next */ }
        }
        throw new Error(`No solc ${SOLC_VERSION}: run npm install in deploy-kit/ (package "solc"), or set SOLC_BIN to a solc ${SOLC_VERSION} binary. (${packageError.message})`);
    }
}

/**
 * @returns {Promise<{ solcVersion, contracts: Record<string, { abi, bytecode, deployedBytecode, source, size }> }>}
 */
async function compileContracts({ write = true, quiet = false } = {}) {
    const files = [ ...listDir(SRC_DIR), ...listDir(ENGINE_SRC_DIR, ENGINE_PREFIX) ];
    if (!files.length) return { solcVersion: SOLC_VERSION, contracts: {} };
    const solc = await findSolc();
    const input = { language: "Solidity", sources: Object.fromEntries(files.map((f) => [ f, { content: fs.readFileSync(sourcePath(f), "utf8") } ])), settings: SETTINGS };
    const output = JSON.parse(solc.run(JSON.stringify(input)));
    const messages = output.errors ?? [];
    const errors = messages.filter((m) => m.severity === "error");
    if (errors.length) {
        const error = new Error(errors.map((e) => e.formattedMessage).join("\n"));
        error.isCompileError = true;
        throw error;
    }
    const contracts = {};
    for (const [ source, byName ] of Object.entries(output.contracts ?? {})) {
        for (const [ name, c ] of Object.entries(byName)) {
            if (!c.evm.bytecode.object) continue;   // interfaces and abstract layers
            contracts[name] = { source, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, deployedBytecode: `0x${c.evm.deployedBytecode.object}`, size: c.evm.deployedBytecode.object.length / 2 };
        }
    }
    if (write) {
        fs.rmSync(BUILD_DIR, { recursive: true, force: true });
        fs.mkdirSync(BUILD_DIR, { recursive: true });
        for (const [ name, c ] of Object.entries(contracts)) fs.writeFileSync(path.join(BUILD_DIR, `${name}.json`), JSON.stringify({ contractName: name, solc: solc.version, ...c }, null, 4));
    }
    await checkAppAbis(contracts);
    if (!quiet) {
        messages.filter((m) => m.severity !== "error").forEach((w) => console.warn(w.formattedMessage.trim()));
        for (const [ name, c ] of Object.entries(contracts)) {
            if (!c.source.startsWith(ENGINE_PREFIX) && c.size > 100) console.log(`  ${name.padEnd(18)} ${String(c.size).padStart(6)} bytes  (${(SIZE_LIMIT - c.size).toLocaleString()} of ${SIZE_LIMIT.toLocaleString()} left)`);
        }
    }
    for (const [ name, c ] of Object.entries(contracts)) {
        if (c.size > SIZE_LIMIT && !c.source.startsWith(ENGINE_PREFIX)) throw new Error(`${name} is ${c.size} bytes, over the ${SIZE_LIMIT} limit.`);
    }
    return { solcVersion: solc.version, contracts };
}

/** Every function and event in the website's ABI files must exist in the contract exactly like that */
async function checkAppAbis(contracts) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const { file, name, contract } of APP_ABIS) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;   // the website was moved away: nothing to compare
        const abi = (await import(pathToFileURL(full).href))[name] ?? [];
        const compiled = contracts[contract]?.abi ?? [];
        const wrong = abi.filter((item) => !compiled.some((c) => c.type === item.type && c.name === item.name && same(c, item)));
        if (wrong.length) {
            const error = new Error(`${file} no longer matches ${contract}: ${wrong.map((w) => w.name ?? w.type).join(", ")}. Copy those entries from deploy-kit/generated/bsc-build/${contract}.json.`);
            error.isCompileError = true;
            throw error;
        }
    }
}

export { compileContracts, SOLC_VERSION };

// npm run compile:bsc
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
    compileContracts().then(() => console.log("BSC contracts compiled: deploy-kit/generated/bsc-build (website ABI files match).")).catch((error) => {
        console.error(error.isCompileError ? `✖ ${error.message}` : error);
        process.exit(1);
    });
}
