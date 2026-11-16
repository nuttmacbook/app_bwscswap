/*
 * ENGINE (same in every project, do not edit).
 *
 * npm test: runs every deploy-kit/project/test/*.test.mjs against the real node with the real programs.
 *   - every test file gets its own fresh in-memory chain, set up exactly like npm run dev (local-chain.mjs)
 *   - one file per program or feature keeps several programs easy to follow
 *
 *   npm test                        all files
 *   npm test -- --only BwscDex      files whose name contains "BwscDex"
 *   npm test -- --count 30          passed to the files as t.args.count
 *
 * A test file:
 *   export default async function (t) {
 *       const receipt = await t.send(t.owner, "BwscDex", "setDefaultFee", { feeBps: 50n });
 *       t.check("what it proves", condition, "optional detail");
 *       t.gas("setFeeBps", receipt);
 *   }
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileAll } from "./compile.mjs";
import { DEV_DIR, startNode, waitForNode, localClient, devSigner, personSigner } from "./node.mjs";
import { localSettings } from "./settings.mjs";
import { deployLocal } from "./local-chain.mjs";
import { startLocalBsc, deployBscLocal } from "./bsc/local.mjs";

const TEST_DIR = path.join(DEV_DIR, "project", "test");

const argv = process.argv.slice(2);
const argOf = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};

const local = localSettings();
const count = argOf("count") ? Number(argOf("count")) : Number(local.TEST_PEOPLE);
const results = [];
const gasUsed = {};

/** A fresh chain with everything deployed (and the local BSC when anvil is installed) */
async function freshChain(programs) {
    const bscLocal = await startLocalBsc({ port: Number(local.TEST_BSC_PORT), chainId: Number(local.LOCAL_BSC_CHAIN_ID) });
    const node = startNode({
        port: Number(local.TEST_PORT), chainId: Number(local.LOCAL_CHAIN_ID), blockMs: Number(local.TEST_BLOCK_MS), people: count + 5,
        balance: local.LOCAL_GENESIS_BALANCE, coinName: local.LOCAL_COIN_NAME, coinSymbol: local.LOCAL_COIN_SYMBOL,
        logFile: path.join(DEV_DIR, "generated", "node.log"),
    });
    try {
        await waitForNode(node.url);
        const client = localClient(node.url);
        const deployed = await deployLocal({ client, programs, overrides: bscLocal.overrides });
        const bsc = bscLocal.anvil ? { ...bscLocal, ...(await deployBscLocal(bscLocal, { bwsc: deployed.addresses })) } : null;
        return { node, client, deployed, bsc, stop: () => { node.stop(); bscLocal.anvil?.stop(); } };
    } catch (error) {
        node.stop();
        bscLocal.anvil?.stop();
        throw error;
    }
}

let exitCode = 0;
try {
    const programs = await compileAll({ write: false, quiet: true });
    const files = (fs.existsSync(TEST_DIR) ? fs.readdirSync(TEST_DIR) : [])
        .filter((f) => f.endsWith(".test.mjs") && (!argOf("only") || f.includes(argOf("only"))))
        .sort();
    console.log(`${Object.keys(programs).length} programs checked with the node's rules, ${files.length} test files\n`);

    for (const file of files) {
        const label = file.replace(/\.test\.mjs$/, "");
        console.log(`── ${label}`);
        const { client, deployed, bsc, stop } = await freshChain(programs);
        for (const [ key, g ] of Object.entries(deployed.gas)) {
            (gasUsed[`deploy ${key}`] ??= []).push(Number(g.deploy ?? 0));
            (gasUsed[`init ${key}`] ??= []).push(Number(g.init ?? 0));
        }
        let nextPerson = 0;

        const t = {
            client,
            deployed,
            programs,
            settings: deployed.settings,
            /** The local BSC (anvil) or null when Foundry is not installed:
             *  { anvil: { provider, wallet(i), url, chainId }, contracts, tokens, addresses, settings, owner, deployer } */
            bsc,
            local,
            owner: devSigner(0),
            stranger: devSigner(2),
            args: { count },

            /** Records one check; prints PASS or FAIL */
            check: (name, pass, detail = "") => {
                results.push({ file: label, name, pass: Boolean(pass) });
                console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
            },

            /** True when the call fails, and (if given) with a message containing this text */
            doesRevert: async (call, message = null) => {
                try {
                    await call();
                    return false;
                } catch (error) {
                    const text = `${error?.message ?? ""} ${JSON.stringify(error?.body ?? "")}`;
                    return message ? text.includes(message) : true;
                }
            },

            /** Adds a receipt's gas to the report under `name` */
            gas: (name, receipt) => {
                (gasUsed[name] ??= []).push(Number(receipt?.gasUsed ?? 0));
            },

            /** signer, program key (or address), function, input, { value } → receipt; throws the program's message */
            send: deployed.send,
            /** program key (or address), function, input, { from } → result */
            read: deployed.read,

            /** A new person with coins from the genesis (no transaction needed) */
            newWallet: () => {
                if (nextPerson >= count + 5) throw new Error("Out of funded people: raise TEST_PEOPLE or pass --count.");
                return personSigner(nextPerson++);
            },

            /** Native balance (wei) */
            balance: (address) => client.balance(address),

            /** Notes a part that could not run here (e.g. no anvil); not a failure */
            skip: (name, reason) => console.log(`SKIP  ${name}  (${reason})`),
        };

        try {
            const mod = await import(pathToFileURL(path.join(TEST_DIR, file)).href);
            await mod.default(t);
        } catch (error) {
            t.check(`${label} ran to the end`, false, error?.message ?? String(error));
        } finally {
            stop();
        }
        console.log("");
    }

    const names = Object.keys(gasUsed);
    if (names.length) {
        console.log("Gas");
        for (const name of names) {
            const list = [ ...gasUsed[name] ].sort((a, b) => a - b);
            console.log(`  ${name.padEnd(28)} median ${list[Math.floor(list.length / 2)].toLocaleString().padStart(9)}  max ${list.at(-1).toLocaleString().padStart(9)}  (${list.length} tx)`);
        }
        console.log("");
    }

    const failed = results.filter((r) => !r.pass);
    failed.forEach((r) => console.log(`FAILED  ${r.file}: ${r.name}`));
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    exitCode = failed.length || !results.length ? 1 : 0;
} catch (error) {
    console.error(error.isCompileError ? `✖ ${error.message}` : error);
    exitCode = 1;
}
process.exit(exitCode);
