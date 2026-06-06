import { describe, expect, it } from "vitest"
import { type BridgeWitness, hashBridgeWitness, hashRoute, type PoolKey } from "./l1"

// Reference values from bridge-evm/test/WitnessHash.t.sol — the Solidity router's
// _hashRoute / _hashBridgeWitness for the SAME fixed inputs. If TS drifts from
// Solidity, the Permit2 witness signature won't verify and the bridge reverts.
// (The L1 analogue of the content-hash keystone.)
const ROUTE_HASH = "0x01441be25b5060664969cc7926ae553da9e9393d5f4f83ce732e294df7578340"
const WITNESS_HASH = "0x6805573f2fe416a67bc9ae4c73dffe7ba578e322fda468d923c5f16be60209d2"

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`
const b32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`

describe("l1 witness/route hashing (pinned to the Solidity router)", () => {
	const path: PoolKey[] = [{ currency0: addr(0x05dc), currency1: addr(0x4e14), fee: 3000, tickSpacing: 60, hooks: addr(0) }]

	it("hashRoute matches SwapBridgeRouter._hashRoute", () => {
		expect(hashRoute(path, [true])).toBe(ROUTE_HASH)
	})

	it("hashBridgeWitness matches SwapBridgeRouter._hashBridgeWitness", () => {
		const w: BridgeWitness = {
			tokenPortal: addr(0x1111),
			bridgeToken: addr(0x2222),
			totalAmount: 1_000_000n,
			fuelAmount: 100_000n,
			aztecRecipient: b32(0x1234),
			fuelRecipient: b32(0x5678),
			tokenSecretHash: b32(0x5ec7),
			fuelSecretHash: b32(0xfee),
			minFuelOutput: 1_000_000_000_000_000_000n,
			routeHash: ROUTE_HASH,
			isPrivate: false,
		}
		expect(hashBridgeWitness(w)).toBe(WITNESS_HASH)
	})
})
