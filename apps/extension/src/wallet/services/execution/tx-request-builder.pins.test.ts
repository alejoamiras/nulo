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
import { FunctionType } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { getAuthRegistryAddress } from "@/wallet/utils/auth-registry"
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
	const account = {
		address: ACCOUNT_ADDR,
		createAuthWit: vi.fn(async (h: Fr) => new AuthWitness(h, [Fr.fromString("0x77")])),
		buildTxExecutionRequest: vi.fn(async (...args: unknown[]) => {
			buildArgs.push(args)
			const meta = args[6] as { initializesAccount?: boolean }
			meta.initializesAccount = false
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
		authRegistryService: { assertWithinCap: vi.fn(async () => undefined) },
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
	return { builder, deps, account, calls, buildArgs }
}

function build(h: Harness, actions: unknown[]) {
	return h.builder.buildStandard({ networkId: "net-1", accountAddress: ACCOUNT_ADDR.toString(), actions: actions as never }, {
		fake: "feeMethod",
	} as never)
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
		expect(h.deps.resolver.resolveInstances).not.toHaveBeenCalled()
	})

	test("happy ordering: getNodeInfo precedes resolveInstances", async () => {
		await build(h, [])
		expect(h.calls.indexOf("getNodeInfo")).toBeLessThan(h.calls.indexOf("resolveInstances"))
	})

	test("capsule action maps contract/storageSlot/values in order", async () => {
		const result = await build(h, [{ kind: "add_capsule", contract: CONTRACT, storageSlot: "0x05", capsule: ["0x01", "0x02"] }])
		const payload = (h.buildArgs[0] as unknown[])[2] as { capsules: Array<{ contractAddress: unknown; storageSlot: Fr; data: Fr[] }> }
		expect(payload.capsules).toHaveLength(1)
		expect(payload.capsules[0].contractAddress.toString()).toBe(CONTRACT)
		expect(payload.capsules[0].storageSlot.toString()).toBe(new Fr(5n).toString())
		expect(payload.capsules[0].data.map((f) => f.toBigInt())).toEqual([1n, 2n])
		expect(result.pendingPublicAuthwits).toEqual([])
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
		// Each public authwit enqueues a set_authorized registry call + txCall.
		const payload = (h.buildArgs[0] as unknown[])[2] as { calls: Array<{ name: string; to: unknown }> }
		expect(payload.calls).toHaveLength(2)
		expect(payload.calls.every((c) => c.to.toString() === getAuthRegistryAddress().toString())).toBe(true)
		expect(result.txCalls).toHaveLength(2)
		expect(result.txCalls.every((t) => t.contract === getAuthRegistryAddress().toString())).toBe(true)
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
