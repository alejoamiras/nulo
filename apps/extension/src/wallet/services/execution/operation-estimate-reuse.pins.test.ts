/**
 * `OperationEstimateReuse.tryConsume` pins: the ordered collaborator calls and the exact reason at
 * every exit, one guarded field at a time, the multiplier per priority, and the unknown-priority
 * throws (an unvalidated popup input this ladder does not absorb).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { GasFees } from "@aztec-labs/stdlib/gas"
import { predictedWorstMinFees } from "@nulo/aztec-runtime/fee-juice"
import { SessionEndedError } from "@nulo/extension-messaging/errors"
import { PRIORITY_MULTIPLIERS } from "@nulo/wallet-bridge"
import type { Action } from "@nulo/wallet-bridge"
import { OperationEstimateReuse, type OperationEstimateReuseDeps, type OperationEstimateReuseEntry } from "./operation-estimate-reuse"
import { fingerprintOperation, type OperationFingerprintInput } from "./operation-fingerprint"
import type { FeeSettings } from "./spec"
import { ESTIMATE_REUSE_TTL_MS } from "./transfer-estimate-reuse"

const calls = vi.hoisted(() => [] as string[])

vi.mock("@nulo/aztec-runtime/fee-juice", async (importOriginal) => ({
	...(await importOriginal<object>()),
	predictedWorstMinFees: vi.fn(async () => {
		calls.push("predictedWorstMinFees")
		return new GasFees(2n, 3n)
	}),
}))
// Distinct from every priority's multiplier, so the default arm is observable.
vi.mock("./fee/fee-strategy", async (importOriginal) => ({ ...(await importOriginal<object>()), DEFAULT_FEE_MULTIPLIER: 7 }))

const predicted = vi.mocked(predictedWorstMinFees)
const REASON = "operation estimate reuse rejected: "
const FENCE = { profileId: "p1", epoch: 0, session: 1 }
const CALL: Action = { kind: "call", contract: "0xtoken", method: "transfer", args: ["0xme", "0xyou", 5] }
const FPC = { id: "fpc-1", type: 2, address: "0xfpc", chainId: 7, isProtocol: true } as const
const FULL_LADDER = ["getNetwork", "getPendingForAccount", "getLiveChainIdentity", "getFpcInfo", "getNode", "predictedWorstMinFees"]

function input(feeSettings: FeeSettings = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } }): OperationFingerprintInput {
	return {
		networkId: "net-1",
		accountAddress: "0xacc",
		executionMode: "standard",
		from: "0xacc",
		actions: [CALL],
		fee: undefined,
		feeSettings,
	}
}

function entry(feeSettings?: FeeSettings, overrides: Partial<OperationEstimateReuseEntry> = {}): OperationEstimateReuseEntry {
	const identity = input(feeSettings)
	return {
		fingerprint: fingerprintOperation(identity) as string,
		accountAddress: "0xacc",
		networkId: "net-1",
		feeSettings: identity.feeSettings,
		profileId: "p1",
		// (2,3) × the mocked default 7.
		baseFeeFingerprint: "14:21",
		primaryEndpointId: "e1",
		primaryEndpointUrl: "http://primary",
		pendingHashes: ["0xpending"],
		chainIdentity: { l1ChainId: 1, rollupVersion: 4 },
		fpcIdentity: { ...FPC, type: FPC.type as never },
		txRequest: { marker: "txRequest" } as never,
		initializesAccount: false,
		nonce: { toString: () => "42" },
		feePaymentMethod: 1 as never,
		txCalls: [] as never,
		pendingPublicAuthwits: [] as never,
		discoveredHashes: [],
		builtAt: Date.now(),
		...overrides,
	}
}

type Network = { chainId: number; primaryEndpointId: string; endpoints: Array<{ id: string; rpcUrl: string }> }

function harness(
	o: {
		network?: Network
		live?: { l1ChainId: number; rollupVersion: number }
		fpc?: object
		deps?: Partial<OperationEstimateReuseDeps>
	} = {},
) {
	const logDebug = vi.fn()
	const deps: OperationEstimateReuseDeps = {
		getNetwork: vi.fn(async () => {
			calls.push("getNetwork")
			return (o.network ?? { chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://primary" }] }) as never
		}),
		getNode: vi.fn(async () => {
			calls.push("getNode")
			return { marker: "node" } as never
		}),
		getLiveChainIdentity: vi.fn(async () => {
			calls.push("getLiveChainIdentity")
			return o.live ?? { l1ChainId: 1, rollupVersion: 4 }
		}),
		getFpcInfo: vi.fn(async () => {
			calls.push("getFpcInfo")
			return (o.fpc ?? { ...FPC }) as never
		}),
		getPendingForAccount: vi.fn(() => {
			calls.push("getPendingForAccount")
			return [{ hash: "0xpending" }]
		}),
		logDebug,
		...o.deps,
	}
	return { reuse: new OperationEstimateReuse(deps), logDebug }
}

async function consumeOnce(reuse: OperationEstimateReuse, e: OperationEstimateReuseEntry, i = input(e.feeSettings)) {
	reuse.stash("id-1", e)
	const result = await reuse.tryConsume("id-1", i, FENCE)
	// Single-shot on every exit: the slot is gone afterwards.
	expect(await reuse.tryConsume("id-1", i, FENCE)).toBeUndefined()
	return result
}

/** The error a bare expression throws, so a pinned message is the engine's own on every engine. */
function thrown(f: () => unknown): Error {
	try {
		f()
	} catch (error) {
		return error as Error
	}
	throw new Error("expected a throw")
}

