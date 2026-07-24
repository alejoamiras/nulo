import { describe, expect, test } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { hasInFlightSend, isInFlightSend } from "./in-flight-send"

const op = (over: Partial<OperationRecord> & { stage?: string } = {}): OperationRecord => {
	const { stage = "pending", ...rest } = over
	return { kind: "transfer", profileId: "p1", progress: { stage }, ...rest } as OperationRecord
}

describe("isInFlightSend", () => {
	test("every pre-broadcast stage of a send counts as in flight", () => {
		for (const stage of ["queued", "pending", "simulating", "proving", "submitting"]) {
			expect(isInFlightSend(op({ stage })), stage).toBe(true)
		}
	})

	test("a finished send does not", () => {
		for (const stage of ["succeeded", "failed", "cancelled"]) {
			expect(isInFlightSend(op({ stage })), stage).toBe(false)
		}
	})

	test("only kinds that actually send count", () => {
		expect(isInFlightSend(op({ kind: "dapp_execute" as never }))).toBe(true)
		// A token import journals an operation but broadcasts nothing.
		expect(isInFlightSend(op({ kind: "token_import" as never }))).toBe(false)
	})
})

describe("hasInFlightSend", () => {
	test("true while this profile has a send under way", () => {
		expect(hasInFlightSend([op({ stage: "proving" })], "p1")).toBe(true)
	})

	test("another profile's send does not block this one", () => {
		expect(hasInFlightSend([op({ profileId: "p2", stage: "proving" })], "p1")).toBe(false)
	})

	test("false once every send has finished", () => {
		expect(hasInFlightSend([op({ stage: "succeeded" }), op({ stage: "cancelled" })], "p1")).toBe(false)
	})

	test("false with nothing journaled, or with no profile resolved yet", () => {
		expect(hasInFlightSend([], "p1")).toBe(false)
		expect(hasInFlightSend([op({ stage: "proving" })], undefined)).toBe(false)
	})

	test("one in-flight send among finished ones still blocks", () => {
		const ops = [op({ stage: "succeeded" }), op({ stage: "queued" }), op({ stage: "failed" })]
		expect(hasInFlightSend(ops, "p1")).toBe(true)
	})
})
