import { describe, expect, it } from "vitest"
import {
	BRIDGE_WITNESS_PERMIT_TYPES,
	BRIDGE_WITNESS_TYPE,
	type BridgeWitness,
	bridgeWitnessPermitTypedData,
	hashBridgeWitness,
	hashRoute,
	type PoolKey,
} from "./l1"

// Reference values from contracts/bridge/evm/test/WitnessHash.t.sol — the Solidity router's
// _hashRoute / _hashBridgeWitness for the SAME fixed inputs. If TS drifts from
// Solidity, the Permit2 witness signature won't verify and the bridge reverts.
// (The L1 analogue of the content-hash keystone.)
const ROUTE_HASH = "0x01441be25b5060664969cc7926ae553da9e9393d5f4f83ce732e294df7578340"
const WITNESS_HASH = "0xf910b94139aa6f65c9a6ffe6a9b4a03f07a28928fe9b82a15834c3056160313b"

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
			swapTarget: addr(0x9abc),
		}
		expect(hashBridgeWitness(w)).toBe(WITNESS_HASH)
	})
})

describe("l1 Permit2 witness typed-data", () => {
	it("BridgeWitness EIP-712 members match BRIDGE_WITNESS_TYPE (no drift)", () => {
		const inner = BRIDGE_WITNESS_TYPE.replace(/^BridgeWitness\(/, "").replace(/\)$/, "")
		const fromTypehash = inner.split(",").map((f) => {
			const [type, name] = f.trim().split(/\s+/)
			return { name, type }
		})
		expect(BRIDGE_WITNESS_PERMIT_TYPES.BridgeWitness).toEqual(fromTypehash)
	})

	it("bridgeWitnessPermitTypedData builds the Permit2 domain + message", () => {
		const witness: BridgeWitness = {
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
			swapTarget: addr(0x9abc),
		}
		const td = bridgeWitnessPermitTypedData(
			{ permitted: { token: addr(0x2222), amount: 1_000_000n }, spender: addr(0x99), nonce: 7n, deadline: 123n },
			witness,
			addr(0x22d3),
			31337,
		)
		expect(td.domain).toEqual({ name: "Permit2", chainId: 31337, verifyingContract: addr(0x22d3) })
		expect(td.primaryType).toBe("PermitWitnessTransferFrom")
		expect(td.message.witness).toBe(witness)
		expect(td.message.spender).toBe(addr(0x99))
	})
})
