// @vitest-environment node
/**
 * `AuthwitDiscoverer.discoverPrivateAuthwits` against a REAL `CallAuthorizationRequest`: real field
 * layout, real `fromFields` validation (poseidon2 args-hash + inner-hash), real
 * `collectOffchainEffects` walk, real outer message hash. Nothing under `@aztec/*` is mocked.
 *
 * Node environment on purpose: foundation's poseidon takes the sync `BarretenbergSync` branch when
 * `self` is defined (jsdom), and that branch fails with `BBApiException: std::bad_cast` under
 * vitest; without `self` it takes the async `Barretenberg` branch, which works. The jsdom sibling
 * (`authwit-discoverer.test.ts`) keeps the plumbing cases that need no hashing.
 */

import { describe, expect, test } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { FunctionSelector } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { computeVarArgsHash } from "@aztec/stdlib/hash"
import { CallAuthorizationRequest, computeAuthWitMessageHash, computeInnerAuthWitHash } from "@aztec/aztec.js/authorization"
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
 *  change in an `@aztec/*` bump reds this test instead of silently re-deriving itself. */
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
			// chainId 0 makes assertLiveChainIdentity a no-op; l1ChainId/rollupVersion match the node.
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
})
