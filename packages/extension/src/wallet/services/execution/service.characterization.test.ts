/**
 * Characterization safety net for the execution-decomposition arc.
 *
 * These tests pin CURRENT behavior of facade internals that later phases
 * extract (estimate-reuse cache, gas-balance cache, cancelJob). They are
 * deliberately byte-precise where downstream contracts depend on exact
 * strings: `TransferEstimateReuseEntry.baseFeeFingerprint` is compared
 * against a freshly-computed fingerprint at consume time, so the
 * fingerprint FORMAT is load-bearing — an extraction that changes it
 * invalidates every cached estimate silently.
 *
 * Tests bypass ServiceCollection.start() via the private-field-injection
 * pattern from `feesettings-invariant.test.ts`: construct the service,
 * set `initialized`, inject only the collaborators each path touches.
 */

import { describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { TransferType } from "@/wallet/services/transaction/spec"
import type { FeeSettings } from "./spec"
import { ExecutionService, fingerprintBaseFee, fingerprintFeeSettings } from "./service"

function makeService(): ExecutionService {
	const logger = new LoggerStore(new ConfigStore())
	const service = new ExecutionService(logger)
	;(service as unknown as { initialized: boolean }).initialized = true
	return service
}

/** Loose injection helper — the facade's collaborators are private fields. */
function inject(service: ExecutionService, fields: Record<string, unknown>): void {
	for (const [k, v] of Object.entries(fields)) {
		;(service as unknown as Record<string, unknown>)[k] = v
	}
}

// ── Fingerprint byte-stability ─────────────────────────────────────────

describe("fingerprint byte-stability (extraction contract)", () => {
	test("fingerprintBaseFee exact format: '<da>:<l2>'", () => {
		expect(fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })).toBe("100:200")
		expect(fingerprintBaseFee({ feePerDaGas: 0n, feePerL2Gas: 0n })).toBe("0:0")
	})

	test("fingerprintFeeSettings exact format per payment-method variant", () => {
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fj" } })).toBe("fj|default")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fj" }, priorityLevel: "fast" })).toBe("fj|fast")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fpc", fpcId: "abc" }, priorityLevel: "urgent" })).toBe("fpc:abc|urgent")
		expect(
			fingerprintFeeSettings({
				paymentMethod: { kind: "fjwc", claimAmount: "100", claimSecret: "sec", messageLeafIndex: "0" },
			}),
		).toBe("fjwc:100:sec:0|default")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "embedded" } })).toBe("embedded|default")
	})
})

// ── tryConsumeTransferEstimate observable exits ────────────────────────

const FEE_SETTINGS: FeeSettings = { paymentMethod: { kind: "fj" } }

const INPUTS = {
	networkId: "net-1",
	accountAddress: "0xacc",
	tokenId: 1,
	transferType: TransferType.Public,
	recipientAddress: "0xrecipient",
	amount: 100n,
	feeSettings: FEE_SETTINGS,
}

// Node reports min fees of 50/100; default multiplier 2 → a fresh build
// would finalize 100:200, so a matching entry stores that fingerprint.
const CURRENT_MIN = { feePerDaGas: 50n, feePerL2Gas: 100n }
const MATCHING_BASE_FEE_FINGERPRINT = "100:200"

const PRIMARY_ENDPOINT = { id: "ep-1", rpcUrl: "http://localhost:8080" }

function makeEntry(overrides: Record<string, unknown> = {}) {
	return {
		networkId: INPUTS.networkId,
		accountAddress: INPUTS.accountAddress,
		tokenId: INPUTS.tokenId,
		transferType: INPUTS.transferType,
		recipientAddress: INPUTS.recipientAddress,
		amount: INPUTS.amount,
		feeSettingsHash: fingerprintFeeSettings(FEE_SETTINGS),
		profileId: "profile-1",
		baseFeeFingerprint: MATCHING_BASE_FEE_FINGERPRINT,
		primaryEndpointId: PRIMARY_ENDPOINT.id,
		primaryEndpointUrl: PRIMARY_ENDPOINT.rpcUrl,
		pendingHashes: [] as string[],
		txRequest: {},
		nonce: { toString: () => "1" },
		feePaymentMethod: 0,
		token: { contract: "0xtoken", name: "Token", symbol: "TOK", decimals: 18 },
		fnName: "transfer_in_public",
		args: [],
		builtAt: Date.now(),
		...overrides,
	}
}

