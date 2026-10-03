// @vitest-environment node
/**
 * `AuthwitDiscoverer.discoverPrivateAuthwits` against a REAL `CallAuthorizationRequest`: real field
 * layout, real `fromFields` validation (poseidon2 args-hash + inner-hash), real
 * `collectOffchainEffects` walk, real outer message hash. No Aztec package is mocked.
 *
 * Node environment on purpose: foundation's poseidon takes the sync `BarretenbergSync` branch when
 * `self` is defined (jsdom), and that branch fails with `BBApiException: std::bad_cast` under
 * vitest; without `self` it takes the async `Barretenberg` branch, which works. The jsdom sibling
 * (`authwit-discoverer.test.ts`) keeps the plumbing cases that need no hashing.
 */

import { describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec-labs/stdlib/abi"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { computeVarArgsHash } from "@aztec-labs/stdlib/hash"
import { CallAuthorizationRequest, computeAuthWitMessageHash, computeInnerAuthWitHash } from "@aztec-labs/aztec.js/authorization"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AuthwitDiscoverer } from "./authwit-discoverer"
import type { Action } from "./spec"

function fakeLogger(): LoggerStore {
	const config: IConfig = { onUpdate: new EventHandler<ConfigProp>(), get: (() => false) as IConfig["get"] }
	return new LoggerStore(config)
}

/** Known answers recorded once with the same toolchain outside vitest (plain `bun`): a hashing
 *  change in an Aztec bump reds this test instead of silently re-deriving itself. */
const KAT = {
	selector: "0x52cf201f",
	innerHash: "0x0742b125e369e6a165a1d22abf9fb2b128e3251030bc8e09e360a709d586a975",
	messageHash: "0x2aa0c2a578e0cd0d89b717a0180c8210a239d100ad1ac9549891f745c5af5fc4",
}

const CHAIN = { l1ChainId: 31337, rollupVersion: 1 }

/** The preimage the Noir `CallAuthwit` macro emits: [selector, innerHash, onBehalfOf, msgSender,
 *  functionSelector, argsHash, ...args]. Built with the real hashes so `fromFields` validation passes. */
async function realAuthorizationFields() {
	const selector = await CallAuthorizationRequest.getSelector()
	const msgSender = AztecAddress.fromFieldUnsafe(new Fr(0x1234n))
	const onBehalfOf = AztecAddress.fromFieldUnsafe(new Fr(0xabcdn))
	const functionSelector = FunctionSelector.fromField(new Fr(0x11223344n))
	const args = [new Fr(7n), new Fr(9n)]
	const argsHash = await computeVarArgsHash(args)
	const innerHash = await computeInnerAuthWitHash([msgSender.toField(), functionSelector.toField(), argsHash])
	const fields = [selector.toField(), innerHash, onBehalfOf.toField(), msgSender.toField(), functionSelector.toField(), argsHash, ...args]
	return { fields, msgSender, functionSelector, args, innerHash }
}

/** A `PrivateExecutionResult` shaped as `collectOffchainEffects` walks it: the authorization on a
 *  nested call (so the consumer is that call's contract, not the entrypoint's), plus an unrelated
 *  effect that decodes as nothing and must be skipped. */
function executionResult(consumer: AztecAddress, authorization: Fr[]) {
	const call = (contractAddress: AztecAddress, offchainEffects: { data: Fr[] }[], nested: unknown[] = []) => ({
		offchainEffects,
		nestedExecutionResults: nested,
		publicInputs: { callContext: { contractAddress } },
	})
	const entrypoint = AztecAddress.fromFieldUnsafe(new Fr(0x9999n))
	return {
		entrypoint: call(entrypoint, [{ data: [new Fr(1n), new Fr(2n)] }], [call(consumer, [{ data: authorization }])]),
	}
}

