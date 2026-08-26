import { describe, expect, test, vi } from "vitest"
import { DuplicateInitializationError, JobCancelledError, TooManyPendingError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { classifyOperationCatch, maybeRethrowAsRpcCancel } from "./rpc-cancel"

describe("maybeRethrowAsRpcCancel", () => {
	test("sentinel → task.cancel() + throws JobCancelledError carrying jobId", () => {
		// Pin: the SW catch must (a) mark the task cancelled, not failed,
		// and (b) emit a structurally typed error so the popup's
		// `instanceof JobCancelledError` works after RPC round-trip.
		const task = { cancel: vi.fn(), fail: vi.fn() }
		try {
			maybeRethrowAsRpcCancel(new JobCancelledSentinel("job-abc"), task)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(JobCancelledError)
			expect((err as JobCancelledError).details).toMatchObject({ jobId: "job-abc" })
		}
		expect(task.cancel).toHaveBeenCalledOnce()
		expect(task.fail).not.toHaveBeenCalled()
	})

	test("non-sentinel error → returns without touching the task", () => {
		// Regression pin: a real failure must NOT be misclassified as a cancel.
		// Without this branch, every error would mark the task cancelled and
		// the journal terminal card would say "Cancelled" for genuine failures.
		const task = { cancel: vi.fn(), fail: vi.fn() }
		expect(() => maybeRethrowAsRpcCancel(new Error("simulation failed"), task)).not.toThrow()
		expect(task.cancel).not.toHaveBeenCalled()
		expect(task.fail).not.toHaveBeenCalled()
	})
})

describe("classifyOperationCatch", () => {
	const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

	test("sentinel → task.cancel() + cancelled result with jobId + reason=user", () => {
		// Codex SHOULD#1 — task lifecycle must match result variant. Pin
		// that cancelled never silently calls task.fail().
		const task = { cancel: vi.fn(), fail: vi.fn() }
		const result = classifyOperationCatch(new JobCancelledSentinel("job-1"), task, errorMessage)
		expect(result).toEqual({ status: "cancelled", jobId: "job-1", reason: "user" })
		expect(task.cancel).toHaveBeenCalledOnce()
		expect(task.fail).not.toHaveBeenCalled()
	})

	test("non-sentinel error → task.fail() + failed result with stringified error", () => {
		// Codex regression pin: real failures keep going through task.fail.
		// If this regresses, every failure would silently become cancelled.
		const task = { cancel: vi.fn(), fail: vi.fn() }
		const err = new Error("network unreachable")
		const result = classifyOperationCatch(err, task, errorMessage)
		expect(result).toEqual({ status: "failed", error: "network unreachable", code: undefined })
		expect(task.fail).toHaveBeenCalledWith(err)
		expect(task.cancel).not.toHaveBeenCalled()
	})

	test("(N-15) DuplicateInitializationError rides the code channel", () => {
		const task = { cancel: vi.fn(), fail: vi.fn() }
		const result = classifyOperationCatch(new DuplicateInitializationError(), task, errorMessage)
		expect(result.status).toBe("failed")
		expect((result as { code?: string }).code).toBe("DUPLICATE_INITIALIZATION")
	})

	test("(N-15) OTHER WalletError subclasses do NOT ride the code channel (unsound reconstruction guard)", () => {
		// TooManyPendingError deliberately reconstructs as base WalletError and
		// detail-dependent classes lose details through the message-only
		// channel — a blanket pass-through would silently corrupt them.
		const task = { cancel: vi.fn(), fail: vi.fn() }
		const result = classifyOperationCatch(new TooManyPendingError(), task, errorMessage)
		expect(result.status).toBe("failed")
		expect((result as { code?: string }).code).toBeUndefined()
	})
})
