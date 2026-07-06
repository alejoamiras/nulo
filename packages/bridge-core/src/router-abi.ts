/**
 * Minimal SwapBridgeRouter ABI for browser callers (the faucet can't read forge artifacts at
 * runtime). Hand-written and PINNED against the forge artifact by router-abi.test.ts — any
 * drift between this const and the compiled router fails the suite.
 */
export const SWAP_BRIDGE_ROUTER_ABI = [
	{
		type: "function",
		name: "bridgeWithFuel",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "p",
				type: "tuple",
				components: [
					{ name: "tokenPortal", type: "address" },
					{ name: "bridgeToken", type: "address" },
					{ name: "totalAmount", type: "uint256" },
					{ name: "fuelAmount", type: "uint256" },
					{ name: "aztecRecipient", type: "bytes32" },
					{ name: "fuelRecipient", type: "bytes32" },
					{ name: "tokenSecretHash", type: "bytes32" },
					{ name: "fuelSecretHash", type: "bytes32" },
					{ name: "minFuelOutput", type: "uint256" },
					{
						name: "path",
						type: "tuple[]",
						components: [
							{ name: "currency0", type: "address" },
							{ name: "currency1", type: "address" },
							{ name: "fee", type: "uint24" },
							{ name: "tickSpacing", type: "int24" },
							{ name: "hooks", type: "address" },
						],
					},
					{ name: "zeroForOnes", type: "bool[]" },
					{ name: "isPrivate", type: "bool" },
				],
			},
			{
				name: "permit",
				type: "tuple",
				components: [
					{ name: "nonce", type: "uint256" },
					{ name: "deadline", type: "uint256" },
					{ name: "signature", type: "bytes" },
				],
			},
		],
		outputs: [],
	},
	{
		type: "event",
		name: "BridgeWithFuel",
		inputs: [
			{ name: "aztecRecipient", type: "bytes32", indexed: true },
			{ name: "tokenKey", type: "bytes32", indexed: false },
			{ name: "tokenIndex", type: "uint256", indexed: false },
			{ name: "tokenAmount", type: "uint256", indexed: false },
			{ name: "tokenSecretHash", type: "bytes32", indexed: false },
			{ name: "fuelKey", type: "bytes32", indexed: false },
			{ name: "fuelIndex", type: "uint256", indexed: false },
			{ name: "fuelAmount", type: "uint256", indexed: false },
			{ name: "fuelSecretHash", type: "bytes32", indexed: false },
			{ name: "isPrivate", type: "bool", indexed: false },
		],
	},
	// bridge-only + fuel-only (via tokenPortal = FeeJuicePortal) both go through this entrypoint.
	{
		type: "function",
		name: "bridge",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "p",
				type: "tuple",
				components: [
					{ name: "tokenPortal", type: "address" },
					{ name: "bridgeToken", type: "address" },
					{ name: "amount", type: "uint256" },
					{ name: "aztecRecipient", type: "bytes32" },
					{ name: "secretHash", type: "bytes32" },
					{ name: "isPrivate", type: "bool" },
				],
			},
			{
				name: "permit",
				type: "tuple",
				components: [
					{ name: "nonce", type: "uint256" },
					{ name: "deadline", type: "uint256" },
					{ name: "signature", type: "bytes" },
				],
			},
		],
		outputs: [],
	},
	{
		type: "event",
		name: "Bridge",
		inputs: [
			{ name: "aztecRecipient", type: "bytes32", indexed: true },
			{ name: "key", type: "bytes32", indexed: false },
			{ name: "index", type: "uint256", indexed: false },
			{ name: "amount", type: "uint256", indexed: false },
			{ name: "secretHash", type: "bytes32", indexed: false },
			{ name: "isPrivate", type: "bool", indexed: false },
		],
	},
] as const