/** Today's composition on the same value. Only the module transform's import rewrite is normalized. */
async function compositionError(value: unknown, multiplier: unknown): Promise<Error> {
	predicted.mockResolvedValueOnce(value as never)
	const node = {} as never
	try {
		;(await predictedWorstMinFees(node)).mul(multiplier as never)
	} catch (error) {
		return error as Error
	}
	throw new Error("expected a throw")
}

/** JSC quotes the transformed source: `(0,__vite_ssr_import_N__.f)` in a module, `__vi_import_N__.f` in a test. */
const normalized = (message: string) =>
	message.replace(/\(0,\s*__vite_ssr_import_\d+__\.(\w+)\)/g, "$1").replace(/__vi_import_\d+__\.(\w+)/g, "$1")

beforeEach(() => {
	calls.length = 0
	predicted.mockClear()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("the ladder's order and reasons", () => {
	test("a hit runs every step in order and logs nothing", async () => {
		const { reuse, logDebug } = harness()
		const e = entry()
		expect(await consumeOnce(reuse, e)).toBe(e)
		expect(calls).toEqual(FULL_LADDER)
		expect(logDebug).not.toHaveBeenCalled()
	})

	test.each([
		["fingerprint drift", () => input({ paymentMethod: { kind: "fj" } }), [] as string[], "operation fingerprint drift"],
		[
			"a non-fingerprintable input",
			() => ({ ...input(), actions: [{ kind: "call", contract: "0xc", method: "m", args: [() => 1] } as unknown as Action] }),
			[],
			"operation fingerprint drift",
		],
	])("%s stops before the network", async (_label, makeInput, expectedCalls, reason) => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(), makeInput())).toBeUndefined()
		expect(calls).toEqual(expectedCalls)
		expect(logDebug.mock.calls).toEqual([[REASON + reason]])
	})

	test("another profile's entry throws SessionEndedError before the network", async () => {
		const { reuse, logDebug } = harness()
		reuse.stash("id-1", entry(undefined, { profileId: "p2" }))
		await expect(reuse.tryConsume("id-1", input(), FENCE)).rejects.toBeInstanceOf(SessionEndedError)
		expect(calls).toEqual([])
		expect(logDebug).not.toHaveBeenCalled()
	})

	test.each([
		["a dangling primaryEndpointId", { chainId: 7, primaryEndpointId: "e9", endpoints: [{ id: "e1", rpcUrl: "http://primary" }] }],
		["a moved id", { chainId: 7, primaryEndpointId: "e2", endpoints: [{ id: "e2", rpcUrl: "http://primary" }] }],
		["a moved url", { chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://other" }] }],
	])("%s: primary endpoint changed, nothing after the network", async (_label, network) => {
		const { reuse, logDebug } = harness({ network })
		expect(await consumeOnce(reuse, entry())).toBeUndefined()
		expect(calls).toEqual(["getNetwork"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}primary endpoint changed`]])
	})

	test("the primary as the second row is found by id, never the first row", async () => {
		const network = {
			chainId: 7,
			primaryEndpointId: "e1",
			endpoints: [
				{ id: "e0", rpcUrl: "http://first" },
				{ id: "e1", rpcUrl: "http://primary" },
			],
		}
		const { reuse } = harness({ network })
		expect(await consumeOnce(reuse, entry())).toBeDefined()
	})

	test("a changed pending set stops before the chain read", async () => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(undefined, { pendingHashes: [] }))).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}pending tx set changed`]])
	})

	test.each([
		["l1ChainId alone", { l1ChainId: 2, rollupVersion: 4 }],
		["rollupVersion alone", { l1ChainId: 1, rollupVersion: 5 }],
	])("chain identity: %s misses before the FPC read", async (_label, live) => {
		const { reuse, logDebug } = harness({ live })
		expect(await consumeOnce(reuse, entry())).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount", "getLiveChainIdentity"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}chain identity drift (exact pair mismatch)`]])
	})

	test("chain identity: a throwing assert misses with its message", async () => {
		const { reuse, logDebug } = harness({
			deps: {
				getLiveChainIdentity: vi.fn(async () => {
					calls.push("getLiveChainIdentity")
					throw new Error("Chain identity mismatch")
				}),
			},
		})
		expect(await consumeOnce(reuse, entry())).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount", "getLiveChainIdentity"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}chain identity drift: Chain identity mismatch`]])
	})

	test.each([
		["type", { type: 1 }],
		["address", { address: "0xother" }],
		["chainId", { chainId: 8 }],
		["isProtocol", { isProtocol: false }],
	])("FPC identity: %s alone misses before the node", async (_label, change) => {
		const { reuse, logDebug } = harness({ fpc: { ...FPC, ...change } })
		expect(await consumeOnce(reuse, entry())).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount", "getLiveChainIdentity", "getFpcInfo"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}fpc identity drift`]])
	})

	test("FPC identity: an absent isProtocol reads as false", async () => {
		const { reuse } = harness({ fpc: { id: "fpc-1", type: 2, address: "0xfpc", chainId: 7 } })
		expect(await consumeOnce(reuse, entry(undefined, { fpcIdentity: { ...FPC, type: 2 as never, isProtocol: false } }))).toBeDefined()
	})

	test("FPC identity: an unreadable row misses with its message", async () => {
		const { reuse, logDebug } = harness({
			deps: {
				getFpcInfo: vi.fn(async () => {
					calls.push("getFpcInfo")
					throw new Error("row gone")
				}),
			},
		})
		expect(await consumeOnce(reuse, entry())).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount", "getLiveChainIdentity", "getFpcInfo"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}fpc row unavailable: row gone`]])
	})

	test("an fj entry skips the FPC read", async () => {
		const fj: FeeSettings = { paymentMethod: { kind: "fj" } }
		const { reuse } = harness()
		expect(await consumeOnce(reuse, entry(fj, { fpcIdentity: undefined }))).toBeDefined()
		expect(calls).toEqual(["getNetwork", "getPendingForAccount", "getLiveChainIdentity", "getNode", "predictedWorstMinFees"])
	})

	test("base fee drift is the last step", async () => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(undefined, { baseFeeFingerprint: "999:999" }))).toBeUndefined()
		expect(calls).toEqual(FULL_LADDER)
		expect(logDebug.mock.calls).toEqual([[`${REASON}base fee drift`]])
	})

	test("getNode rejecting propagates its own error, and no fee read runs", async () => {
		const down = new Error("node down")
		const { reuse } = harness({
			deps: {
				getNode: vi.fn(async () => {
					calls.push("getNode")
					throw down
				}),
			},
		})
		reuse.stash("id-1", entry())
		await expect(reuse.tryConsume("id-1", input(), FENCE)).rejects.toBe(down)
		expect(calls).toEqual(FULL_LADDER.slice(0, 5))
	})
})

