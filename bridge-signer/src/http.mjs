/*
 * HTTP API of the bridge signer (no packages: node:http only).
 *
 *   GET /claim?from=bsc&to=bwsc&account=0x…&token=0x…   (from / to: "bwsc" or a chain key from settings/config.js)
 *                                                     → { from, to, account, sourceToken, token, total, signature, chainId, sourceChainId, bridge }
 *   GET /status                                       → { signer, hub, chains, relayer }
 *   GET /deliver?from=bsc&to=bwsc&account=0x…&token=0x…[&block=N]   the website, right after a transfer: deliver it now
 *                                                     (block = the deposit's block on the source chain) → { queued }
 *   GET /pending?account=0x…                          → deliveries still on their way for that account
 *
 * CORS: only the website (settings/config.js app.siteUrl) may call it from a browser. A small per-IP limit keeps the RPCs calm.
 * Behind a reverse proxy (nginx, a load balancer) set trustProxy so the limit counts the caller, not the proxy.
 */

import http from "node:http";

function createSignerServer(signer, { allowOrigin = "*", perMinute = 60, trustProxy = false, relayer = null } = {}) {
    const hits = new Map();
    // Old entries go away, so the map never grows without end
    const sweeper = setInterval(() => {
        const now = Date.now();
        for (const [ ip, list ] of hits) if (!list.some((t) => now - t < 60_000)) hits.delete(ip);
    }, 60_000);
    sweeper.unref?.();
    const limited = (ip) => {
        const now = Date.now();
        const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
        list.push(now);
        hits.set(ip, list);
        return list.length > perMinute;
    };
    const server = http.createServer(async (request, response) => {
        const origin = request.headers.origin ?? "";
        const allowed = allowOrigin === "*" || allowOrigin.split(",").map((o) => o.trim()).includes(origin);
        const headers = { "content-type": "application/json", "cache-control": "no-store", ...(allowed && origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}) };
        const send = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)); };
        if (request.method === "OPTIONS") return send(204, {});
        if (request.method !== "GET") return send(405, { error: "Use GET" });
        const forwarded = trustProxy ? String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
        const ip = forwarded || request.socket.remoteAddress || "";
        if (limited(ip)) return send(429, { error: "Too many requests, try again in a minute." });
        const url = new URL(request.url, "http://signer");
        try {
            if (url.pathname === "/status") return send(200, { ...(await signer.status()), relayer: relayer ? await relayer.status() : null });
            if (url.pathname === "/deliver") {
                if (!relayer) return send(404, { error: "Automatic delivery is off on this signer." });
                const q = Object.fromEntries(url.searchParams);
                const block = q.block !== undefined && /^\d+$/.test(q.block) ? Number(q.block) : null;
                const job = relayer.enqueue({ from: q.from, to: q.to, account: q.account, token: q.token, atBlock: block, source: "website" });
                relayer.tick().catch(() => {});
                return send(200, { queued: true, state: job.state });
            }
            if (url.pathname === "/pending") return send(200, { items: relayer ? relayer.pending(url.searchParams.get("account") ?? "") : [] });
            if (url.pathname === "/claim") {
                const q = Object.fromEntries(url.searchParams);
                return send(200, await signer.claim({ from: q.from, to: q.to, account: q.account, token: q.token }));
            }
            return send(404, { error: "Not found. Use /claim, /deliver, /pending or /status." });
        } catch (error) {
            const status = error.status ?? 502;
            if (status >= 500) console.error(error);
            return send(status, { error: status >= 500 && !error.status ? "The signer could not read the chains. Try again soon." : error.message });
        }
    });
    server.on("close", () => clearInterval(sweeper));
    return server;
}

export { createSignerServer };
