/**
 * `TransferEstimateReuse.tryConsume` pins: the ordered collaborator calls and the exact reason at
 * every exit, each input field alone, the multiplier per priority, and the soft miss on an
 * unknown priority or a null-like fee reply.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { GasFees } from "@aztec-labs/stdlib/gas"
import { predictedWorstMinFees } from "@nulo/aztec-runtime/fee-juice"
import { SessionEndedError } from "@nulo/extension-messaging/errors"
import { PRIORITY_MULTIPLIERS } from "@nulo/wallet-bridge"
import { TransferType } from "@/wallet/services/transaction/spec"
import type { TransferRequest } from "./operation-planner"
import type { FeeSettings } from "./spec"
import { ESTIMATE_REUSE_TTL_MS } from "./estimate-reuse-shared"
import {
	TransferEstimateReuse,
	type TransferEstimateReuseDeps,
	type TransferEstimateReuseEntry,
	fingerprintFeeSettings,
} from "./transfer-estimate-reuse"

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
const REASON = "tryConsumeTransferEstimate est-1: "
const FENCE = { profileId: "p1", epoch: 0, session: 1 }
const FULL_LADDER = ["getNetwork", "getNode", "predictedWorstMinFees", "getPendingForAccount"]

function request(feeSettings: FeeSettings = { paymentMethod: { kind: "fj" } }, overrides: Partial<TransferRequest> = {}): TransferRequest {
	return {
		networkId: "net-1",
		accountAddress: "0xacc",
		tokenId: 1,
		transferType: TransferType.Public,
		recipientAddress: "0xyou",
		amount: 100n,
		feeSettings,
		...overrides,
	}
}

function entry(feeSettings: FeeSettings = { paymentMethod: { kind: "fj" } }, overrides: Partial<TransferEstimateReuseEntry> = {}) {
	const r = request(feeSettings)
	return {
		networkId: r.networkId,
		accountAddress: r.accountAddress,
		tokenId: r.tokenId,
		transferType: r.transferType,
		recipientAddress: r.recipientAddress,
		amount: r.amount,
		feeSettingsHash: fingerprintFeeSettings(feeSettings),
		profileId: "p1",
		// (2,3) × the mocked default 7.
		baseFeeFingerprint: "14:21",
		primaryEndpointId: "e1",
		primaryEndpointUrl: "http://primary",
		pendingHashes: ["0xpending"],
		txRequest: {} as never,
		initializesAccount: false,
		nonce: { toString: () => "1" },
		feePaymentMethod: 0 as never,
		token: { contract: "0xtoken", name: "Token", symbol: "TOK", decimals: 18 },
		fnName: "transfer_in_public",
		args: [],
		builtAt: Date.now(),
		...overrides,
	} satisfies TransferEstimateReuseEntry
}

type Network = { chainId: number; primaryEndpointId: string; endpoints: Array<{ id: string; rpcUrl: string }> }

function harness(o: { network?: Network; deps?: Partial<TransferEstimateReuseDeps> } = {}) {
	const logDebug = vi.fn()
	const deps: TransferEstimateReuseDeps = {
		getNetwork: vi.fn(async () => {
			calls.push("getNetwork")
			return (o.network ?? { chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://primary" }] }) as never
		}),
		getNode: vi.fn(async () => {
			calls.push("getNode")
			return { marker: "node" } as never
		}),
		getPendingForAccount: vi.fn(() => {
			calls.push("getPendingForAccount")
			return [{ hash: "0xpending" }]
		}),
		logDebug,
		...o.deps,
	}
	return { reuse: new TransferEstimateReuse(deps), logDebug }
}

async function consumeOnce(reuse: TransferEstimateReuse, e: TransferEstimateReuseEntry, r: TransferRequest) {
	reuse.stash("est-1", e)
	const result = await reuse.tryConsume("est-1", r, FENCE)
	expect(await reuse.tryConsume("est-1", r, FENCE)).toBeUndefined()
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
		expect(await consumeOnce(reuse, e, request())).toBe(e)
		expect(calls).toEqual(FULL_LADDER)
		expect(logDebug).not.toHaveBeenCalled()
	})

	test.each([
		["networkId", { networkId: "net-2" }],
		["accountAddress", { accountAddress: "0xother" }],
		["tokenId", { tokenId: 2 }],
		["transferType", { transferType: TransferType.Private }],
		["recipientAddress", { recipientAddress: "0xelse" }],
		["amount", { amount: 101n }],
		["feeSettings", { feeSettings: { paymentMethod: { kind: "fpc", fpcId: "x" } } as FeeSettings }],
	])("input drift on %s alone stops before the network", async (_label, change) => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(), { ...request(), ...change })).toBeUndefined()
		expect(calls).toEqual([])
		expect(logDebug.mock.calls).toEqual([[`${REASON}input drift`]])
	})

	test("another profile's entry throws SessionEndedError before the network", async () => {
		const { reuse, logDebug } = harness()
		reuse.stash("est-1", entry(undefined, { profileId: "p2" }))
		await expect(reuse.tryConsume("est-1", request(), FENCE)).rejects.toBeInstanceOf(SessionEndedError)
		expect(calls).toEqual([])
		expect(logDebug).not.toHaveBeenCalled()
	})

	test("a dangling primaryEndpointId: no primary endpoint, nothing after the network", async () => {
		const { reuse, logDebug } = harness({
			network: { chainId: 7, primaryEndpointId: "e9", endpoints: [{ id: "e1", rpcUrl: "http://primary" }] },
		})
		expect(await consumeOnce(reuse, entry(), request())).toBeUndefined()
		expect(calls).toEqual(["getNetwork"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}no primary endpoint`]])
	})

	test.each([
		["a moved id", { chainId: 7, primaryEndpointId: "e2", endpoints: [{ id: "e2", rpcUrl: "http://primary" }] }],
		["a moved url", { chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://other" }] }],
	])("%s: primary endpoint changed, nothing after the network", async (_label, network) => {
		const { reuse, logDebug } = harness({ network })
		expect(await consumeOnce(reuse, entry(), request())).toBeUndefined()
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
		expect(await consumeOnce(reuse, entry(), request())).toBeDefined()
	})

	test("base fee changed stops before the pending read", async () => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(undefined, { baseFeeFingerprint: "999:999" }), request())).toBeUndefined()
		expect(calls).toEqual(FULL_LADDER.slice(0, 3))
		expect(logDebug.mock.calls).toEqual([[`${REASON}base fee changed`]])
	})

	test("a rejecting fee read misses with its message, before the pending read", async () => {
		predicted.mockRejectedValueOnce(new Error("block not found"))
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(), request())).toBeUndefined()
		expect(calls).toEqual(["getNetwork", "getNode"])
		expect(logDebug.mock.calls).toEqual([[`${REASON}base fee fetch failed: block not found`]])
	})

	test("getNode sits outside the fee catch: its rejection propagates", async () => {
		const down = new Error("node down")
		const { reuse } = harness({
			deps: {
				getNode: vi.fn(async () => {
					calls.push("getNode")
					throw down
				}),
			},
		})
		reuse.stash("est-1", entry())
		await expect(reuse.tryConsume("est-1", request(), FENCE)).rejects.toBe(down)
		expect(calls).toEqual(["getNetwork", "getNode"])
	})

	test("a changed pending set is the last step", async () => {
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(undefined, { pendingHashes: [] }), request())).toBeUndefined()
		expect(calls).toEqual(FULL_LADDER)
		expect(logDebug.mock.calls).toEqual([[`${REASON}pending tx set changed`]])
	})
})

describe("the TTL guard", () => {
	test("an entry stashed fresh, then aged with no eviction timer run: hit at the TTL, miss one ms past it", async () => {
		vi.useFakeTimers()
		const { reuse, logDebug } = harness()
		const start = Date.now()
		reuse.stash("at", entry(undefined, { builtAt: start }))
		reuse.stash("est-1", entry(undefined, { builtAt: start }))
		vi.setSystemTime(start + ESTIMATE_REUSE_TTL_MS)
		expect(await reuse.tryConsume("at", request(), FENCE)).toBeDefined()
		vi.setSystemTime(start + ESTIMATE_REUSE_TTL_MS + 1)
		calls.length = 0
		expect(await reuse.tryConsume("est-1", request(), FENCE)).toBeUndefined()
		expect(calls).toEqual([])
		expect(logDebug.mock.calls).toEqual([[`${REASON}stale (TTL)`]])
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
		const fs = { paymentMethod: { kind: "fj" }, priorityLevel } as FeeSettings
		const { reuse } = harness()
		expect(await consumeOnce(reuse, entry(fs, { baseFeeFingerprint: expected }), request(fs))).toBeDefined()
		const { reuse: other } = harness()
		expect(await consumeOnce(other, entry(fs, { baseFeeFingerprint: "0:0" }), request(fs))).toBeUndefined()
	})
})

describe("an unknown priority or a null-like reply misses softly", () => {
	test.each([
		["bogus", undefined],
		["constructor", PRIORITY_MULTIPLIERS["constructor" as never]],
	])("priority %j: the reason carries .mul's own message", async (priorityLevel, multiplier) => {
		const expected = thrown(() => new GasFees(2n, 3n).mul(multiplier as never))
		const fs = { paymentMethod: { kind: "fj" }, priorityLevel } as unknown as FeeSettings
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(fs), request(fs))).toBeUndefined()
		expect(logDebug.mock.calls).toEqual([[`${REASON}base fee fetch failed: ${expected.message}`]])
	})

	test.each([undefined, null])("a %s reply: the reason carries the basis read's own message", async (reply) => {
		const expected = thrown(() => {
			const basis = reply as unknown as { feePerDaGas: bigint }
			return basis.feePerDaGas
		})
		predicted.mockResolvedValueOnce(reply as never)
		const { reuse, logDebug } = harness()
		expect(await consumeOnce(reuse, entry(), request())).toBeUndefined()
		expect(logDebug.mock.calls).toEqual([[`${REASON}base fee fetch failed: ${expected.message}`]])
	})
})
