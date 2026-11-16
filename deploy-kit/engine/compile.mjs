/*
 * ENGINE (same in every project, do not edit).
 *
 * "Compiling" a BWSC program = checking it exactly the way the node will, before anything is sent:
 *   1. the program file as it is (deploy-kit/bwsc/<Name>.js, one function program() { … }) = the code the chain stores,
 *      the same text you paste into the explorer
 *   2. autoreview: the node's whitelist check (unknown names, regex, class, this, obj[key], …)
 *   3. a deploy on a throwaway in-memory VM: wrapper, size limit, syntax in the sandbox, exports
 * Then it writes
 *   deploy-kit/generated/build/<Name>.json   code + size + code hash (what the local test chain deploys)
 *
 *   npm run compile             once
 *   npm run compile:watch       again on every save
 * Programs: every deploy-kit/bwsc/<Name>.js (Token.js = the chain's standard token).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEV_DIR, ROOT, isMock } from "./node.mjs";

const PROGRAM_DIR = path.join(DEV_DIR, "bwsc");
const BUILD_DIR = path.join(DEV_DIR, "generated", "build");

class CompileError extends Error {
    isCompileError = true;
}

/**
 * The chain's own checks (loaded lazily: importing the VM starts its sandbox).
 * Without the chain package (mock mode) only the basic shape is checked, and every run says so.
 */
let chain = null;
async function chainTools() {
    if (chain) return chain;
    try {
        const [ vmModule, review, token ] = await Promise.all([
            import("programvm"),
            import("programvm/autoreview.js"),
            import("programvm/standards/token.js"),
        ]);
        chain = { ...vmModule, review: review.reviewProgram, exportedFunctions: token.exportedFunctions, isFull: true };
    } catch (error) {
        if (!isMock()) throw new CompileError(`The chain package (programvm) is not installed in deploy-kit/: ${error.message}. Run npm install in deploy-kit/, or use the mock node (--mock).`);
        chain = { ...basicTools(), isFull: false };
    }
    return chain;
}

/** Shape checks only (mock mode without the chain package): wrapper, last return, size, functions */
function basicTools() {
    const toOneLine = (code) => JSON.stringify(String(code)).slice(1, -1);
    const exportedFunctions = (code) => /return\s*\{([^}]*)\}\s*;?\s*\}\s*$/.exec(String(code))?.[1].split(",").map((n) => n.trim()).filter(Boolean) ?? [];
    return {
        toOneLine,
        exportedFunctions,
        keccak256Hex: (text) => `basic:${text.length}:${[ ...text ].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}`,
        DEFAULT_OPTIONS: { maxCodeSize: 64 * 1024 },
        review: (code) => {
            const issues = [];
            if (!/^\s*function\s+\w*\s*\(\s*\)\s*\{/.test(code)) issues.push({ line: 1, message: "must be one function program() { … }" });
            if (!exportedFunctions(code).length) issues.push({ line: code.split("\n").length, message: "the last line must be return { … }" });
            if (/^\s*(import|export)\s/m.test(code)) issues.push({ line: 1, message: "import / export are not allowed inside the program" });
            return { ok: issues.length === 0, issues };
        },
        VirtualMachine: null,
    };
}

/** Source of every program: [{ name, file, code }], read as plain text (exactly what you paste into the explorer) */
async function sources() {
    const files = fs.existsSync(PROGRAM_DIR) ? fs.readdirSync(PROGRAM_DIR).filter((f) => f.endsWith(".js")).sort() : [];
    return files.map((file) => {
        const code = fs.readFileSync(path.join(PROGRAM_DIR, file), "utf8").trim();
        if (!code.startsWith("function program()")) throw new CompileError(`deploy-kit/bwsc/${file} must start with function program() { (nothing before it, not even a comment).`);
        return { name: file.replace(/\.js$/, ""), file: `deploy-kit/bwsc/${file}`, code };
    });
}

/** Checks one program like the node does → { name, file, code, size, codeHash, functions, limit } */
async function check({ name, file, code }) {
    const { review, VirtualMachine, MemoryDB, toOneLine, keccak256Hex, exportedFunctions, DEFAULT_OPTIONS } = await chainTools();

    const reviewed = review(code);
    if (!reviewed.ok) {
        const lines = reviewed.issues.map((issue) => `  ${file} (program line ${issue.line}:${issue.column ?? 0}) ${issue.message}`);
        throw new CompileError(`${name} does not pass the node's code check:\n${lines.join("\n")}`);
    }

    const oneLine = toOneLine(code);
    const size = Buffer.byteLength(oneLine, "utf8");
    const limit = DEFAULT_OPTIONS.maxCodeSize;
    if (VirtualMachine) {
        const sender = "0x00000000000000000000000000000000000000c0";
        const vm = new VirtualMachine(new MemoryDB(), { deriveProgramAddress: true });
        const result = vm.deploy({ code, context: { sender, origin: sender } });
        if (result?.status !== "success") {
            throw new CompileError(`${name}: ${result?.error?.message ?? result?.message ?? JSON.stringify(result)}`);
        }
    } else {
        try { new Function(code); } catch (error) { throw new CompileError(`${name}: syntax error: ${error.message}`); }
    }

    return { name, file, code, size, limit, codeHash: keccak256Hex(oneLine), functions: exportedFunctions(code) };
}

/** Writes the build files the local test chain deploys */
function write(built, { isFull = true } = {}) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    // Shape-only checks (mock) never replace the real build
    for (const program of isFull ? built : []) {
        const { name, file, code, size, codeHash, functions } = program;
        fs.writeFileSync(path.join(BUILD_DIR, `${name}.json`), `${JSON.stringify({ name, file, size, codeHash, functions, code }, null, 2)}\n`);
    }
}

/**
 * Checks every program and (unless write: false) writes the build and website files.
 * @returns {Promise<Record<string, object>>} name → checked program
 */
async function compileAll({ write: shouldWrite = true, quiet = false } = {}) {
    const built = [];
    for (const source of await sources()) built.push(await check(source));
    if (shouldWrite) write(built, { isFull: (await chainTools()).isFull });
    if (!(await chainTools()).isFull) console.log("⚠ The chain package is not installed: programs got shape checks only (mock). npm run compile with the chain installed checks them with the node's own rules.");
    if (!quiet) {
        for (const p of built) {
            const left = p.limit - p.size;
            const warn = left < 4096 ? "  ⚠ less than 4 KB left" : "";
            console.log(`  ${p.name.padEnd(18)} ${String(p.size).padStart(6)} bytes  (${left.toLocaleString()} of ${p.limit.toLocaleString()} left)  ${p.functions.length} functions${warn}`);
        }
    }
    return Object.fromEntries(built.map((p) => [ p.name, p ]));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
    const run = async () => {
        try {
            await compileAll();
            console.log(`Checked${(await chainTools()).isFull ? " with the node's own rules (programvm)" : " (shape only, mock)"}.`);
            return true;
        } catch (error) {
            console.error(error.isCompileError ? `✖ ${error.message}` : error);
            return false;
        }
    };
    const ok = await run();
    if (process.argv.includes("--watch")) {
        console.log(`Watching ${path.relative(ROOT, PROGRAM_DIR)} …`);
        let timer;
        fs.watch(PROGRAM_DIR, () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    } else {
        process.exit(ok ? 0 : 1);
    }
}

export { compileAll, CompileError };
