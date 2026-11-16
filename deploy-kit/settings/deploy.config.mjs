/*
 * TEST CHAIN ONLY: what npm run dev and npm test deploy on the throwaway local chain, in order.
 * Your real chain is deployed by hand in the explorer (deploy-kit/README.md); nothing here touches it.
 * Values come from deploy-kit/settings/programs/<ProgramName>.env as ctx.settings.<ProgramName>.<KEY>.
 *
 * One entry per program:
 *   program({ name, build, init, readBack, check, upgradeable })   deploy-kit/bwsc/<build>.js (build defaults to name)
 *   token({ name })                                                Token.js, settings in deploy-kit/settings/programs/<name>.env
 * A program deployed later can use earlier ones: ctx.addresses.<name>.
 *
 * ctx = { owner, deployer, addresses, settings }
 * readBack(read, ctx): read(method, input) calls the live program without a transaction.
 */

import { utils } from "bwscbox";
import { program, token } from "../engine/deploy-steps.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";

export default {
    // Programs that must already run on the target chain before deploying (real tokens, partners): { label: address }
    requiredPrograms: () => ({}),

    programs: [
        // USDT on BWSC: the bridge pays it out for USDT locked on BSC (whole supply → deployer → bridge liquidity)
        token({ name: "USDT" }),

        // wBWSC: the native coin as a token (1 : 1), for the swap pool. No owner, no upgrader.
        program({
            name: "WBWSC",
            upgradeable: false,
            init: (ctx) => ({ name: ctx.settings.WBWSC.NAME, ticker: ctx.settings.WBWSC.TICKER, description: ctx.settings.WBWSC.DESCRIPTION }),
            readBack: async (read) => ({ ticker: await read("ticker"), decimals: await read("decimals"), totalSupply: await read("totalSupply") }),
            check: (state, ctx) => (state.ticker !== ctx.settings.WBWSC.TICKER ? `ticker is ${state.ticker}.` : state.decimals !== 18n ? "decimals must be 18." : state.totalSupply !== 0n ? "a new wBWSC must start empty." : true),
            asToken: (ctx) => ({ symbol: ctx.settings.WBWSC.TICKER, name: ctx.settings.WBWSC.NAME, decimals: 18, wrap: ctx.settings.WBWSC.LOCAL_WRAP }),
        }),

        // The exchange: every pair in one program; native pairs hold wBWSC. Pairs come from deploy-kit/settings/pairs/
        program({
            name: "BwscDex",
            init: (ctx) => {
                const s = ctx.settings.BwscDex;
                return { owner: ctx.owner, wrapped: ctx.addresses.WBWSC, defaultFeeBps: BigInt(s.FEE_BPS), openPairs: s.OPEN_PAIRS === "true", namespace: s.NAMESPACE, description: s.DESCRIPTION };
            },
            readBack: async (read) => {
                const view = await read("getView", { account: "", offset: 0n, limit: 1n });
                return { owner: view.owner, wrapped: view.wrapped, defaultFeeBps: view.defaultFeeBps, paused: view.paused };
            },
            check: (state, ctx) => {
                if (state.owner !== ctx.owner.toLowerCase()) return `owner is ${state.owner}, expected ${ctx.owner}.`;
                if (state.wrapped !== ctx.addresses.WBWSC) return "wrapped differs from the wBWSC address.";
                if (state.defaultFeeBps !== BigInt(ctx.settings.BwscDex.FEE_BPS)) return "default fee differs from FEE_BPS.";
                return state.paused ? "the exchange starts paused." : true;
            },
        }),

        // The bridge hub: routes to the local BSC (anvil). Pairs on BSC come from test-tokens.json (replaces PAIR_*)
        program({
            name: "BwscBridge",
            init: (ctx) => {
                const s = ctx.settings.BwscBridge;
                const units = (text) => utils.toUnits(String(text), 18);
                for (const key of [ "PAIR_NATIVE", "PAIR_USDT" ]) {
                    if (!utils.isAddress(s[key]) || /^0x0{39}1$/.test(s[key])) throw new Error(`BwscBridge.env: set ${key} to the coin's address on BSC.`);
                }
                const chainId = BigInt(s.BSC_CHAIN_ID);
                return {
                    owner: ctx.owner,
                    signer: s.SIGNER,
                    routes: [
                        { chainId, token: ZERO, remoteToken: s.PAIR_NATIVE, feeBps: BigInt(s.FEE_BPS_NATIVE), min: units(s.MIN_NATIVE) },
                        { chainId, token: ctx.addresses.USDT, remoteToken: s.PAIR_USDT, feeBps: BigInt(s.FEE_BPS_USDT), min: units(s.MIN_USDT) },
                    ],
                    namespace: s.NAMESPACE,
                    description: s.DESCRIPTION,
                };
            },
            readBack: async (read) => {
                const view = await read("getView", { account: "", offset: 0n, limit: 100n });
                return { owner: view.owner, signer: view.signer, paused: view.paused, routes: view.routes };
            },
            check: (state, ctx) => {
                const s = ctx.settings.BwscBridge;
                if (state.owner !== ctx.owner.toLowerCase()) return `owner is ${state.owner}, expected ${ctx.owner}.`;
                if (state.signer !== s.SIGNER.toLowerCase()) return `signer is ${state.signer}, SIGNER is ${s.SIGNER}.`;
                if (state.paused) return "the bridge starts paused.";
                const [ native, usdt ] = state.routes;
                if (native?.token !== ZERO || native.remoteToken !== s.PAIR_NATIVE.toLowerCase()) return "native route differs from PAIR_NATIVE.";
                if (usdt?.token !== ctx.addresses.USDT || usdt.remoteToken !== s.PAIR_USDT.toLowerCase()) return "USDT route differs from PAIR_USDT.";
                return true;
            },
        }),

        // Staking pools: the program starts empty; deploy-kit/project/services.mjs adds deploy-kit/settings/stake-pools/
        program({
            name: "BwscStaking",
            init: (ctx) => ({ owner: ctx.owner, namespace: ctx.settings.BwscStaking.NAMESPACE, description: ctx.settings.BwscStaking.DESCRIPTION }),
            readBack: async (read) => {
                const view = await read("getView", { account: "" });
                return { owner: view.owner, paused: view.paused };
            },
            check: (state, ctx) => (state.owner !== ctx.owner.toLowerCase() ? `owner is ${state.owner}, expected ${ctx.owner}.` : state.paused ? "staking starts paused." : true),
        }),

        // Limit orders: starts with the native coin, USDT and wBWSC listed (more: the owner's addCoin)
        program({
            name: "BwscLimit",
            init: (ctx) => {
                const s = ctx.settings.BwscLimit;
                const fee = BigInt(s.FEE_BPS);
                return { owner: ctx.owner, coins: [ { token: ZERO, feeBps: fee }, { token: ctx.addresses.USDT, feeBps: fee }, { token: ctx.addresses.WBWSC, feeBps: fee } ], namespace: s.NAMESPACE, description: s.DESCRIPTION };
            },
            readBack: async (read) => {
                const view = await read("getView", { account: "", offset: 0n, limit: 1n });
                return { owner: view.owner, paused: view.paused, coins: view.coins.length };
            },
            check: (state, ctx) => (state.owner !== ctx.owner.toLowerCase() ? `owner is ${state.owner}, expected ${ctx.owner}.` : state.paused ? "limit orders start paused." : state.coins !== 3 ? "the 3 first coins are not listed." : true),
        }),
    ],
};