describe("AuthwitDiscoverer.discoverPrivateAuthwits — a real CallAuthorizationRequest", () => {
	test("decodes the real preimage into the full record and the wire action, skipping non-authorization effects", async () => {
		const { fields, msgSender, functionSelector, args, innerHash } = await realAuthorizationFields()
		const consumer = AztecAddress.fromFieldUnsafe(new Fr(0x5555n))
		const account = AztecAddress.fromFieldUnsafe(new Fr(0xacc0n))
		const simulateTx = async () => ({ privateExecutionResult: executionResult(consumer, fields) })
		const ctx = {
			txRequest: {},
			node: { getNodeInfo: async () => CHAIN },
			pxe: { simulateTx },
			account: { address: account },
			// A local row (chainId 0) skips only the composite check; the exact l1ChainId still binds.
			network: { chainId: 0, ...CHAIN },
		}
		const disc = new AuthwitDiscoverer(fakeLogger())
		const op = { networkId: "net", accountAddress: account.toString(), actions: [] as Action[] }

		const result = await disc.discoverPrivateAuthwits(op, async () => ctx as never)

		const expectedHash = await computeAuthWitMessageHash(
			{ consumer, innerHash },
			{ chainId: new Fr(CHAIN.l1ChainId), version: new Fr(CHAIN.rollupVersion) },
		)
		expect(expectedHash.toString()).toBe(KAT.messageHash)
		expect(innerHash.toString()).toBe(KAT.innerHash)
		expect((await CallAuthorizationRequest.getSelector()).toString()).toBe(KAT.selector)

		expect(result.actions).toEqual([{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: KAT.messageHash } }])
		expect(result.discovered).toEqual([
			{
				consumer: consumer.toString(),
				caller: msgSender.toString(),
				selector: functionSelector.toString(),
				args: args.map((a) => a.toString()),
				innerHash: KAT.innerHash,
				messageHash: KAT.messageHash,
			},
		])
		expect(result.discovered[0]?.selector).toBe("0x11223344")
	})

	test("a tampered preimage (inner hash not matching its fields) is refused by validation and yields nothing", async () => {
		const { fields } = await realAuthorizationFields()
		const forged = [...fields]
		forged[1] = new Fr(0xdeadbeefn) // innerHash no longer matches [msgSender, selector, argsHash]
		const consumer = AztecAddress.fromFieldUnsafe(new Fr(0x5555n))
		const ctx = {
			txRequest: {},
			node: { getNodeInfo: async () => CHAIN },
			pxe: { simulateTx: async () => ({ privateExecutionResult: executionResult(consumer, forged) }) },
			account: { address: AztecAddress.fromFieldUnsafe(new Fr(0xacc0n)) },
			network: { chainId: 0, ...CHAIN },
		}
		const result = await new AuthwitDiscoverer(fakeLogger()).discoverPrivateAuthwits(
			{ networkId: "net", accountAddress: "0xacc0", actions: [] as Action[] },
			async () => ctx as never,
		)
		expect(result).toEqual({ actions: [], discovered: [] })
	})

	test("computeIntentMessageHash is the real outer hash over the real inner hash of the intent fields", async () => {
		const consumer = AztecAddress.fromFieldUnsafe(new Fr(0x5555n))
		const intent = [new Fr(7n), new Fr(9n)]
		const expected = await computeAuthWitMessageHash(
			{ consumer, innerHash: await computeInnerAuthWitHash(intent) },
			{ chainId: new Fr(CHAIN.l1ChainId), version: new Fr(CHAIN.rollupVersion) },
		)
		const viaIntent = await new AuthwitDiscoverer(fakeLogger()).computeIntentMessageHash(
			{ kind: "intent", consumer: consumer.toString(), intent: intent.map((f) => f.toString()) },
			CHAIN as never,
		)
		expect(viaIntent.toString()).toBe(expected.toString())
	})

	test("computeEncodedCallMessageHash overwrites every dApp-supplied execution field with the ABI's", async () => {
		const fn = {
			name: "transfer_in_public",
			functionType: FunctionType.PUBLIC,
			isStatic: false,
			parameters: [],
			returnType: { kind: "boolean" },
		}
		const to = AztecAddress.fromFieldUnsafe(new Fr(0x5555n)).toString()
		const instances = new Map([[to, { currentContractClassId: { toString: () => "0xc1a55" } }]])
		const artifacts = new Map([["0xc1a55", { functions: [fn], nonDispatchPublicFunctions: [] }]])
		// The name matches; the type, isStatic, returnType and the stale `returnTypes` all lie.
		const content = {
			kind: "encoded_call",
			caller: AztecAddress.fromFieldUnsafe(new Fr(0x1234n)).toString(),
			to,
			selector: (await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)).toString(),
			args: ["0x07"],
			name: fn.name,
			type: FunctionType.PRIVATE,
			isStatic: true,
			returnType: { kind: "field" },
			returnTypes: [{ kind: "field" }],
		}

		await new AuthwitDiscoverer(fakeLogger()).computeEncodedCallMessageHash(
			content as never,
			CHAIN as never,
			instances as never,
			artifacts as never,
		)

		expect(content).toMatchObject({ name: fn.name, type: fn.functionType, isStatic: fn.isStatic, returnType: fn.returnType })
	})
})

/** The rejection itself, so a message is compared whole: `toThrowError("text")` matches a substring. */
async function rejectionOf(run: Promise<unknown>): Promise<Error> {
	try {
		await run
	} catch (error) {
		return error as Error
	}
	throw new Error("expected a rejection")
}

/** The `ChainInfo` an authwit commits to, written out: `l1ChainId` then `rollupVersion`, never swapped. */
const CHAIN_INFO = { chainId: new Fr(CHAIN.l1ChainId), version: new Fr(CHAIN.rollupVersion) }
/** The stored row for a non-local network whose composite matches `CHAIN`. */
const NON_LOCAL = { chainId: (CHAIN.l1ChainId ^ CHAIN.rollupVersion) >>> 0, l1ChainId: CHAIN.l1ChainId }

