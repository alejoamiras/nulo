import { describe, expect, test } from "vitest"

import { IllegalTransitionError, JobCancelledSentinel, assertCanTransition, canTransition } from "./fsm"
import { TERMINAL_STAGES, isTerminal, type JobStage } from "./types"

describe("job FSM", () => {
	test("legal transitions match the documented graph", () => {
		const legalEdges: ReadonlyArray<[JobStage, JobStage]> = [
			// queued is the pre-execution holding stage; claim path is
			// queued → pending. Early-error / user-cancel-while-queued
			// paths complete via queued → failed | cancelled.
			["queued", "pending"],
			["queued", "failed"],
			["queued", "cancelled"],
			["pending", "simulating"],
			["simulating", "proving"],
			["proving", "submitting"],
			["submitting", "succeeded"],
			// Phase 2.5: no-prove shortcut for token_import (and future
			// non-tx imports). Kind ↔ txHash invariant is enforced at the
			// journal-service boundary, not the FSM.
			["simulating", "succeeded"],
			// any active stage can short-circuit to failed or cancelled
			["pending", "failed"],
			["pending", "cancelled"],
			["simulating", "failed"],
			["simulating", "cancelled"],
			["proving", "failed"],
			["proving", "cancelled"],
			["submitting", "failed"],
			// "submitting" intentionally has NO cancel edge — see below.
		]

		for (const [from, to] of legalEdges) {
			expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
		}
	})

	test("illegal transitions are rejected (including all terminal outgoing edges)", () => {
		const illegalEdges: ReadonlyArray<[JobStage, JobStage]> = [
			// queued must pass through pending — no stage skipping.
			["queued", "simulating"],
			["queued", "proving"],
			["queued", "submitting"],
			["queued", "succeeded"],
			// no back-edges into queued either.
			["pending", "queued"],
			["simulating", "queued"],
			["proving", "queued"],
			// no back-edges
			["simulating", "pending"],
			["proving", "simulating"],
			["submitting", "proving"],
			// no stage skipping
			["pending", "proving"],
			["pending", "submitting"],
			["pending", "succeeded"],
			["simulating", "submitting"],
			// no resurrection from terminal
			["succeeded", "proving"],
			["failed", "pending"],
			["cancelled", "submitting"],
			["succeeded", "failed"],
			// submit is the point-of-no-return: cancel during submitting is
			// rejected by the FSM and the in-flight tx is allowed to settle
			// naturally. See `cancelJob` in ExecutionService for the caller-
			// side drop logic.
			["submitting", "cancelled"],
		]

		for (const [from, to] of illegalEdges) {
			expect(canTransition(from, to), `${from} → ${to}`).toBe(false)
		}
	})

	test("assertCanTransition throws IllegalTransitionError with from/to captured", () => {
		try {
			assertCanTransition("succeeded", "proving")
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(IllegalTransitionError)
			expect((err as IllegalTransitionError).from).toBe("succeeded")
			expect((err as IllegalTransitionError).to).toBe("proving")
		}
	})

	test("JobCancelledSentinel carries the jobId and is identifiable via instanceof", () => {
		const err = new JobCancelledSentinel("abc123")
		expect(err).toBeInstanceOf(JobCancelledSentinel)
		expect(err).toBeInstanceOf(Error)
		expect(err.jobId).toBe("abc123")
		expect(err.name).toBe("JobCancelledSentinel")
		expect(err.message).toContain("abc123")
	})

	test("isTerminal identifies exactly the three terminal stages", () => {
		expect([...TERMINAL_STAGES].sort()).toEqual(["cancelled", "failed", "succeeded"])
		expect(isTerminal("succeeded")).toBe(true)
		expect(isTerminal("failed")).toBe(true)
		expect(isTerminal("cancelled")).toBe(true)
		expect(isTerminal("pending")).toBe(false)
		expect(isTerminal("simulating")).toBe(false)
		expect(isTerminal("proving")).toBe(false)
		expect(isTerminal("submitting")).toBe(false)
	})
})
