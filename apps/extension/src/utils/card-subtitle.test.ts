/**
 * Plan v6 §Tests #31-#32: the `stage` → subtitle mapping used by the
 * in-flight `TransactionAwaitingCard`. Tests pin the visible string for
 * each non-terminal stage so a regression that drops a case becomes a
 * loud failure rather than silently displaying "Processing...".
 */
import { describe, expect, test } from "vitest"
import { stageSubtitle } from "./card-subtitle"

describe("stageSubtitle", () => {
	test("queued → 'Queued...' (the wallet-sdk message-arrival state)", () => {
		expect(stageSubtitle("queued")).toBe("Queued...")
	})

	test("pending → 'Preparing...'", () => {
		expect(stageSubtitle("pending")).toBe("Preparing...")
	})

	test("simulating → 'Simulating...'", () => {
		expect(stageSubtitle("simulating")).toBe("Simulating...")
	})

	test("proving → 'Generating proof...'", () => {
		expect(stageSubtitle("proving")).toBe("Generating proof...")
	})

	test("submitting → 'Submitting...'", () => {
		expect(stageSubtitle("submitting")).toBe("Submitting...")
	})

	test("terminal stages fall through to defensive 'Processing...' fallback", () => {
		// Terminal stages shouldn't reach the in-flight card surface, but the
		// fallback prevents an empty string slipping through.
		expect(stageSubtitle("succeeded")).toBe("Processing...")
		expect(stageSubtitle("failed")).toBe("Processing...")
		expect(stageSubtitle("cancelled")).toBe("Processing...")
	})

	test("undefined → 'Processing...' (defensive fallback)", () => {
		expect(stageSubtitle(undefined)).toBe("Processing...")
	})

	test("queued-transition order: stage sequence reads chronologically", () => {
		// Sanity pin: the subtitles should describe a chronological pipeline
		// (queued → preparing → simulating → generating → submitting). If a
		// future refactor reorders the FSM, this verbal sequence becomes the
		// failing reminder to update the UX too.
		const pipeline = ["queued", "pending", "simulating", "proving", "submitting"] as const
		const labels = pipeline.map(stageSubtitle)
		expect(labels).toEqual(["Queued...", "Preparing...", "Simulating...", "Generating proof...", "Submitting..."])
	})
})