/** Service wired so the happy path succeeds; tests override one axis each. */
function makeReuseService(
	overrides: {
		entry?: Record<string, unknown>
		profile?: { id: string } | undefined
		network?: Record<string, unknown>
		getCurrentMinFees?: () => Promise<{ feePerDaGas: bigint; feePerL2Gas: bigint }>
		pending?: Array<{ hash: string }>
	} = {},
) {
	const service = makeService()
	const entry = makeEntry(overrides.entry)
	const cache = new Map([["est-1", entry]])
	inject(service, {
		estimateReuseCache: cache,
		profileService: {
			getActiveProfile: async () => ("profile" in overrides ? overrides.profile : { id: "profile-1" }),
		},
		networkService: {
			getNetwork: async () =>
				overrides.network ?? {
					chainId: 0,
					primaryEndpointId: PRIMARY_ENDPOINT.id,
					endpoints: [PRIMARY_ENDPOINT],
				},
			getNode: async () => ({
				getCurrentMinFees: overrides.getCurrentMinFees ?? (async () => CURRENT_MIN),
			}),
		},
		transactionService: {
			getPendingForAccount: () => overrides.pending ?? [],
		},
	})
	return { service, entry, cache }
}

async function consume(service: ExecutionService, estimateId = "est-1") {
	return await (
		service as unknown as {
			tryConsumeTransferEstimate(id: string, inputs: typeof INPUTS): Promise<unknown>
		}
	).tryConsumeTransferEstimate(estimateId, INPUTS)
}

describe("tryConsumeTransferEstimate: every observable exit", () => {
	test("happy path returns the entry", async () => {
		const { service, entry } = makeReuseService()
		expect(await consume(service)).toBe(entry)
	})

	test("unknown estimateId → undefined", async () => {
		const { service } = makeReuseService()
		expect(await consume(service, "nope")).toBeUndefined()
	})

	test("single-shot: second consume of the same id → undefined", async () => {
		const { service } = makeReuseService()
		expect(await consume(service)).toBeDefined()
		expect(await consume(service)).toBeUndefined()
	})

	test("TTL stale → undefined", async () => {
		const { service } = makeReuseService({ entry: { builtAt: Date.now() - 5 * 60 * 1000 - 1 } })
		expect(await consume(service)).toBeUndefined()
	})

	test("input drift (recipient) → undefined", async () => {
		const { service } = makeReuseService({ entry: { recipientAddress: "0xother" } })
		expect(await consume(service)).toBeUndefined()
	})

	test("fee-settings drift (different payment method hash) → undefined", async () => {
		const { service } = makeReuseService({
			entry: { feeSettingsHash: fingerprintFeeSettings({ paymentMethod: { kind: "fpc", fpcId: "x" } }) },
		})
		expect(await consume(service)).toBeUndefined()
	})

	test("profile drift (different active profile) → undefined", async () => {
		const { service } = makeReuseService({ profile: { id: "profile-2" } })
		expect(await consume(service)).toBeUndefined()
	})

	test("no active profile → undefined", async () => {
		const { service } = makeReuseService({ profile: undefined })
		expect(await consume(service)).toBeUndefined()
	})

	test("no primary endpoint on the network → undefined", async () => {
		const { service } = makeReuseService({
			network: { chainId: 0, primaryEndpointId: "ep-gone", endpoints: [PRIMARY_ENDPOINT] },
		})
		expect(await consume(service)).toBeUndefined()
	})

	test("primary endpoint URL changed → undefined", async () => {
		const { service } = makeReuseService({
			network: {
				chainId: 0,
				primaryEndpointId: PRIMARY_ENDPOINT.id,
				endpoints: [{ id: PRIMARY_ENDPOINT.id, rpcUrl: "http://localhost:9999" }],
			},
		})
		expect(await consume(service)).toBeUndefined()
	})

	test("base fee drift → undefined", async () => {
		const { service } = makeReuseService({
			getCurrentMinFees: async () => ({ feePerDaGas: 51n, feePerL2Gas: 100n }),
		})
		expect(await consume(service)).toBeUndefined()
	})

	test("base fee fetch failure → undefined (conservative)", async () => {
		const { service } = makeReuseService({
			getCurrentMinFees: async () => {
				throw new Error("node down")
			},
		})
		expect(await consume(service)).toBeUndefined()
	})

	test("pending-tx set changed → undefined", async () => {
		const { service } = makeReuseService({ pending: [{ hash: "0xnew" }] })
		expect(await consume(service)).toBeUndefined()
	})
})

