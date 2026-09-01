// @vitest-environment node
/**
 * Pre-extraction pins for `buildStandard` — its FIRST direct suite (the plan-3
 * decomposition moves the action switch + prelude; existing coverage is
 * indirect via the composition suites). Everything asserted here is frozen
 * contract: error strings, action → array filing ORDER, the ExecutionPayload
 * slot layout, the drift-assert-before-resolution ordering, cap-gate hash
 * order, and the result's provenance fields.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { encodeArguments, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { HashedValues } from "@aztec/stdlib/tx"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { getAuthRegistryAddress, getSetAuthorizedFn } from "@/wallet/utils/auth-registry"
import { TxRequestBuilder } from "./tx-request-builder"

const ACCOUNT_ADDR = AztecAddress.fromBigIntUnsafe(0xacc7n)
const CONTRACT = AztecAddress.fromBigIntUnsafe(0xc0den).toString()
// chainId must equal (l1ChainId ^ rollupVersion) >>> 0 for the drift assert.
const NODE_INFO = { l1ChainId: 0, rollupVersion: 31337, txsLimits: { gas: { daGas: 111n, l2Gas: 222n } } }
const NETWORK = { id: "net-1", chainId: 31337, name: "N", endpoints: [{ id: "e1", rpcUrl: "http://n:1" }], primaryEndpointId: "e1" }

/** A minimal private fn with zero parameters so encodeArguments is trivial. */
const FN = {
	name: "transfer",
	parameters: [],
	functionType: FunctionType.PRIVATE,
	isStatic: false,
	returnTypes: [],
}

type Harness = ReturnType<typeof makeHarness>
function makeHarness() {
	const calls: string[] = []
	const buildArgs: unknown[] = []
	const flags = { initializesAccount: false }
	const account = {
		address: ACCOUNT_ADDR,
		createAuthWit: vi.fn(async (h: Fr) => new AuthWitness(h, [Fr.fromString("0x77")])),
		buildTxExecutionRequest: vi.fn(async (...args: unknown[]) => {
			calls.push("buildTxExecutionRequest")
			buildArgs.push(args)
			const meta = args[6] as { initializesAccount?: boolean }
			meta.initializesAccount = flags.initializesAccount
			return { fake: "txRequest" }
		}),
	}
	const instance = { currentContractClassId: { toString: () => "0xclass1" } }
	const artifact = { functions: [FN], nonDispatchPublicFunctions: [] }
	const deps = {
		pxeService: { getPXE: vi.fn(() => ({ fake: "pxe" })) },
		profileService: { getActiveProfile: vi.fn(async () => ({ id: "p1", name: "P", type: "password" })) },
		networkService: {
			getNetwork: vi.fn(async () => {
				calls.push("getNetwork")
				return NETWORK
			}),
			getNode: vi.fn(async () => ({
				getNodeInfo: vi.fn(async () => {
					calls.push("getNodeInfo")
					return NODE_INFO
				}),
			})),
		},
		accountService: { getAccountContract: vi.fn(async () => account) },
		authRegistryService: {
			assertWithinCap: vi.fn(async () => {
				calls.push("assertWithinCap")
			}),
		},
		taskService: {
			startNewTask: vi.fn(() => ({ complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() })),
		},
		resolver: {
			extractContracts: vi.fn(() => [CONTRACT]),
			resolveInstances: vi.fn(async () => {
				calls.push("resolveInstances")
				return new Map([[CONTRACT, instance]])
			}),
			resolveArtifacts: vi.fn(async () => new Map([["0xclass1", artifact]])),
			ensureContractsRegistered: vi.fn(async () => undefined),
		},
		authwit: {
			computeCallMessageHash: vi.fn(async () => Fr.fromString("0xca11")),
			computeEncodedCallMessageHash: vi.fn(async () => Fr.fromString("0xe11c")),
			computeIntentMessageHash: vi.fn(async () => Fr.fromString("0x1447")),
		},
		logger: { log: vi.fn() },
	}
	const builder = new TxRequestBuilder(
		deps.pxeService as never,
		deps.profileService as never,
		deps.networkService as never,
		deps.accountService as never,
		deps.authRegistryService as never,
		deps.taskService as never,
		deps.resolver as never,
		deps.authwit as never,
		deps.logger as never,
	)
	return { builder, deps, account, calls, buildArgs, flags }
}

