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
		createFreshRecord: vi.fn(async () => "fresh-id"),
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

describe("ExecutionLane.cancelJob ownership", () => {
	test("(BUG PIN — replaced in Phase 1) cancels jobs regardless of profile ownership", async () => {
		// Current behavior: any caller with any journal id can cancel any
		// in-flight job — no profile check. Phase 1 of the authwit-lifecycle
		// arc deliberately replaces this with a profile-scoped silent no-op
		// (plan ledger D6: the profile is the sole security principal).
		const { lane, transitions } = makeLane({
			// Active profile is p1; the record under cancel belongs to p2.
			getActiveProfile: vi.fn(async () => ({ id: "p1" }) as never),
		})
		const controller = new AbortController()
		lane.registerController("foreign-job", controller)
		await lane.cancelJob("foreign-job")
		expect(transitions.find((t) => t[0] === "foreign-job")?.[1]).toEqual({ stage: "cancelled" })
		expect(controller.signal.aborted).toBe(true)
	})
})