// ── cancelJob: transition-first, abort-second contract ─────────────────

describe("cancelJob: journal-first ordering contract", () => {
	test("FSM accepts cancel → controller aborted and removed", async () => {
		const service = makeService()
		const controller = new AbortController()
		const transitions: unknown[] = []
		inject(service, {
			operationJournal: {
				transitionOperation: async (id: string, patch: unknown) => {
					transitions.push([id, patch])
				},
			},
			activeControllers: new Map([["job-1", controller]]),
		})
		await service.cancelJob("job-1")
		expect(transitions).toEqual([["job-1", { stage: "cancelled" }]])
		expect(controller.signal.aborted).toBe(true)
		expect((service as unknown as { activeControllers: Map<string, AbortController> }).activeControllers.size).toBe(0)
	})

	test("FSM rejects cancel (too late) → signal dropped, controller NOT aborted", async () => {
		const service = makeService()
		const controller = new AbortController()
		inject(service, {
			operationJournal: {
				transitionOperation: async () => {
					throw new Error("illegal transition: succeeded → cancelled")
				},
			},
			activeControllers: new Map([["job-1", controller]]),
		})
		await service.cancelJob("job-1")
		expect(controller.signal.aborted).toBe(false)
		expect((service as unknown as { activeControllers: Map<string, AbortController> }).activeControllers.size).toBe(1)
	})
})

// ── getGasBalances: cache + single-flight shape ────────────────────────

describe("getGasBalances: cache + single-flight contract", () => {
	const BALANCES = { publicFeeJuice: "100", privateFeeJuice: null }

	test("fresh cache entry returned without recompute (deps never touched)", async () => {
		const service = makeService()
		// Collaborators stay null! — touching them would throw, which proves
		// the cached path short-circuits before any dependency access.
		inject(service, {
			gasBalanceCache: new Map([["net-1:0xacc", { result: BALANCES, fetchedAt: Date.now() }]]),
		})
		expect(await service.getGasBalances("net-1", "0xacc")).toBe(BALANCES)
	})

	test("stale cache entry is NOT returned (TTL boundary)", async () => {
		const service = makeService()
		inject(service, {
			gasBalanceCache: new Map([["net-1:0xacc", { result: BALANCES, fetchedAt: Date.now() - 5 * 60 * 1000 - 1 }]]),
		})
		// Past TTL the facade recomputes; with null! collaborators that
		// recompute rejects — proving the cache was bypassed.
		await expect(service.getGasBalances("net-1", "0xacc")).rejects.toThrow()
	})

	test("forceRefresh bypasses a fresh cache entry", async () => {
		const service = makeService()
		inject(service, {
			gasBalanceCache: new Map([["net-1:0xacc", { result: BALANCES, fetchedAt: Date.now() }]]),
		})
		await expect(service.getGasBalances("net-1", "0xacc", true)).rejects.toThrow()
	})

	test("single-flight: concurrent callers share the in-flight promise", async () => {
		const service = makeService()
		const pending = Promise.resolve(BALANCES)
		inject(service, {
			gasBalanceInFlight: new Map([["net-1:0xacc", pending]]),
		})
		const result = await service.getGasBalances("net-1", "0xacc")
		expect(result).toBe(BALANCES)
	})
})