function build(h: Harness, actions: unknown[], gasSettings?: unknown) {
	return h.builder.buildStandard(
		{ networkId: "net-1", accountAddress: ACCOUNT_ADDR.toString(), actions: actions as never },
		{ fake: "feeMethod" } as never,
		undefined,
		gasSettings as never,
	)
}

let h: Harness
beforeEach(() => {
	h = makeHarness()
})

describe("buildStandard pins", () => {
	test("locked wallet throws the frozen string before anything else", async () => {
		h.deps.profileService.getActiveProfile.mockResolvedValueOnce(undefined as never)
		await expect(build(h, [])).rejects.toThrowError("Wallet locked")
		expect(h.deps.resolver.resolveInstances).not.toHaveBeenCalled()
	})

	test("drift assert runs BEFORE any resolver work, and a drifted node rejects", async () => {
		h.deps.networkService.getNode.mockResolvedValueOnce({
			getNodeInfo: vi.fn(async () => {
				h.calls.push("getNodeInfo")
				return { ...NODE_INFO, rollupVersion: 999 }
			}),
		} as never)
		await expect(build(h, [])).rejects.toThrowError(/Chain identity mismatch/)
		expect(h.deps.resolver.extractContracts).not.toHaveBeenCalled()
		expect(h.deps.resolver.resolveInstances).not.toHaveBeenCalled()
	})

	test("happy ordering: getNodeInfo precedes resolveInstances", async () => {
		await build(h, [])
		expect(h.calls.indexOf("getNodeInfo")).toBeLessThan(h.calls.indexOf("resolveInstances"))
	})

	test("capsule actions map contract/storageSlot/values, ORDER preserved across multiple", async () => {
		const result = await build(h, [
			{ kind: "add_capsule", contract: CONTRACT, storageSlot: "0x05", capsule: ["0x01", "0x02"] },
			{ kind: "add_capsule", contract: CONTRACT, storageSlot: "0x09", capsule: ["0x03"] },
		])
		const payload = (h.buildArgs[0] as unknown[])[2] as {
			capsules: Array<{ contractAddress: { toString(): string }; storageSlot: Fr; data: Fr[] }>
		}
		expect(payload.capsules).toHaveLength(2)
		expect(payload.capsules[0].contractAddress.toString()).toBe(CONTRACT)
		expect(payload.capsules[0].storageSlot.toString()).toBe(new Fr(5n).toString())
		expect(payload.capsules[0].data.map((f) => f.toBigInt())).toEqual([1n, 2n])
		expect(payload.capsules[1].storageSlot.toString()).toBe(new Fr(9n).toString())
		expect(payload.capsules[1].data.map((f) => f.toBigInt())).toEqual([3n])
		expect(result.pendingPublicAuthwits).toEqual([])
	})

	test("extra-args action hashes through HashedValues.fromArgs, slot 4 of the payload", async () => {
		await build(h, [{ kind: "add_extra_args", args: ["0x01", "0x02"] }])
		const payload = (h.buildArgs[0] as unknown[])[2] as { extraHashedArgs: HashedValues[] }
		expect(payload.extraHashedArgs).toHaveLength(1)
		const expected = await HashedValues.fromArgs([Fr.fromString("0x01"), Fr.fromString("0x02")])
		expect(payload.extraHashedArgs[0].hash.toString()).toBe(expected.hash.toString())
	})

	test("invalid authwit content kind throws the frozen string", async () => {
		await expect(build(h, [{ kind: "add_private_authwit", content: { kind: "mystery" } }])).rejects.toThrowError(
			"Invalid authwit content kind",
		)
	})

	test("provided private authwit is used verbatim; created one goes through createAuthWit — ORDER preserved", async () => {
		await build(h, [
			{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0x11" }, authwit: ["0xaa"] },
			{ kind: "add_private_authwit", content: { kind: "intent", stuff: 1 } },
		])
		const payload = (h.buildArgs[0] as unknown[])[2] as { authWitnesses: AuthWitness[] }
		expect(payload.authWitnesses).toHaveLength(2)
		// First: provided witness carried verbatim (requestHash = the message hash).
		expect(payload.authWitnesses[0].requestHash.toString()).toBe(Fr.fromString("0x11").toString())
		expect(payload.authWitnesses[0].witness.map((f) => f.toString())).toEqual([Fr.fromString("0xaa").toString()])
		// Second: created via the account for the intent-computed hash.
		expect(h.account.createAuthWit).toHaveBeenCalledTimes(1)
		expect(payload.authWitnesses[1].requestHash.toString()).toBe(Fr.fromString("0x1447").toString())
	})

	test("authwit content kinds route to their OWN hash computations (call vs encoded_call)", async () => {
		const callContent = { kind: "call", stuff: "a" }
		const encodedContent = { kind: "encoded_call", stuff: "b" }
		await build(h, [
			{ kind: "add_private_authwit", content: callContent },
			{ kind: "add_private_authwit", content: encodedContent },
		])
		expect(h.deps.authwit.computeCallMessageHash).toHaveBeenCalledTimes(1)
		expect((h.deps.authwit.computeCallMessageHash.mock.calls as unknown[][])[0]?.[0]).toBe(callContent)
		expect(h.deps.authwit.computeEncodedCallMessageHash).toHaveBeenCalledTimes(1)
		expect((h.deps.authwit.computeEncodedCallMessageHash.mock.calls as unknown[][])[0]?.[0]).toBe(encodedContent)
		const payload = (h.buildArgs[0] as unknown[])[2] as { authWitnesses: AuthWitness[] }
		expect(payload.authWitnesses[0].requestHash.toString()).toBe(Fr.fromString("0xca11").toString())
		expect(payload.authWitnesses[1].requestHash.toString()).toBe(Fr.fromString("0xe11c").toString())
	})

	test("public authwits: pending filing (account/hash/content, in order) + ordered cap hashes + registry call/txCall pairing", async () => {
		const c1 = { kind: "message_hash", messageHash: "0x21" }
		const c2 = { kind: "intent", stuff: 2 }
		const result = await build(h, [
			{ kind: "add_public_authwit", content: c1 },
			{ kind: "add_public_authwit", content: c2 },
		])
		expect(result.pendingPublicAuthwits).toEqual([
			{ account: ACCOUNT_ADDR.toString(), hash: Fr.fromString("0x21").toString(), content: c1 },
			{ account: ACCOUNT_ADDR.toString(), hash: Fr.fromString("0x1447").toString(), content: c2 },
		])
		expect(h.deps.authRegistryService.assertWithinCap).toHaveBeenCalledWith(ACCOUNT_ADDR.toString(), [
			Fr.fromString("0x21").toString(),
			Fr.fromString("0x1447").toString(),
		])
		// Each public authwit enqueues a set_authorized registry call + txCall,
		// index-paired: call[i]'s encoded args carry hash[i], and txCall[i]
		// mirrors it as raw [hash, true].
		const payload = (h.buildArgs[0] as unknown[])[2] as {
			calls: Array<{ name: string; to: { toString(): string }; args: Fr[] }>
		}
		expect(payload.calls).toHaveLength(2)
		const fn = getSetAuthorizedFn()
		const expectedHashes = [Fr.fromString("0x21"), Fr.fromString("0x1447")]
		for (let i = 0; i < 2; i++) {
			expect(payload.calls[i].name).toBe(fn.name)
			expect(payload.calls[i].to.toString()).toBe(getAuthRegistryAddress().toString())
			const expectedArgs = encodeArguments(fn, [expectedHashes[i], true])
			expect(payload.calls[i].args.map((a) => a.toString())).toEqual(expectedArgs.map((a) => a.toString()))
			expect(result.txCalls[i]).toEqual({
				contract: getAuthRegistryAddress().toString(),
				method: fn.name,
				args: [expectedHashes[i], true],
			})
		}
	})

	test("cap gate fires BEFORE the entrypoint build", async () => {
		await build(h, [{ kind: "add_public_authwit", content: { kind: "message_hash", messageHash: "0x21" } }])
		expect(h.calls.indexOf("assertWithinCap")).toBeLessThan(h.calls.indexOf("buildTxExecutionRequest"))
	})

	test("no public authwits → the cap gate never fires", async () => {
		await build(h, [{ kind: "add_capsule", contract: CONTRACT, storageSlot: "0x05", capsule: [] }])
		expect(h.deps.authRegistryService.assertWithinCap).not.toHaveBeenCalled()
	})

	test("call action resolves by name; unknown contract/method throw frozen strings", async () => {
		await expect(build(h, [{ kind: "call", contract: "0xdead", method: "transfer", args: [] }])).rejects.toThrowError(
			"Contract not found",
		)
		await expect(build(h, [{ kind: "call", contract: CONTRACT, method: "nope", args: [] }])).rejects.toThrowError("Method not found")
		const result = await build(h, [{ kind: "call", contract: CONTRACT, method: "transfer", args: [] }])
		expect(result.txCalls).toEqual([{ contract: CONTRACT, method: "transfer", args: [] }])
	})

	test("encoded_call resolves by selector from ABI truth; a mismatched dApp name is a scope violation", async () => {
		const selector = (await FunctionSelector.fromNameAndParameters(FN.name, FN.parameters)).toString()
		await expect(build(h, [{ kind: "encoded_call", to: CONTRACT, selector, args: ["0x02"], name: "sneaky" }])).rejects.toThrowError(
			/Scope violation/,
		)
		const result = await build(h, [{ kind: "encoded_call", to: CONTRACT, selector, args: ["0x02"], name: FN.name }])
		expect(result.txCalls).toEqual([{ contract: CONTRACT, method: FN.name, args: ["0x02"] }])
		const payload = (h.buildArgs[0] as unknown[])[2] as { calls: Array<{ name: string; args: Fr[] }> }
		expect(payload.calls[0].name).toBe(FN.name)
		expect(payload.calls[0].args.map((a) => a.toBigInt())).toEqual([2n])
	})

	test("caller gasSettings are threaded to the entrypoint build verbatim", async () => {
		const gs = { marker: "gas" }
		await build(h, [], gs)
		expect((h.buildArgs[0] as unknown[])[5]).toBe(gs)
	})

	test("initializesAccount reflects the build meta the entrypoint wrote", async () => {
		h.flags.initializesAccount = true
		const result = await build(h, [])
		expect(result.initializesAccount).toBe(true)
	})

	test("result provenance: chainIdentity/txsLimits/nonce come from the asserted build, options threaded", async () => {
		const result = await build(h, [])
		expect(result.chainIdentity).toEqual({ l1ChainId: 0, rollupVersion: 31337 })
		expect(result.txsLimits.daGas).toBe(111n)
		expect(result.txsLimits.l2Gas).toBe(222n)
		expect(result.initializesAccount).toBe(false)
		const args = h.buildArgs[0] as unknown[]
		const options = args[3] as { cancellable: boolean; txNonce: Fr; feePaymentMethodOptions: unknown }
		expect(options.cancellable).toBe(false)
		expect(options.txNonce).toBe(result.nonce)
		expect(options.feePaymentMethodOptions).toEqual({ fake: "feeMethod" })
		// chainInfo committed to the entrypoint derives from the SAME nodeInfo.
		const chainInfo = args[4] as { chainId: Fr; version: Fr }
		expect(chainInfo.chainId.toBigInt()).toBe(0n)
		expect(chainInfo.version.toBigInt()).toBe(31337n)
	})
})
