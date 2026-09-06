import { describe, expect, test, vi } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { ContentKind } from "@/wallet/services/task/spec"
import { TxStatus } from "@/wallet/services/transaction/spec"
import {
	buildCancelHandler,
	buildFocusHandler,
	filterPendingDoubleRender,
	isMatchingTask,
	type MinimalChainTx,
} from "./recent-activity-handlers"

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

describe("buildFocusHandler", () => {
	test("calls focusInteractionWindow with the jobId passed by the emit", () => {
		const focusInteractionWindow = vi.fn().mockResolvedValue(true)
		buildFocusHandler({ focusInteractionWindow })("abc123")
		expect(focusInteractionWindow).toHaveBeenCalledWith("abc123")
	})

	test("a falsy jobId is a no-op", () => {
		const focusInteractionWindow = vi.fn().mockResolvedValue(true)
		const handler = buildFocusHandler({ focusInteractionWindow })
		handler(null)
		handler(undefined)
		handler("")
		expect(focusInteractionWindow).not.toHaveBeenCalled()
	})

	test("a rejecting RPC is swallowed (the click is a courtesy)", async () => {
		const focusInteractionWindow = vi.fn().mockRejectedValue(new Error("disconnected"))
		expect(() => buildFocusHandler({ focusInteractionWindow })("abc123")).not.toThrow()
		await new Promise((r) => setTimeout(r, 0))
		expect(focusInteractionWindow).toHaveBeenCalledTimes(1)
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

// Disappearing-card regression: T1 transitions to `succeeded` while T2 is
// still in-flight; T1's pending chain tx must remain visible so the user
// keeps seeing the row until the chain tx confirms. v2 Layer A made this
// live coverage — the runtime now populates `submitting.txHash` at all four
// execution-service call sites, and `RecentActivityView.filteredRecentTransactions`
// uses this helper directly (no blanket fallback).
describe("filterPendingDoubleRender", () => {
	const t1Hash = "0xtxhash1"
	const t2Hash = "0xtxhash2"

	function tx(hash: string, status: TxStatus): MinimalChainTx {
		return { hash, status }
	}

	test("pending chain tx with no in-flight journal matches → stays visible", () => {
		const txs = [tx(t1Hash, TxStatus.Pending)]
		expect(filterPendingDoubleRender(txs, []).map((t) => t.hash)).toEqual([t1Hash])
	})

	test("pending chain tx that matches a `submitting` journal op → suppressed", () => {
		const txs = [tx(t1Hash, TxStatus.Pending)]
		const inFlight = [makeOp({ id: "j1", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting", txHash: t1Hash } })]
		expect(filterPendingDoubleRender(txs, inFlight)).toEqual([])
	})

	test("pending T1 chain tx stays visible when T2 is queued (T2 has no txHash) — the lost-card pin", () => {
		const txs = [tx(t1Hash, TxStatus.Pending)]
		const inFlight = [
			makeOp({
				id: "j2",
				kind: "dapp_execute",
				terminalAt: null,
				progress: { stage: "queued" },
				sessionId: "s1",
			}),
		]
		expect(filterPendingDoubleRender(txs, inFlight).map((t) => t.hash)).toEqual([t1Hash])
	})

	test("pending T1 chain tx stays visible when T2 is proving (no txHash yet) — covers the user-reported gap", () => {
		// Mirrors the QA-reported sequence: T1 succeeded, T2 still proving.
		// T1's pending chain tx must keep T1 on screen until it confirms.
		const txs = [tx(t1Hash, TxStatus.Pending)]
		const inFlight = [makeOp({ id: "j2", kind: "dapp_execute", terminalAt: null, progress: { stage: "proving", enteredProveAt: 0 } })]
		expect(filterPendingDoubleRender(txs, inFlight).map((t) => t.hash)).toEqual([t1Hash])
	})

	test("submitting-stage journal records WITHOUT txHash don't suppress anything", () => {
		// `submitting.txHash` is optional in the schema. A record between FSM
		// entry and txHash population should NOT swallow unrelated pending txs.
		const txs = [tx(t1Hash, TxStatus.Pending)]
		const inFlight = [makeOp({ id: "j1", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting" } })]
		expect(filterPendingDoubleRender(txs, inFlight).map((t) => t.hash)).toEqual([t1Hash])
	})

	test("non-pending chain txs are always visible regardless of in-flight set", () => {
		// Use any non-Pending status (Proposed, Proven, Finalized). The
		// filter only acts on Pending.
		const txs = [tx(t1Hash, TxStatus.Proven), tx(t2Hash, TxStatus.Finalized)]
		const inFlight = [makeOp({ id: "j1", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting", txHash: t1Hash } })]
		// t1Hash matches but its chain tx is Proven, not Pending, so it stays.
		expect(
			filterPendingDoubleRender(txs, inFlight)
				.map((t) => t.hash)
				.sort(),
		).toEqual([t1Hash, t2Hash].sort())
	})

	test("multi-record in-flight set suppresses only the matching pending tx", () => {
		const txs = [tx(t1Hash, TxStatus.Pending), tx(t2Hash, TxStatus.Pending)]
		const inFlight = [
			makeOp({ id: "j1", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting", txHash: t1Hash } }),
			makeOp({ id: "j2", kind: "dapp_execute", terminalAt: null, progress: { stage: "queued" }, sessionId: "s1" }),
		]
		expect(filterPendingDoubleRender(txs, inFlight).map((t) => t.hash)).toEqual([t2Hash])
	})

	test("two concurrent journal records both at `submitting` → both matching pending chain txs suppressed", () => {
		// v2 Layer A: covers the multi-pending case the pre-v2 blanket-suppress
		// was masking. Two concurrent sendTx ops each reach `submitting` (each
		// carrying its own canonical txHash). Both matching pending chain txs
		// must be suppressed; non-matching chain txs stay visible.
		const t3Hash = "0xtxhash3"
		const txs = [tx(t1Hash, TxStatus.Pending), tx(t2Hash, TxStatus.Pending), tx(t3Hash, TxStatus.Pending)]
		const inFlight = [
			makeOp({ id: "j1", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting", txHash: t1Hash } }),
			makeOp({ id: "j2", kind: "dapp_execute", terminalAt: null, progress: { stage: "submitting", txHash: t2Hash } }),
		]
		expect(filterPendingDoubleRender(txs, inFlight).map((t) => t.hash)).toEqual([t3Hash])
	})
})