describe("the TTL guard", () => {
	test("an entry stashed fresh, then aged with no eviction timer run: hit at the TTL, miss one ms past it", async () => {
		vi.useFakeTimers()
		const { reuse, logDebug } = harness()
		const start = Date.now()
		reuse.stash("at", entry(undefined, { builtAt: start }))
		reuse.stash("past", entry(undefined, { builtAt: start }))
		vi.setSystemTime(start + ESTIMATE_REUSE_TTL_MS)
		expect(await reuse.tryConsume("at", input(), FENCE)).toBeDefined()
		vi.setSystemTime(start + ESTIMATE_REUSE_TTL_MS + 1)
		calls.length = 0
		expect(await reuse.tryConsume("past", input(), FENCE)).toBeUndefined()
		expect(calls).toEqual([])
		expect(logDebug.mock.calls).toEqual([[`${REASON}entry expired`]])
	})
})

describe("the multiplier per priority", () => {
	test.each([
		[undefined, "14:21"],
		["", "14:21"],
		["normal", "4:6"],
		["fast", "6:9"],
		["urgent", "10:15"],
	])("priority %j commits basis (2,3) × its multiplier: %s", async (priorityLevel, expected) => {
		const fj = { paymentMethod: { kind: "fj" }, priorityLevel } as FeeSettings
		const { reuse } = harness()
		expect(await consumeOnce(reuse, entry(fj, { fpcIdentity: undefined, baseFeeFingerprint: expected }))).toBeDefined()
		const { reuse: other } = harness()
		expect(await consumeOnce(other, entry(fj, { fpcIdentity: undefined, baseFeeFingerprint: "0:0" }))).toBeUndefined()
	})
})

