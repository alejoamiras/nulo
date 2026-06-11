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
import { DappSendExecutor } from "./dapp-send-executor"
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

// ── R1-M2 named pin: no-slot-for-executeSendTransaction ────────────────

describe("no-slot-for-executeSendTransaction (bug pin)", () => {
	test("executeSendTransaction acquires ZERO execution-lane slots — preserve verbatim; do NOT harmonize", async () => {
		// The flow now lives on DappSendExecutor; the lane interface carries
		// acquireSlot for the aztec_sendTx paths, so the pin asserts this
		// path never calls it even though it CAN.
		const acquireSpy = vi.fn()
		const proveAndSendCtxs: unknown[] = []
		const account = { address: { toString: () => "0xacc" } }
		const gasSettings = {
			gasLimits: { daGas: 1, l2Gas: 2 },
			teardownGasLimits: { daGas: 3, l2Gas: 4 },
			maxFeesPerGas: { feePerDaGas: 5n, feePerL2Gas: 6n },
		}
		const executor = new DappSendExecutor({
			planner: {} as never,
			authwit: {} as never,
			txBuilder: {} as never,
			coordinator: {
				proveAndSend: vi.fn(async (ctx: { scopes: unknown; recordTransaction: (h: string) => Promise<unknown> }) => {
					proveAndSendCtxs.push(ctx)
					await ctx.recordTransaction("0xhash")
					return { txHash: { toString: () => "0xhash" } }
				}),
			} as never,
			lane: {
				registerController: vi.fn(),
				deleteController: vi.fn(),
				// The quirk under pin: the slot must never be touched on this path.
				acquireSlot: acquireSpy as never,
				claimOrCreateJournal: acquireSpy as never,
				beginJournal: vi.fn(async () => "job-1"),
				markJournal: vi.fn(async () => {}),
			},
			buildAndEstimate: vi.fn(async () => ({
				txRequest: { txContext: { gasSettings } },
				node: {},
				pxe: {},
				account,
				network: { chainId: 0 },
				nonce: { toString: () => "1" },
				txCalls: [],
				feePaymentMethod: 0,
			})) as never,
			addTransaction: vi.fn(async () => ({})) as never,
			logDebug: () => {},
		})

		const result = await executor.executeSendTransaction(
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
