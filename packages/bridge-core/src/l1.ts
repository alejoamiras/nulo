/**
 * L1 side of the bridge: build the Permit2 witness-bound `bridgeWithFuel` /
 * `bridge` calls for SwapBridgeRouter (viem). The witness + route hashing here
 * MUST match the Solidity router's `_hashBridgeWitness` / `_hashRoute`
 * byte-for-byte — a mismatch makes the Permit2 signature invalid and the bridge
 * reverts. Pinned by l1.test.ts against the on-chain typehash.
 */
import { type Address, type Hex, encodeAbiParameters, keccak256, toHex } from "viem"

/** Mirrors SwapBridgeRouter.BRIDGE_WITNESS_TYPEHASH. */
export const BRIDGE_WITNESS_TYPE =
	"BridgeWitness(address tokenPortal,address bridgeToken,uint256 totalAmount,uint256 fuelAmount,bytes32 aztecRecipient,bytes32 fuelRecipient,bytes32 tokenSecretHash,bytes32 fuelSecretHash,uint256 minFuelOutput,bytes32 routeHash,bool isPrivate)"

export const BRIDGE_WITNESS_TYPEHASH = keccak256(toHex(BRIDGE_WITNESS_TYPE))

/** A V4 pool hop, matching SwapBridgeRouter.IUniswapFuelSwap.PoolKey. */
export interface PoolKey {
	currency0: Address
	currency1: Address
	fee: number
	tickSpacing: number
	hooks: Address
}

export interface BridgeWitness {
	tokenPortal: Address
	bridgeToken: Address
	totalAmount: bigint
	fuelAmount: bigint
	aztecRecipient: Hex // bytes32 (L2 address)
	fuelRecipient: Hex // bytes32 (L2 address / FPC)
	tokenSecretHash: Hex // bytes32
	fuelSecretHash: Hex // bytes32
	minFuelOutput: bigint
	routeHash: Hex // bytes32
	isPrivate: boolean
}

/** keccak256(abi.encode(path, zeroForOnes)) — matches SwapBridgeRouter._hashRoute. */
export function hashRoute(path: PoolKey[], zeroForOnes: boolean[]): Hex {
	return keccak256(
		encodeAbiParameters(
			[
				{
					type: "tuple[]",
					components: [
						{ name: "currency0", type: "address" },
						{ name: "currency1", type: "address" },
						{ name: "fee", type: "uint24" },
						{ name: "tickSpacing", type: "int24" },
						{ name: "hooks", type: "address" },
					],
				},
				{ type: "bool[]" },
			],
			[path, zeroForOnes],
		),
	)
}

/** keccak256(abi.encode(TYPEHASH, ...fields)) — matches SwapBridgeRouter._hashBridgeWitness. */
export function hashBridgeWitness(w: BridgeWitness): Hex {
	return keccak256(
		encodeAbiParameters(
			[
				{ type: "bytes32" }, // typehash
				{ type: "address" }, // tokenPortal
				{ type: "address" }, // bridgeToken
				{ type: "uint256" }, // totalAmount
				{ type: "uint256" }, // fuelAmount
				{ type: "bytes32" }, // aztecRecipient
				{ type: "bytes32" }, // fuelRecipient
				{ type: "bytes32" }, // tokenSecretHash
				{ type: "bytes32" }, // fuelSecretHash
				{ type: "uint256" }, // minFuelOutput
				{ type: "bytes32" }, // routeHash
				{ type: "bool" }, // isPrivate
			],
			[
				BRIDGE_WITNESS_TYPEHASH,
				w.tokenPortal,
				w.bridgeToken,
				w.totalAmount,
				w.fuelAmount,
				w.aztecRecipient,
				w.fuelRecipient,
				w.tokenSecretHash,
				w.fuelSecretHash,
				w.minFuelOutput,
				w.routeHash,
				w.isPrivate,
			],
		),
	)
}
