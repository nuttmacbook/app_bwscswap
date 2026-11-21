/*
 * ENGINE (same in every project, do not edit).
 *
 * Deploy steps for the BSC side, on the local test BSC (anvil):
 *   proxied({ name, init })  logic, then BaseProxyUsed(logic, initialize(...)) in one transaction; admin → owner
 *   plain({ name, args })    a contract deployed as it is (no proxy); readBack / check work too
 * ctx = { owner, deployer, settings, addresses (BSC so far), bwsc (BWSC addresses) }
 */

import { ethers } from "ethers";

const proxied = ({ name, init, readBack, check, when }) => ({ kind: "proxied", key: name, build: name, init, readBack, check, when });
const plain = ({ name, key, args, readBack, check, when }) => ({ kind: "plain", key: key ?? name, build: name, args, readBack, check, when });

/** Deploys one step → { address, implementation?, txs } */
async function runBscStep(step, { wallet, contracts, ctx }) {
    const build = contracts[step.build];
    if (!build) throw new Error(`No contract named ${step.build} (deploy-kit/bsc).`);
    const factory = (c) => new ethers.ContractFactory(c.abi, c.bytecode, wallet);
    if (step.kind === "plain") {
        const contract = await factory(build).deploy(...(await step.args(ctx)));
        await contract.waitForDeployment();
        return { address: (await contract.getAddress()).toLowerCase(), txs: [ contract.deploymentTransaction()?.hash ] };
    }
    const logic = await factory(build).deploy();
    await logic.waitForDeployment();
    const logicAddress = await logic.getAddress();
    const data = new ethers.Interface(build.abi).encodeFunctionData("initialize", await step.init(ctx));
    const proxy = await factory(ctx.contracts.BaseProxyUsed).deploy(logicAddress, data);
    await proxy.waitForDeployment();
    const address = await proxy.getAddress();
    const txs = [ logic.deploymentTransaction()?.hash, proxy.deploymentTransaction()?.hash ];
    // The deployer is the proxy admin after the constructor; the owner becomes the admin too (one person)
    if (ctx.owner.toLowerCase() !== (await wallet.getAddress()).toLowerCase()) {
        const admin = new ethers.Contract(address, ctx.contracts.BaseProxyUsed.abi, wallet);
        const tx = await admin.transferAdmin(ctx.owner);
        await tx.wait();
        txs.push(tx.hash);
    }
    return { address: address.toLowerCase(), implementation: logicAddress.toLowerCase(), txs };
}

/** Reads a deployed contract back and runs the step's check → true or what is wrong */
async function verifyBscStep(step, address, { provider, contracts, ctx }) {
    if (!step.readBack) return true;
    const contract = new ethers.Contract(address, contracts[step.build].abi, provider);
    const state = await step.readBack(contract, ctx);
    return step.check ? step.check(state, ctx) : true;
}

export { proxied, plain, runBscStep, verifyBscStep };
