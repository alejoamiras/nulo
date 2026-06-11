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
import { OriginType } from "@/wallet/services/transaction/spec"
import { ExecutionService } from "./service"

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

// ── R1-M2 named pin: no-slot-for-executeSendTransaction ────────────────

describe("no-slot-for-executeSendTransaction (bug pin)", () => {
	test("executeSendTransaction acquires ZERO execution-lane slots — preserve verbatim; do NOT harmonize in P6/P7", async () => {
		const service = makeService()
		const acquireSpy = vi.fn()
		const proveAndSendCtxs: unknown[] = []
		const journalPatches: unknown[] = []
		inject(service, {
			// The quirk under pin: the mutex must never be touched on this path.
			executionMutex: {
				acquire: acquireSpy,
				enter: acquireSpy,
				run: acquireSpy,
			},
			profileService: { getActiveProfile: async () => ({ id: "p1" }) },
			operationJournal: {
				createOperation: async () => ({ id: "job-1" }),
				transitionOperation: async (_id: string, patch: unknown) => {
					journalPatches.push(patch)
				},
			},
			transactionService: { addTransaction: vi.fn(async () => ({})) },
			coordinator: {
				proveAndSend: vi.fn(async (ctx: { scopes: unknown; recordTransaction: (h: string) => Promise<unknown> }) => {
					proveAndSendCtxs.push(ctx)
					await ctx.recordTransaction("0xhash")
					return { txHash: { toString: () => "0xhash" } }
				}),
			},
		})
		// Stub the build step — strategies are out of scope for this pin.
		const account = { address: { toString: () => "0xacc" } }
		const gasSettings = {
			gasLimits: { daGas: 1, l2Gas: 2 },
			teardownGasLimits: { daGas: 3, l2Gas: 4 },
			maxFeesPerGas: { feePerDaGas: 5n, feePerL2Gas: 6n },
		}
		;(service as unknown as Record<string, unknown>).buildAndEstimateTxRequest = vi.fn(async () => ({
			txRequest: { txContext: { gasSettings } },
			node: {},
			pxe: {},
			account,
			network: { chainId: 0 },
			nonce: { toString: () => "1" },
			txCalls: [],
			feePaymentMethod: 0,
		}))

		const result = await service.executeSendTransaction(
			{
				kind: "send_transaction",
				networkId: "net-1",
				accountAddress: "0xacc",
				actions: [],
				feeSettings: { paymentMethod: { kind: "fj" } },
			} as never,
			{ type: OriginType.DAPP, name: "test" } as never,
		)

		expect(result).toBe("0xhash")
		// THE PIN: zero lane/slot interaction on this path.
		expect(acquireSpy).not.toHaveBeenCalled()
		// Scopes passed to the tail: exactly [account.address] (R1-H1 executable scope assertion).
		expect((proveAndSendCtxs[0] as { scopes: unknown[] }).scopes).toEqual([account.address])
	})
})
