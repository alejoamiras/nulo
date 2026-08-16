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
import { OriginType } from "@/wallet/services/transaction/spec"
import { DappSendExecutor } from "./dapp-send-executor"
import { ExecutionLane } from "./execution-lane"

// ── cancelJob: transition-first, abort-second contract ─────────────────

describe("cancelJob: journal-first ordering contract", () => {
	function makeLane(transitionOperation: (id: string, patch: unknown) => Promise<unknown>) {
		return new ExecutionLane({
			// Ownership gate satisfied: record belongs to the active profile.
			operationJournal: {
				transitionOperation,
				getOperation: async () => ({ id: "job-1", profileId: "p1" }) as never,
			} as never,
			getActiveProfile: async () => ({ id: "p1" }) as never,
			getNetwork: async () => ({}) as never,
			logDebug: () => {},
			logInfo: () => {},
			logError: () => {},
		})
	}

	test("FSM accepts cancel → controller aborted and removed", async () => {
		const controller = new AbortController()
		const transitions: unknown[] = []
		const lane = makeLane(async (id, patch) => {
			transitions.push([id, patch])
			return {}
		})
		lane.registerController("job-1", controller)
		await lane.cancelJob("job-1")
		expect(transitions).toEqual([["job-1", { stage: "cancelled" }]])
		expect(controller.signal.aborted).toBe(true)
		const registry = (lane as unknown as { activeControllers: Map<string, AbortController> }).activeControllers
		expect(registry.size).toBe(0)
	})

	test("FSM rejects cancel (too late) → signal dropped, controller NOT aborted", async () => {
		const controller = new AbortController()
		const lane = makeLane(async () => {
			throw new Error("illegal transition: succeeded → cancelled")
		})
		lane.registerController("job-1", controller)
		await lane.cancelJob("job-1")
		expect(controller.signal.aborted).toBe(false)
		const registry = (lane as unknown as { activeControllers: Map<string, AbortController> }).activeControllers
		expect(registry.size).toBe(1)
	})
})

// ── B-02: slot-for-executeSendTransaction (was: no-slot bug pin) ────────

describe("slot-for-executeSendTransaction (B-02 fix)", () => {
	test("executeSendTransaction NOW takes an execution-lane slot and releases it", async () => {
		// B-02: this path previously bypassed the ExecutionMutex, letting two
		// concurrent send_transaction ops interleave simulate/prove against the
		// same PXE + account. It now runs through the shared runInSlot scaffold
		// like the other two dApp-send paths — acquireSlot + release, and
		// claimOrCreateJournal instead of the old un-slotted beginJournal.
		const releaseSlot = vi.fn()
		const acquireSlot = vi.fn(async () => ({ release: releaseSlot, preController: undefined }))
		const claimOrCreateJournal = vi.fn(async () => ({ journalId: "job-1", controller: new AbortController() }))
		const beginJournal = vi.fn(async () => "job-1")
		const proveAndSendCtxs: unknown[] = []
		const proveAndSend = vi.fn(async (ctx: { scopes: unknown; recordTransaction: (h: string) => Promise<unknown> }) => {
			proveAndSendCtxs.push(ctx)
			await ctx.recordTransaction("0xhash")
			return { txHash: { toString: () => "0xhash" } }
		})
		const account = { address: { toString: () => "0xacc" } }
		const gasSettings = {
			gasLimits: { daGas: 1, l2Gas: 2 },
			teardownGasLimits: { daGas: 3, l2Gas: 4 },
			maxFeesPerGas: { feePerDaGas: 5n, feePerL2Gas: 6n },
		}
		const executor = new DappSendExecutor({
			planner: {} as never,
			estimateWithDiscovery: {} as never,
			txBuilder: {} as never,
			coordinator: { proveAndSend } as never,
			lane: {
				registerController: vi.fn(),
				deleteController: vi.fn(),
				acquireSlot: acquireSlot as never,
				claimOrCreateJournal: claimOrCreateJournal as never,
				beginJournal: beginJournal as never,
				markJournal: vi.fn(async () => {}),
			},
			buildAndEstimateValidated: vi.fn(async () => ({
				txRequest: { txContext: { gasSettings } },
				node: {},
				pxe: {},
				account,
				network: { chainId: 0 },
				nonce: { toString: () => "1" },
				txCalls: [],
				feePaymentMethod: 0,
				pendingPublicAuthwits: [],
			})) as never,
			addTransaction: vi.fn(async () => ({})) as never,
			recordPendingAuthwits: vi.fn(async () => {}) as never,
			operationEstimateReuse: { tryConsume: vi.fn(async () => undefined), stash: vi.fn(), evict: vi.fn() } as never,
			getActiveProfile: vi.fn(async () => ({ id: "p1" })) as never,
			getNetwork: vi.fn() as never,
			getNode: vi.fn() as never,
			getPXE: vi.fn() as never,
			getAccountContract: vi.fn() as never,
			getPendingForAccount: vi.fn(() => []) as never,
			getFpcInfo: vi.fn() as never,
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
		// THE FIX: the slot is acquired, the journal claimed via the scaffold (not
		// the old un-slotted beginJournal), and the slot released on success.
		expect(acquireSlot).toHaveBeenCalledTimes(1)
		expect(claimOrCreateJournal).toHaveBeenCalledTimes(1)
		expect(beginJournal).not.toHaveBeenCalled()
		expect(releaseSlot).toHaveBeenCalledTimes(1)
		// The slot must WRAP the work: acquire before prove, release AFTER prove —
		// releasing early would let a successor op interleave against the same PXE.
		const acquireOrder = acquireSlot.mock.invocationCallOrder[0]!
		const proveOrder = proveAndSend.mock.invocationCallOrder[0]!
		const releaseOrder = releaseSlot.mock.invocationCallOrder[0]!
		expect(acquireOrder).toBeLessThan(proveOrder)
		expect(proveOrder).toBeLessThan(releaseOrder)
		// Scopes passed to the tail: exactly [account.address] (R1-H1 executable scope assertion).
		expect((proveAndSendCtxs[0] as { scopes: unknown[] }).scopes).toEqual([account.address])
	})
})
