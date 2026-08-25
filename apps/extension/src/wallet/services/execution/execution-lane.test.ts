/**
 * `ExecutionLane` — microtask-level race + backpressure pins for the
 * lane seam, against the REAL `ExecutionMutex` (the mutex's own FIFO /
 * abort / capacity semantics are pinned in `execution-mutex.test.ts`;
 * these tests pin the LANE's choreography on top of it).
 *
 * Plan-mandated coverage (final codex pass, Medium):
 *   - capacity-reject maps to journal-failed + `TooManyPendingError`
 *   - heartbeats fire while queued
 *   - reaper-window: a queued-then-running op is not reaped (the
 *     heartbeat covers the wait; the holder's own stage transitions
 *     take over after the grant)
 * plus the sync-register invariant, cancel-during-wait, and the FIFO
 * baton release point. The cancelJob ordering contract is pinned in
 * `service.characterization.test.ts`.
 */

import { describe, expect, test, vi } from "vitest"
import { TooManyPendingError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { ExecutionLane, type ExecutionLaneDeps } from "./execution-lane"

function makeLane(overrides: Partial<ExecutionLaneDeps> = {}) {
	const transitions: unknown[][] = []
	const touches: string[] = []
	const deps: ExecutionLaneDeps = {
		operationJournal: {
			// Default: every record exists and belongs to the active profile,
			// so the ownership gate passes — choreography tests stay focused.
			getOperation: vi.fn(async (id: string) => ({ id, profileId: "p1" }) as never),
			transitionOperation: vi.fn(async (...args: unknown[]) => {
				transitions.push(args)
				return {}
			}),
			touchOperation: vi.fn(async (id: string) => {
				touches.push(id)
			}),
		} as never,
		getActiveProfile: vi.fn(async () => ({ id: "p1" }) as never),
		getNetwork: vi.fn(async () => ({ chainId: 7 }) as never),
		logDebug: vi.fn(),
		logInfo: vi.fn(),
		logError: vi.fn(),
		...overrides,
	}
	return { deps, transitions, touches, lane: new ExecutionLane(deps) }
}

function controllers(lane: ExecutionLane): Map<string, AbortController> {
	return (lane as unknown as { activeControllers: Map<string, AbortController> }).activeControllers
}

async function flushMicrotasks(rounds = 10): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		await new Promise<void>((r) => queueMicrotask(r))
	}
}

