/**
 * The decoder reads a call's wire fields with the registered artifact's ABI — real `encodeArguments`
 * in, real `decodeFromAbi` out — and names why a call stays undecoded instead of guessing.
 */

import { describe, expect, test } from "vitest"
import { type AbiType, type ContractArtifact, type FunctionAbi, FunctionType, encodeArguments } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { decodeCallForDisplay } from "./call-decoder"

const ADDRESS: AbiType = {
	kind: "struct",
	path: "aztec::protocol_types::address::aztec_address::AztecAddress",
	fields: [{ name: "inner", type: { kind: "field" } }],
}
const U128: AbiType = { kind: "integer", sign: "unsigned", width: 128 }
const fn = (name: string, params: { name: string; type: AbiType }[]): FunctionAbi => ({
	name,
	functionType: FunctionType.PRIVATE,
	isOnlySelf: false,
	isStatic: false,
	isInitializer: false,
	parameters: params.map((p) => ({ ...p, visibility: "private" as const })),
	returnTypes: [],
	errorTypes: {},
})
const claim = fn("claim_private", [
	{ name: "to", type: ADDRESS },
	{ name: "amount", type: U128 },
	{ name: "secret", type: { kind: "field" } },
	{ name: "shielded", type: { kind: "boolean" } },
	{ name: "limits", type: { kind: "array", length: 2, type: U128 } },
])
const artifact = { name: "BridgeHub", functions: [claim], nonDispatchPublicFunctions: [] } as unknown as ContractArtifact
const lookup = (known: Record<string, ContractArtifact>) => async (address: string) => known[address]

const TOKEN = `0x00${"c".repeat(62)}`
const TO = `0x00${"b".repeat(62)}`
const encoded = encodeArguments(claim, [AztecAddress.fromStringUnsafe(TO), 5_000_000n, 7n, true, [1n, 2n]]).map((f) => f.toString())

describe("decodeCallForDisplay", () => {
	test("names every parameter from the ABI and projects each value by its type", async () => {
		const result = await decodeCallForDisplay(lookup({ [TOKEN]: artifact }), { to: TOKEN, name: "claim_private", args: encoded })
		expect(result).toEqual({
			kind: "decoded",
			contract: "BridgeHub",
			fn: "claim_private",
			params: [
				{ name: "to", value: { kind: "address", value: TO } },
				{ name: "amount", value: { kind: "integer", value: "5000000" } },
				{ name: "secret", value: { kind: "field", value: `0x${"0".repeat(63)}7` } },
				{ name: "shielded", value: { kind: "boolean", value: true } },
				{
					name: "limits",
					value: {
						kind: "array",
						items: [
							{ kind: "integer", value: "1" },
							{ kind: "integer", value: "2" },
						],
						hidden: 0,
					},
				},
			],
		})
	})

	test("an unregistered contract, an unknown function and a wrong argument count each say why", async () => {
		expect(await decodeCallForDisplay(lookup({}), { to: TOKEN, name: "claim_private", args: encoded })).toEqual({
			kind: "undecoded",
			reason: "unknown-contract",
		})
		expect(await decodeCallForDisplay(lookup({ [TOKEN]: artifact }), { to: TOKEN, name: "steal", args: encoded })).toEqual({
			kind: "undecoded",
			reason: "unknown-function",
		})
		expect(
			await decodeCallForDisplay(lookup({ [TOKEN]: artifact }), { to: TOKEN, name: "claim_private", args: encoded.slice(1) }),
		).toEqual({ kind: "undecoded", reason: "arguments" })
	})

	test("a non-field argument or a failing artifact lookup never throws", async () => {
		expect(
			await decodeCallForDisplay(lookup({ [TOKEN]: artifact }), {
				to: TOKEN,
				name: "claim_private",
				args: [...encoded.slice(0, 5), "5"],
			}),
		).toEqual({ kind: "undecoded", reason: "arguments" })
		const failing = async () => {
			throw new Error("pxe down")
		}
		expect(await decodeCallForDisplay(failing, { to: TOKEN, name: "claim_private", args: encoded })).toEqual({
			kind: "undecoded",
			reason: "unknown-contract",
		})
	})

	test("a selector is the truth: a dApp-supplied name cannot pick a different function", async () => {
		const bySelector = await decodeCallForDisplay(lookup({ [TOKEN]: artifact }), {
			to: TOKEN,
			name: "claim_private",
			selector: "0x00000000",
			args: encoded,
		})
		expect(bySelector).toEqual({ kind: "undecoded", reason: "unknown-function" })
	})
})
