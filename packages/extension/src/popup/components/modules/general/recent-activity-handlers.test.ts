import { describe, expect, test, vi } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { ContentKind } from "@/wallet/services/task/spec"
import { buildCancelHandler, isMatchingTask } from "./recent-activity-handlers"

function makeOp(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return {
		id: "abc123",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		progress: { stage: "failed" },
		error: null,
		terminalAt: 1,
		attempts: 0,
		createdAt: 0,
		updatedAt: 1,
		tokenId: 42,
		accountAddress: "0xabc",
		...overrides,
	}
}

describe("buildCancelHandler", () => {
	test("calls execution.cancelJob with the jobId passed by the emit", () => {
		const cancelJob = vi.fn().mockResolvedValue(undefined)
		const handler = buildCancelHandler({ cancelJob })

		handler("abc123")

		expect(cancelJob).toHaveBeenCalledTimes(1)
		expect(cancelJob).toHaveBeenCalledWith("abc123")
	})

	test("no-op when jobId is null / undefined / empty (defensive — the card hides the button in this case)", () => {
		const cancelJob = vi.fn().mockResolvedValue(undefined)
		const handler = buildCancelHandler({ cancelJob })

		handler(null)
		handler(undefined)
		handler("")

		expect(cancelJob).not.toHaveBeenCalled()
	})

	test("second card cancels its own id (no cross-talk with another card's id)", () => {
		// Pins the regression the captured-top-op API caused: with N cards in
		// flight, clicking Cancel on card B used to cancel whatever the "top"
		// op was. The jobId payload from each card's emit eliminates that race.
		const cancelJob = vi.fn().mockResolvedValue(undefined)
		const handler = buildCancelHandler({ cancelJob })

		handler("first") // simulate click on card A
		handler("second") // simulate click on card B

		expect(cancelJob).toHaveBeenNthCalledWith(1, "first")
		expect(cancelJob).toHaveBeenNthCalledWith(2, "second")
	})

	test("swallows rejection from cancelJob (FSM-rejected race; intended silent unwind)", async () => {
		const cancelJob = vi.fn().mockRejectedValue(new Error("submitting → cancelled is illegal"))
		const handler = buildCancelHandler({ cancelJob })

		expect(() => handler("abc123")).not.toThrow()
		await new Promise((r) => setTimeout(r, 0))
	})

	test("invokes onInitiated(jobId) before cancelJob (cancel-dupe ID-correlation pin)", () => {
		const cancelJob = vi.fn().mockResolvedValue(undefined)
		const onInitiated = vi.fn()
		const handler = buildCancelHandler({ cancelJob }, onInitiated)

		handler("pin-me")

		expect(onInitiated).toHaveBeenCalledWith("pin-me")
		expect(cancelJob).toHaveBeenCalledWith("pin-me")
	})

	test("onInitiated is NOT called when jobId is missing (no jobId to pin)", () => {
		const cancelJob = vi.fn().mockResolvedValue(undefined)
		const onInitiated = vi.fn()
		const handler = buildCancelHandler({ cancelJob }, onInitiated)

		handler(null)

		expect(onInitiated).not.toHaveBeenCalled()
		expect(cancelJob).not.toHaveBeenCalled()
	})
})

// Phase 2 follow-up v4 — cancel-dupe match logic.
describe("isMatchingTask", () => {
	const transferTask = { content: { kind: ContentKind.Transfer, tokenId: 42 } }
	const executeTask = { content: { kind: ContentKind.ExecuteOperation, operationKind: "send_transaction" } }

	test("transfer + matching tokenId + matching account → match", () => {
		expect(isMatchingTask(transferTask, makeOp({ kind: "transfer", tokenId: 42 }), "0xabc")).toBe(true)
	})

	test("transfer + mismatched tokenId → no match (different transfer in flight)", () => {
		expect(isMatchingTask(transferTask, makeOp({ kind: "transfer", tokenId: 99 }), "0xabc")).toBe(false)
	})

	test("dapp_execute kind on both → match (kind-only heuristic; see docs)", () => {
		expect(isMatchingTask(executeTask, makeOp({ kind: "dapp_execute" }), "0xabc")).toBe(true)
	})

	test("account mismatch → no match (cross-account safety)", () => {
		expect(isMatchingTask(transferTask, makeOp({ kind: "transfer", tokenId: 42, accountAddress: "0xother" }), "0xabc")).toBe(false)
	})

	test("kind mismatch (transfer task, dapp_execute op) → no match", () => {
		expect(isMatchingTask(transferTask, makeOp({ kind: "dapp_execute" }), "0xabc")).toBe(false)
	})

	test("null task or op → no match (defensive)", () => {
		expect(isMatchingTask(null, makeOp(), "0xabc")).toBe(false)
		expect(isMatchingTask(transferTask, null as never, "0xabc")).toBe(false)
	})
})
