/**
 * Unit tests for `markFailedUnlessCancelled` — the shared catch-arm disposition
 * extracted from the three dapp-send pipelines.
 *
 * Load-bearing behavior: (1) a `JobCancelledSentinel` must NOT be re-marked
 * `failed` (cancelJob already transitioned the journal to `cancelled`); (2) the
 * helper is SYNCHRONOUS — it throws the sentinel synchronously and returns
 * `markJournal`'s own promise, so the call site keeps the original microtask
 * timing (an `async` wrapper would delay the caller's `finally` by a microtask).
 */
import { describe, expect, test, vi } from "vitest"
import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"
import { markFailedUnlessCancelled } from "./mark-failed-unless-cancelled"

function fakeLane() {
	return {
		markJournal: vi.fn(async (_journalId: string | undefined, _progress: JobProgress, _error?: JobError | null) => {}),
	}
}

describe("markFailedUnlessCancelled", () => {
	test("on JobCancelledSentinel: throws SYNCHRONOUSLY (not a rejected promise) and does NOT mark failed", () => {
		const lane = fakeLane()
		const sentinel = new JobCancelledSentinel("op1")
		// Synchronous throw — proves there is no `async` wrapper. An async helper
		// would return a rejected promise instead, and `.toThrow()` would fail.
		// This is what keeps the caller's `finally` on the original microtask.
		expect(() => markFailedUnlessCancelled(sentinel, "op1", lane)).toThrow(sentinel)
		expect(lane.markJournal).not.toHaveBeenCalled()
	})

	test("on a generic error: marks the journal failed with a normalized dapp_execute error", async () => {
		const lane = fakeLane()
		const err = new Error("boom")
		await markFailedUnlessCancelled(err, "op2", lane)
		expect(lane.markJournal).toHaveBeenCalledTimes(1)
		const [jid, progress, jobError] = lane.markJournal.mock.calls[0]
		expect(jid).toBe("op2")
		expect(progress).toEqual({ stage: "failed" })
		expect(jobError).toEqual(normalizeError(err, "dapp_execute"))
	})

	test("returns markJournal's OWN promise verbatim (synchronous passthrough — no extra async layer)", () => {
		const marker = Promise.resolve()
		const lane = { markJournal: vi.fn(() => marker) }
		const returned = markFailedUnlessCancelled(new Error("x"), "op3", lane)
		expect(returned).toBe(marker)
	})

	test("passes an undefined journalId straight through (hoisted-but-unset case)", async () => {
		const lane = fakeLane()
		await markFailedUnlessCancelled(new Error("x"), undefined, lane)
		expect(lane.markJournal).toHaveBeenCalledWith(undefined, { stage: "failed" }, expect.anything())
	})
})