describe("an unknown priority keeps its throw (an owner lead, not absorbed)", () => {
	const bogus = { paymentMethod: { kind: "fj" }, priorityLevel: "bogus" } as unknown as FeeSettings
	const ctor = { paymentMethod: { kind: "fj" }, priorityLevel: "constructor" } as unknown as FeeSettings

	test("a resolving read: the RangeError of .mul(undefined)", async () => {
		const expected = thrown(() => new GasFees(2n, 3n).mul(undefined as never))
		const { reuse } = harness()
		reuse.stash("id-1", entry(bogus, { fpcIdentity: undefined }))
		const error = await reuse.tryConsume("id-1", input(bogus), FENCE).catch((e: unknown) => e as Error)
		expect(error).toBeInstanceOf(RangeError)
		expect((error as Error).message).toBe(expected.message)
	})

	test("a prototype-named priority: the throw of .mul on the inherited value", async () => {
		const inherited = PRIORITY_MULTIPLIERS["constructor" as never]
		const expected = thrown(() => new GasFees(2n, 3n).mul(inherited))
		const { reuse } = harness()
		reuse.stash("id-1", entry(ctor, { fpcIdentity: undefined }))
		const error = await reuse.tryConsume("id-1", input(ctor), FENCE).catch((e: unknown) => e as Error)
		expect((error as Error).constructor).toBe(expected.constructor)
		expect((error as Error).message).toBe(expected.message)
	})

	test("a rejecting read: the read's own error object", async () => {
		const blockNotFound = new Error("block not found")
		predicted.mockRejectedValueOnce(blockNotFound)
		const { reuse } = harness()
		reuse.stash("id-1", entry(bogus, { fpcIdentity: undefined }))
		await expect(reuse.tryConsume("id-1", input(bogus), FENCE)).rejects.toBe(blockNotFound)
	})

	test.each([undefined, null])("a %s reply: the composition's own TypeError text", async (reply) => {
		const expected = await compositionError(reply, undefined)
		predicted.mockResolvedValueOnce(reply as never)
		const { reuse } = harness()
		reuse.stash("id-1", entry(bogus, { fpcIdentity: undefined }))
		const error = await reuse.tryConsume("id-1", input(bogus), FENCE).catch((e: unknown) => e as Error)
		expect(error).toBeInstanceOf(TypeError)
		expect(normalized((error as Error).message)).toBe(normalized(expected.message))
	})
})
