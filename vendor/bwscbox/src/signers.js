/*
 * A signer is { address, signTransaction(tx) → "0x…" signature }. Two kinds:
 *   walletSigner(provider, address)  a browser wallet (EIP-1193, e.g. MetaMask) signs with eth_signTypedData_v4
 *   keyWalletSigner(wallet)          anything with ethers' signTypedData(domain, types, message), e.g. new ethers.Wallet(key)
 *                                    (scripts, tests and the local demo wallet; never a real key in a web page)
 */

import { walletTypedData } from "./typedData.js";

/** Signer for an EIP-1193 provider. `address` left out = ask for accounts and use the first one */
export async function walletSigner(provider, address) {
    const account = String(address ?? (await provider.request({ method: "eth_requestAccounts" }))?.[0] ?? "").toLowerCase();
    if (!account) throw new Error("The wallet did not share an account.");
    return {
        address: account,
        signTransaction: (tx) => provider.request({ method: "eth_signTypedData_v4", params: [ account, JSON.stringify(walletTypedData(tx)) ] }),
        // The chain the wallet has open (any EVM chain can sign); client.send records it as the tx's signedOnChainId
        signingChainId: async () => Number(BigInt(await provider.request({ method: "eth_chainId" }))),
    };
}

/** Signer for an object with signTypedData(domain, types, message) (ethers Wallet / HDNodeWallet) */
export function keyWalletSigner(wallet) {
    const address = String(wallet?.address ?? "").toLowerCase();
    if (!address) throw new Error("keyWalletSigner needs a wallet with an address");
    return {
        address,
        signTransaction: async (tx) => {
            const typed = walletTypedData(tx);
            const { EIP712Domain, ...types } = typed.types;   // ethers builds the domain type itself and refuses a second one
            return wallet.signTypedData(typed.domain, types, typed.message);
        },
    };
}
