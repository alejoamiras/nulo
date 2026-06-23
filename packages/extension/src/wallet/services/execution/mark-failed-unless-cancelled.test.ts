/**
 * Unit tests for `markFailedUnlessCancelled` — the shared catch-arm disposition
 * extracted from the three dapp-send pipelines.
 *
 * The load-bearing behavior: a `JobCancelledSentinel` must NOT be re-marked
 * `failed` (cancelJob already transitioned the journal to `cancelled`), and the
 * original error is always returned so the caller rethrows it verbatim.
 */
import { describe, expect, test, vi } from "vitest"
import { type JobError, type JobProgress, JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { markFailedUnlessCancelled } from "./mark-failed-unless-cancelled"

function fakeLane() {
	return {
		markJournal: vi.fn(async (_journalId: string | undefined, _progress: JobProgress, _error?: JobError | null) => {}),
	}
}

describe("markFailedUnlessCancelled", () => {
	test("on JobCancelledSentinel: does NOT mark failed (journal already cancelled), returns the error", async () => {
		const lane = fakeLane()
		const sentinel = new JobCancelledSentinel("op1")
		const returned = await markFailedUnlessCancelled(sentinel, "op1", lane)
		expect(lane.markJournal).not.toHaveBeenCalled()
		expect(returned).toBe(sentinel)
	})

	test("on a generic error: marks the journal failed with a normalized dapp_execute error, returns the error", async () => {
		const lane = fakeLane()
		const err = new Error("boom")
		const returned = await markFailedUnlessCancelled(err, "op2", lane)
		expect(lane.markJournal).toHaveBeenCalledTimes(1)
		const [jid, progress, jobError] = lane.markJournal.mock.calls[0]
		expect(jid).toBe("op2")
		expect(progress).toEqual({ stage: "failed" })
		expect(jobError).toBeTruthy()
		expect(returned).toBe(err)
	})

	test("passes an undefined journalId straight through (hoisted-but-unset case)", async () => {
		const lane = fakeLane()
		const err = new Error("x")
		const returned = await markFailedUnlessCancelled(err, undefined, lane)
		expect(lane.markJournal).toHaveBeenCalledWith(undefined, { stage: "failed" }, expect.anything())
		expect(returned).toBe(err)
	})
})
