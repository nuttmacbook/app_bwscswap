/*
 * ENGINE (same in every project, do not edit).
 *
 * Reads the settings files in deploy-kit/settings. Scripts have no fallback values of their own:
 * a missing value stops the script with a message naming the file and the line to add.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_DIR = path.join(DEV_DIR, "settings");

/** Parses KEY=value lines; # comments and blank lines are skipped */
const parseEnv = (text) => Object.fromEntries(String(text ?? "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
        const at = line.indexOf("=");
        return [ line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "") ];
    }));

/**
 * Reads one settings file and checks that every key in `required` has a value.
 * Environment variables of the same name win over the file (handy in CI).
 *
 * @param {string} file       name inside deploy-kit/settings, e.g. "local.env" or "programs/BwscDex.env"
 * @param {string[]} required keys that must not be empty
 * @param {object} options
 * @param {string} options.example  file to copy from when `file` is missing (secret files)
 * @returns {Record<string, string>}
 */
function readSettings(file, required = [], { example = null } = {}) {
    const full = path.join(SETTINGS_DIR, file);
    if (!fs.existsSync(full)) {
        const hint = example ? ` Copy deploy-kit/settings/${example} to deploy-kit/settings/${file} and fill it in.` : "";
        throw new SettingsError(`deploy-kit/settings/${file} is missing.${hint}`);
    }
    const values = parseEnv(fs.readFileSync(full, "utf8"));
    for (const key of Object.keys(values)) {
        if (process.env[key]) values[key] = process.env[key];
    }
    const missing = required.filter((key) => !values[key]);
    if (missing.length) {
        throw new SettingsError(`Set ${missing.join(", ")} in deploy-kit/settings/${file}.`);
    }
    return values;
}

/** Reads a JSON settings file (keys starting with "//" are comments) */
function readJsonSettings(file) {
    const full = path.join(SETTINGS_DIR, file);
    if (!fs.existsSync(full)) throw new SettingsError(`deploy-kit/settings/${file} is missing.`);
    return JSON.parse(fs.readFileSync(full, "utf8"));
}

class SettingsError extends Error {}

/* ------------------------------------ the settings files */

/**
 * Settings of every program: deploy-kit/settings/programs/<ProgramName>.env → { ProgramName: { KEY: value } }.
 * Every key listed in a file must have a value. A program without settings simply has no file.
 */
function allProgramSettings() {
    const dir = path.join(SETTINGS_DIR, "programs");
    if (!fs.existsSync(dir)) return {};
    return Object.fromEntries(fs.readdirSync(dir)
        .filter((file) => file.endsWith(".env"))
        .map((file) => {
            const values = parseEnv(fs.readFileSync(path.join(dir, file), "utf8"));
            return [ file.replace(/\.env$/, ""), readSettings(`programs/${file}`, Object.keys(values)) ];
        }));
}

const LOCAL_KEYS = [ "LOCAL_STAKE_REWARD", "LOCAL_STAKE_DAYS", "LOCAL_BSC_PORT", "TEST_BSC_PORT", "APP_TEST_BSC_PORT", "LOCAL_BSC_CHAIN_ID", "LOCAL_CHAIN2_PORT", "APP_TEST_CHAIN2_PORT", "LOCAL_CHAIN2_ID", "LOCAL_SIGNER_PORT", "APP_TEST_SIGNER_PORT", "LOCAL_PORT", "TEST_PORT", "LOCAL_CHAIN_ID", "LOCAL_BLOCK_MS", "TEST_BLOCK_MS", "LOCAL_COIN_NAME", "LOCAL_COIN_SYMBOL",
    "LOCAL_SEED", "LOCAL_RPC_LATENCY", "LOCAL_FUND_GAS", "LOCAL_FUND_AMOUNT", "LOCAL_GENESIS_BALANCE", "TEST_PEOPLE", "APP_TEST_PORT", "APP_TEST_SEED" ];
const localSettings = () => readSettings("local.env", LOCAL_KEYS);

/** Test tokens for the local chain: [ { symbol, name, decimals, supply, replaces: [ "Program.KEY" ] } ] (may be empty) */
function testTokens() {
    const list = readJsonSettings("test-tokens.json")?.tokens ?? [];
    for (const token of list) {
        if (!token?.symbol || !token?.name || !Number.isInteger(token?.decimals) || !token?.supply) {
            throw new SettingsError("Every entry in deploy-kit/settings/test-tokens.json needs symbol, name, decimals and supply (whole tokens).");
        }
    }
    return list;
}

export { SETTINGS_DIR, SettingsError, parseEnv, readSettings, readJsonSettings, allProgramSettings, localSettings, testTokens };