describe("AuthwitDiscoverer — the live chain binding", () => {
	function discover(nodeInfo: { l1ChainId: number; rollupVersion: number }, network: { chainId: number; l1ChainId: number }) {
		const consumer = AztecAddress.fromFieldUnsafe(new Fr(0x5555n))
		const simulateTx = vi.fn(async (..._args: unknown[]) => ({ privateExecutionResult: {} }))
		return {
			simulateTx,
			run: async () => {
				const { fields } = await realAuthorizationFields()
				simulateTx.mockResolvedValue({ privateExecutionResult: executionResult(consumer, fields) } as never)
				const ctx = {
					txRequest: {},
					node: { getNodeInfo: async () => nodeInfo },
					pxe: { simulateTx },
					account: { address: AztecAddress.fromFieldUnsafe(new Fr(0xacc0n)) },
					network,
				}
				return new AuthwitDiscoverer(fakeLogger()).discoverPrivateAuthwits(
					{ networkId: "net", accountAddress: "0xacc0", actions: [] as Action[] },
					async () => ctx as never,
				)
			},
		}
	}

	test("a non-local row whose composite matches the live pair hashes over that pair", async () => {
		const result = await discover(CHAIN, NON_LOCAL).run()
		expect(result.actions).toEqual([{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: KAT.messageHash } }])
	})

	test("a drifted rollup version is refused after the discovery simulation, before any hash", async () => {
		const { run, simulateTx } = discover({ l1ChainId: CHAIN.l1ChainId, rollupVersion: 2 }, NON_LOCAL)
		const refused = await rejectionOf(run())
		expect(refused.constructor).toBe(Error)
		expect(refused.message).toBe(
			"Chain identity mismatch: selected network has chainId=31336 but live node reports composite=31339 (l1ChainId=31337, rollupVersion=2). Refusing to sign/prove against a drifted endpoint.",
		)
		expect(simulateTx).toHaveBeenCalledTimes(1)
	})
})

describe("AuthwitDiscoverer — call and encoded-call hashes and the selector binding", () => {
	const fn = {
		name: "transfer_in_public",
		functionType: FunctionType.PUBLIC,
		isStatic: false,
		parameters: [],
		returnType: { kind: "boolean" },
	}
	const to = AztecAddress.fromFieldUnsafe(new Fr(0x5555n)).toString()
	const caller = AztecAddress.fromFieldUnsafe(new Fr(0x1234n)).toString()
	const instances = new Map([[to, { currentContractClassId: { toString: () => "0xc1a55" } }]])
	const artifacts = new Map([["0xc1a55", { functions: [fn], nonDispatchPublicFunctions: [] }]])
	const selectorOf = async () => (await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)).toString()
	const expectedHash = async () =>
		computeAuthWitMessageHash(
			{
				caller: AztecAddress.fromStringUnsafe(caller),
				call: new FunctionCall(
					fn.name,
					AztecAddress.fromStringUnsafe(to),
					FunctionSelector.fromString(await selectorOf()),
					fn.functionType,
					false,
					fn.isStatic,
					[],
					fn.returnType as never,
				),
			},
			CHAIN_INFO,
		)
	const encoded = (content: Record<string, unknown>) =>
		new AuthwitDiscoverer(fakeLogger()).computeEncodedCallMessageHash(
			content as never,
			CHAIN as never,
			instances as never,
			artifacts as never,
		)

	test("a call-kind hash commits to the l1ChainId and rollupVersion it was given", async () => {
		const hash = await new AuthwitDiscoverer(fakeLogger()).computeCallMessageHash(
			{ kind: "call", caller, contract: to, method: fn.name, args: [] },
			CHAIN as never,
			instances as never,
			artifacts as never,
		)
		expect(hash.toString()).toBe((await expectedHash()).toString())
	})

	test("an encoded-call hash with a matching or absent name commits to the same pair", async () => {
		const selector = await selectorOf()
		const expected = (await expectedHash()).toString()
		expect((await encoded({ kind: "encoded_call", caller, to, selector, args: [], name: fn.name })).toString()).toBe(expected)
		expect((await encoded({ kind: "encoded_call", caller, to, selector, args: [] })).toString()).toBe(expected)
	})

	test("an unknown selector, a wrong name and an empty name are refused before the content is rewritten", async () => {
		const selector = await selectorOf()
		const unknown = await rejectionOf(encoded({ kind: "encoded_call", caller, to, selector: "0x0badc0de", args: [], type: "lie" }))
		expect(unknown.constructor).toBe(Error)
		expect(unknown.message).toBe("Method not found")
		for (const name of ["sneaky", ""]) {
			const content = { kind: "encoded_call", caller, to, selector, args: [], name, type: "lie" }
			const refused = await rejectionOf(encoded(content))
			expect(refused.constructor).toBe(Error)
			expect(refused.message).toBe(
				`Scope violation: authwit call name "${name}" does not match selector's function "${fn.name}" on ${to}`,
			)
			expect(content.type).toBe("lie")
		}
	})
})
