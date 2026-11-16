// ABI of the bridge on other chains (deploy-kit/bsc/BwscBridgeEvm.sol), only the parts this website uses. npm run compile:bsc in deploy-kit/ checks that it still matches the contract.
export const BRIDGE_EVM_ABI = [
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "total",
                "type": "uint256"
            }
        ],
        "name": "BridgeIn",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "paid",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "total",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "by",
                "type": "address"
            }
        ],
        "name": "ClaimOut",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "bridgeIn",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "total",
                "type": "uint256"
            }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "total",
                "type": "uint256"
            },
            {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
            }
        ],
        "name": "claimOut",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "paid",
                "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "offset",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "limit",
                "type": "uint256"
            }
        ],
        "name": "getBridgeView",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "bridge",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "chainId",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "remoteChainId",
                        "type": "uint256"
                    },
                    {
                        "internalType": "address",
                        "name": "owner",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "signer",
                        "type": "address"
                    },
                    {
                        "internalType": "bool",
                        "name": "paused",
                        "type": "bool"
                    },
                    {
                        "internalType": "uint256",
                        "name": "maxFeeBps",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "routeCount",
                        "type": "uint256"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "address",
                                "name": "remoteToken",
                                "type": "address"
                            },
                            {
                                "internalType": "bool",
                                "name": "isNative",
                                "type": "bool"
                            },
                            {
                                "internalType": "string",
                                "name": "symbol",
                                "type": "string"
                            },
                            {
                                "internalType": "uint8",
                                "name": "decimals",
                                "type": "uint8"
                            },
                            {
                                "internalType": "bool",
                                "name": "enabled",
                                "type": "bool"
                            },
                            {
                                "internalType": "uint256",
                                "name": "feeBps",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "min",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "held",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "fees",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "available",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "actual",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "totalBridgedIn",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "totalClaimedOut",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "bridgedIn",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "claimedOut",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "balance",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "allowance",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct BwscBridgeEvm.RouteView[]",
                        "name": "routes",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct BwscBridgeEvm.BridgeView",
                "name": "v",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];
