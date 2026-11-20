/*
 * YOUR CODE (off-chain). Code blocks: a small JavaScript / JSON / shell highlighter and the block around it
 * (file name, language, line numbers, Copy). Used by the landing page and the docs.
 *
 * codeBlock({ code, file?, lang = "js", lines = true, glow = false }) → HTML
 */

import { escapeHtml } from "../../engine/ui/helpers";
import { icon } from "./icons";

const KEYWORDS = new Set("function return const let var if else for while of in new throw try catch finally typeof instanceof await async import export from default class extends break continue switch case do void delete yield".split(" "));
const LITERALS = new Set("true false null undefined".split(" "));
const VM_API = new Set("readDB writeDB deleteDB map runProgram cloneProgram transferNative setMetadata emit keccak256 ecrecover ThisAddress ThisBalance BalanceOf IsProgram MetadataOf BlockNumber ChainId BaseFee GasLeft".split(" "));

/** One token rule: its class and the pattern that starts at the current position */
const RULES = [
    [ "com", /^\/\/[^\n]*/ ],
    [ "com", /^\/\*[\s\S]*?\*\// ],
    [ "com", /^#[^\n]*/, "sh" ],
    [ "str", /^`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/ ],
    [ "str", /^"(?:\\.|[^"\\\n])*"/ ],
    [ "str", /^'(?:\\.|[^'\\\n])*'/ ],
    [ "num", /^(?:0x[0-9a-fA-F]+n?|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)/ ],
    [ "word", /^[A-Za-z_$][\w$]*/ ],
    [ "pun", /^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\.\.\.|[{}()[\];,.:?+\-*/%<>=!&|^~])/ ],
    [ "ws", /^\s+/ ],
];

/** Code → highlighted HTML (escaped) */
function highlight(code, lang = "js") {
    let rest = String(code);
    let out = "";
    let prev = "";
    while (rest.length) {
        let hit = null;
        for (const [ kind, re, only ] of RULES) {
            if (only && only !== lang) continue;
            if (kind === "com" && only === undefined && lang === "sh") continue;
            const m = re.exec(rest);
            if (m) { hit = [ kind, m[0] ]; break; }
        }
        if (!hit) hit = [ "txt", rest[0] ];
        let [ kind, text ] = hit;
        if (kind === "word") {
            const next = rest.slice(text.length).trimStart()[0];
            if (lang === "json") kind = LITERALS.has(text) ? "lit" : "txt";
            else if (lang === "sh") kind = prev === "" || prev === "\n" ? "fn" : "txt";
            else if (KEYWORDS.has(text)) kind = "kw";
            else if (LITERALS.has(text)) kind = "lit";
            else if (VM_API.has(text)) kind = "api";
            else if (next === "(") kind = "fn";
            else if (prev === ".") kind = "prop";
            else if (next === ":" ) kind = "key";
            else kind = "txt";
        }
        if (lang === "json" && kind === "str" && rest.slice(text.length).trimStart()[0] === ":") kind = "key";
        out += kind === "ws" || kind === "txt" ? escapeHtml(text) : `<span class="tok-${kind}">${escapeHtml(text)}</span>`;
        if (kind !== "ws") prev = text;
        else if (text.includes("\n")) prev = "\n";
        rest = rest.slice(text.length);
    }
    return out;
}

const LANG = { js: "JavaScript", json: "JSON", sh: "Terminal", csv: "CSV" };

/**
 * A code block: a header (file name, language, Copy) over numbered, highlighted lines.
 * glow = the animated light running along the edge (landing page).
 */
function codeBlock({ code, file = "", lang = "js", lines = true, glow = false }) {
    const text = String(code).replace(/^\n+|\s+$/g, "");
    const rows = highlight(text, lang).split("\n");
    const id = `code-${Math.abs([ ...text ].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`;
    const figure = /*html*/`
    <figure class="code-block" data-code>
        <figcaption class="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
            <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-400">${escapeHtml(file || LANG[lang] || lang)}</span>
            <span class="hidden text-[11px] uppercase tracking-[0.14em] text-zinc-600 sm:inline">${escapeHtml(LANG[lang] ?? lang)}</span>
            <button type="button" onclick="copyCode('${id}', this)" class="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Copy code">${icon("copy", "size-3.5")}<span>Copy</span></button>
        </figcaption>
        <pre class="overflow-x-auto py-3 text-[13px] leading-[1.7]"><code id="${id}" class="code-text grid min-w-max" data-raw="${escapeHtml(text)}">${rows.map((r, i) => `<span class="code-line">${lines ? `<span class="code-ln" aria-hidden="true">${i + 1}</span>` : ""}<span>${r || " "}</span></span>`).join("")}</code></pre>
    </figure>`;
    // The running edge light sits on a wrapper, so the light and its glow stay outside the block
    return glow ? `<div class="glow-edge rounded-2xl">${figure}</div>` : figure;
}

/** Copy (wired in ui/main.js): the raw code, not the line numbers */
async function copyCode(id, button) {
    const raw = document.getElementById(id)?.getAttribute("data-raw") ?? "";
    const label = button?.querySelector("span");
    try {
        await navigator.clipboard.writeText(raw);
        if (label) { label.textContent = "Copied"; setTimeout(() => { label.textContent = "Copy"; }, 1500); }
    } catch {
        if (label) label.textContent = "Select it";
    }
}

export { highlight, codeBlock, copyCode };