describe("ExecutionLane.acquireSlot", () => {
	test("sync-register invariant + cancel-during-wait → JobCancelledSentinel, controller cleaned", async () => {
		const { lane } = makeLane()
		const holder = await lane.acquireSlot("net-1", undefined)

		const waiting = lane.acquireSlot("net-1", "queued-2")
		const rejection = expect(waiting).rejects.toBeInstanceOf(JobCancelledSentinel)
		await flushMicrotasks()
		// The pre-acquire controller is registered under the queued id BEFORE
		// the wait — a user-cancel during the wait always finds it.
		expect(controllers(lane).has("queued-2")).toBe(true)

		await lane.cancelJob("queued-2")
		await rejection
		const sentinel = await waiting.catch((e) => e)
		expect((sentinel as JobCancelledSentinel).jobId).toBe("queued-2")
		expect(controllers(lane).has("queued-2")).toBe(false)

		// Lane stays usable: the cancelled waiter left the queue, so release
		// → next acquire grants normally.
		holder.release()
		const next = await lane.acquireSlot("net-1", undefined)
		next.release()
	})

	test("FIFO baton release point: onEnqueued fires while still waiting; grants stay ordered", async () => {
		const { lane } = makeLane()
		const holder = await lane.acquireSlot("net-1", undefined)

		const grants: string[] = []
		const onEnqueuedT2 = vi.fn()
		const t2 = lane.acquireSlot("net-1", undefined, onEnqueuedT2).then((g) => {
			grants.push("t2")
			return g
		})
		await flushMicrotasks()
		// The baton releases the moment we're enqueued — NOT at grant time.
		expect(onEnqueuedT2).toHaveBeenCalledTimes(1)
		expect(grants).toEqual([])

		const t3 = lane.acquireSlot("net-1", undefined).then((g) => {
			grants.push("t3")
			return g
		})
		await flushMicrotasks()

		holder.release()
		const g2 = await t2
		g2.release()
		const g3 = await t3
		g3.release()
		expect(grants).toEqual(["t2", "t3"])
	})

	test("capacity reject: journal → failed + TooManyPendingError, controller cleaned (adversarial-dApp backpressure)", async () => {
		const { lane, transitions } = makeLane()
		// Same network + same origin: holder (depth 1) + 7 waiters = origin
		// depth 8 (the cap). The 9th must capacity-reject.
		const holder = await lane.acquireSlot("net-1", undefined, undefined, "https://dapp.example")
		const waiters: Promise<unknown>[] = []
		for (let i = 0; i < 7; i++) {
			waiters.push(lane.acquireSlot("net-1", undefined, undefined, "https://dapp.example"))
		}
		await flushMicrotasks()

		await expect(lane.acquireSlot("net-1", "q9", undefined, "https://dapp.example")).rejects.toBeInstanceOf(TooManyPendingError)
		// The journal record terminalizes HERE (the caller's claim never runs):
		// same failed shape the silent path would otherwise leave stuck at pending.
		const failedCall = transitions.find((t) => t[0] === "q9")
		expect(failedCall?.[1]).toEqual({ stage: "failed" })
		expect(failedCall?.[2]).toMatchObject({ kind: "dapp_execute" })
		expect(controllers(lane).has("q9")).toBe(false)

		// Drain so nothing leaks into other tests.
		holder.release()
		for (const w of waiters) {
			const g = (await w) as { release: () => void }
			g.release()
		}
	})

	test("queued-wait heartbeat: fires every 30s while waiting, stops after grant (reaper-window)", async () => {
		vi.useFakeTimers()
		try {
			const { lane, touches, deps } = makeLane()
			const holder = await lane.acquireSlot("net-1", undefined)

			const waiting = lane.acquireSlot("net-1", "queued-hb")
			// Flush the pre-acquire awaits manually — fake timers don't gate
			// microtasks, but vi.waitFor would.
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()

			await vi.advanceTimersByTimeAsync(30_000)
			expect(touches).toContain("queued-hb")
			const touchesWhileQueued = touches.length
			await vi.advanceTimersByTimeAsync(30_000)
			expect(touches.length).toBeGreaterThan(touchesWhileQueued)

			// Grant: the waiter becomes the holder; the heartbeat MUST stop —
			// the reaper protection hands over to the holder's own stage
			// transitions (proving grace is 35 min).
			holder.release()
			const granted = (await waiting) as { release: () => void }
			const touchesAtGrant = touches.length
			await vi.advanceTimersByTimeAsync(120_000)
			expect(touches.length).toBe(touchesAtGrant)
			expect((deps.operationJournal.touchOperation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(touchesAtGrant)
			granted.release()
		} finally {
			vi.useRealTimers()
		}
	})

	test("mutex keys are (profileId, chainId)-scoped: different chains never contend", async () => {
		const { lane, deps } = makeLane({
			getNetwork: vi.fn(async (networkId: string) => ({ chainId: networkId === "net-1" ? 1 : 2 }) as never),
		})
		const a = await lane.acquireSlot("net-1", undefined)
		// Different chainId → different lane → grants immediately (would hang otherwise).
		const b = await lane.acquireSlot("net-2", undefined)
		a.release()
		b.release()
		expect(deps.getNetwork).toHaveBeenCalledTimes(2)
	})
})

describe("ExecutionLane.beginJournal fence threading", () => {
	test("with a fence: uses the AUTHORIZATION-time profileId+epoch, never re-reads the active profile", async () => {
		// After the FIFO wait the active profile can be a successor that reused
		// the deleted profile's id — re-capturing here would file the stale
		// operation into the wrong incarnation.
		const createOperation = vi.fn(async (input: unknown) => ({ id: "op-1", ...(input as object) }) as never)
		const { lane, deps } = makeLane({
			operationJournal: { createOperation } as never,
			getActiveProfile: vi.fn(async () => ({ id: "p2-successor" }) as never),
			captureProfileEpoch: vi.fn(() => 99),
		})

		const id = await lane.beginJournal("net-1", "0xacct", { type: 1, name: "dapp" } as never, undefined, {
			profileId: "p1",
			epoch: 0,
		})

		expect(id).toBe("op-1")
		expect(createOperation).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p1", profileEpoch: 0 }))
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
		expect(deps.captureProfileEpoch).not.toHaveBeenCalled()
	})

	test("without a fence: falls back to the active profile + a fresh epoch capture", async () => {
		const createOperation = vi.fn(async (input: unknown) => ({ id: "op-2", ...(input as object) }) as never)
		const { lane } = makeLane({
			operationJournal: { createOperation } as never,
			captureProfileEpoch: vi.fn(() => 3),
		})

		const id = await lane.beginJournal("net-1", "0xacct", { type: 1, name: "dapp" } as never)

		expect(id).toBe("op-2")
		expect(createOperation).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p1", profileEpoch: 3 }))
	})
})

describe("ExecutionLane.cancelJob ownership (ledger D6: profile is the sole principal)", () => {
	function makeOwnershipLane(opts: { activeProfile?: string; recordProfile?: string }) {
		const transitions: unknown[][] = []
		const harness = makeLane({
			getActiveProfile: vi.fn(async () => (opts.activeProfile ? ({ id: opts.activeProfile } as never) : undefined)),
			operationJournal: {
				getOperation: vi.fn(async () =>
					opts.recordProfile ? ({ id: "job-1", profileId: opts.recordProfile } as never) : undefined,
				),
				transitionOperation: vi.fn(async (...args: unknown[]) => {
					transitions.push(args)
					return {}
				}),
				touchOperation: vi.fn(async () => {}),
			} as never,
		})
		return { ...harness, transitions }
	}

	test("matching profile → cancels: transition + abort + controller removed", async () => {
		const { lane, transitions } = makeOwnershipLane({ activeProfile: "p1", recordProfile: "p1" })
		const controller = new AbortController()
		lane.registerController("job-1", controller)
		await lane.cancelJob("job-1")
		expect(transitions.find((t) => t[0] === "job-1")?.[1]).toEqual({ stage: "cancelled" })
		expect(controller.signal.aborted).toBe(true)
		expect(controllers(lane).has("job-1")).toBe(false)
	})

	test("foreign profile → silent drop: no transition, no abort (indistinguishable from unknown id)", async () => {
		const { lane, transitions } = makeOwnershipLane({ activeProfile: "p1", recordProfile: "p2" })
		const controller = new AbortController()
		lane.registerController("job-1", controller)
		await lane.cancelJob("job-1")
		expect(transitions).toEqual([])
		expect(controller.signal.aborted).toBe(false)
	})

	test("record absent → silent drop before any journal write", async () => {
		const { lane, transitions } = makeOwnershipLane({ activeProfile: "p1", recordProfile: undefined })
		await lane.cancelJob("ghost")
		expect(transitions).toEqual([])
	})

	test("locked wallet (no active profile) → silent drop, even for a real record", async () => {
		const { lane, transitions } = makeOwnershipLane({ activeProfile: undefined, recordProfile: "p1" })
		const controller = new AbortController()
		lane.registerController("job-1", controller)
		await lane.cancelJob("job-1")
		expect(transitions).toEqual([])
		expect(controller.signal.aborted).toBe(false)
	})
})

function queuedWaiters(lane: ExecutionLane): Map<string, number> {
	return (lane as unknown as { queuedWaiters: Map<string, number> }).queuedWaiters
}

describe("pre-claim wait heartbeat (N-07)", () => {
	test("a pre-claim waiter is touched across the queued grace without any acquireSlot call", async () => {
		vi.useFakeTimers()
		try {
			const { lane, touches } = makeLane()
			lane.beginQueuedWait("pre-1")
			await vi.advanceTimersByTimeAsync(30_000)
			expect(touches).toContain("pre-1")
			const count = touches.length
			await vi.advanceTimersByTimeAsync(10 * 60_000) // the whole queued grace
			expect(touches.length).toBeGreaterThan(count) // still vouched-for
			lane.endQueuedWait("pre-1")
		} finally {
			vi.useRealTimers()
		}
	})

	test("the lease expires: a waiter past the ceiling stops being touched and is removed; a younger one continues", async () => {
		vi.useFakeTimers()
		try {
			const { lane, touches } = makeLane()
			lane.beginQueuedWait("old")
			await vi.advanceTimersByTimeAsync(89 * 60_000) // just inside the 90-min ceiling
			expect(touches.filter((t) => t === "old").length).toBeGreaterThan(0)
			lane.beginQueuedWait("young")
			await vi.advanceTimersByTimeAsync(5 * 60_000) // crosses old's ceiling
			expect(queuedWaiters(lane).has("old")).toBe(false) // lease expired — removed
			const oldTouches = touches.filter((t) => t === "old").length
			await vi.advanceTimersByTimeAsync(60_000)
			expect(touches.filter((t) => t === "old").length).toBe(oldTouches) // never touched again
			expect(queuedWaiters(lane).has("young")).toBe(true) // younger waiter unaffected
			lane.endQueuedWait("young")
		} finally {
			vi.useRealTimers()
		}
	})

	test("ownership migrates at mutex enqueue: the queued entry vanishes, the execution wait takes over", async () => {
		const { lane } = makeLane()
		lane.beginQueuedWait("mig-1")
		expect(queuedWaiters(lane).has("mig-1")).toBe(true)
		const holder = await lane.acquireSlot("net-1", undefined)
		const waiting = lane.acquireSlot("net-1", "mig-1") // enqueue → migration
		await flushMicrotasks()
		expect(queuedWaiters(lane).has("mig-1")).toBe(false) // exactly one owner
		holder.release()
		const granted = (await waiting) as { release: () => void }
		granted.release()
	})

	test("a pre-acquire cancelJob prunes the queued waiter (cap-bypass growth closed)", async () => {
		const { lane, deps } = makeLane({
			operationJournal: {
				getOperation: vi.fn(async (id: string) => ({ id, profileId: "p1", progress: { stage: "queued" } }) as never),
				transitionOperation: vi.fn(async () => ({})),
				touchOperation: vi.fn(async () => {}),
			} as never,
		})
		lane.beginQueuedWait("cancel-1")
		expect(queuedWaiters(lane).has("cancel-1")).toBe(true)
		await lane.cancelJob("cancel-1") // no controller registered — pre-acquire
		expect(queuedWaiters(lane).has("cancel-1")).toBe(false)
		expect(deps.operationJournal.transitionOperation).toHaveBeenCalled()
	})
})
