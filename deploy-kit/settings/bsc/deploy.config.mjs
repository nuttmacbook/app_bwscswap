/*
 * TEST CHAIN ONLY: what the local BSC (anvil, npm run dev / npm test) deploys, in order. On BSC itself you deploy
 * by hand in Remix (deploy-kit/README.md). Values come from deploy-kit/settings/bsc/<Contract>.env as ctx.settings.<Contract>.<KEY>.
 *
 *   plain({ name, args })     a contract without a proxy (the coin)
 *   proxied({ name, init })   behind BaseProxyUsed: initialize(...) runs in the proxy's constructor
 *   when: (ctx) => boolean    skip the step when false
 *
 * ctx = { owner, deployer, settings, addresses (BSC, so far), bwsc (BWSC addresses), contracts }
 */

import { ethers } from "ethers";
import { plain, proxied } from "../../engine/bsc/deploy.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const units = (text) => ethers.parseUnits(String(text), 18);

export default {
    steps: [
        // The BWSC coin on BSC, only when it is not there yet (NATIVE_TOKEN=deploy)
        plain({
            name: "BwscCoinBsc",
            when: (ctx) => ctx.settings.BwscBridgeEvm.NATIVE_TOKEN === "deploy",
            args: (ctx) => {
                const s = ctx.settings.BwscCoinBsc;
                return [ s.NAME, s.SYMBOL, units(s.SUPPLY), ctx.owner ];
            },
        }),

        proxied({
            name: "BwscBridgeEvm",
            init: (ctx) => {
                const s = ctx.settings.BwscBridgeEvm;
                const native = s.NATIVE_TOKEN === "deploy" ? ctx.addresses.BwscCoinBsc : s.NATIVE_TOKEN;
                if (!ethers.isAddress(native) || !ethers.isAddress(s.USDT_TOKEN)) throw new Error("BwscBridgeEvm.env: NATIVE_TOKEN and USDT_TOKEN must be addresses (or NATIVE_TOKEN=deploy).");
                if (!ctx.bwsc.USDT || !ctx.bwsc.BwscBridge) throw new Error("Deploy the BWSC side first: USDT and BwscBridge were not deployed on the local chain.");
                return [
                    ctx.owner,
                    s.SIGNER,
                    BigInt(s.REMOTE_CHAIN_ID),
                    [ native, s.USDT_TOKEN ],
                    [ ZERO, ctx.bwsc.USDT ],                    // remote: the BWSC native coin, USDT on BWSC
                    [ BigInt(s.FEE_BPS_NATIVE), BigInt(s.FEE_BPS_USDT) ],
                    [ units(s.MIN_NATIVE), units(s.MIN_USDT) ],
                ];
            },
            readBack: async (bridge) => ({ owner: await bridge.owner(), signer: await bridge.signer(), paused: await bridge.paused(), tokens: await bridge.tokenList(), remote: await bridge.remoteChainId() }),
            check: (state, ctx) => {
                const s = ctx.settings.BwscBridgeEvm;
                if (state.owner.toLowerCase() !== ctx.owner.toLowerCase()) return `owner is ${state.owner}, expected ${ctx.owner}.`;
                if (state.signer.toLowerCase() !== s.SIGNER.toLowerCase()) return `signer is ${state.signer}, SIGNER is ${s.SIGNER}.`;
                if (state.paused) return "the bridge starts paused.";
                if (state.tokens.length !== 2) return `${state.tokens.length} tokens, expected 2.`;
                return true;
            },
        }),
    ],
};
