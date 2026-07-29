import { describe, expect, test } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { hasInFlightSend, isInFlightSend } from "./in-flight-send"

const op = (over: Partial<OperationRecord> & { stage?: string } = {}): OperationRecord => {
	const { stage = "pending", ...rest } = over
	return { kind: "transfer", profileId: "p1", accountAddress: "0xa", networkId: "n1", progress: { stage }, ...rest } as OperationRecord
}

/** The scope the user is looking at. */
const VIEWING = { profileId: "p1", accountAddress: "0xa", networkId: "n1" }

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
		expect(hasInFlightSend([op({ stage: "proving" })], VIEWING)).toBe(true)
	})

	test("a send on another account does not block the account being viewed", () => {
		// The cancel card renders for the active account, so a block over a record
		// the user cannot see would be a hold they cannot release.
		expect(hasInFlightSend([op({ accountAddress: "0xb", stage: "proving" })], VIEWING)).toBe(false)
	})

	test("another profile's send does not block this one", () => {
		expect(hasInFlightSend([op({ profileId: "p2", stage: "proving" })], VIEWING)).toBe(false)
	})

	test("false once every send has finished", () => {
		expect(hasInFlightSend([op({ stage: "succeeded" }), op({ stage: "cancelled" })], VIEWING)).toBe(false)
	})

	test("false with nothing journaled, or with no profile resolved yet", () => {
		expect(hasInFlightSend([], VIEWING)).toBe(false)
		expect(hasInFlightSend([op({ stage: "proving" })], { ...VIEWING, profileId: undefined })).toBe(false)
	})

	test("one in-flight send among finished ones still blocks", () => {
		const ops = [op({ stage: "succeeded" }), op({ stage: "queued" }), op({ stage: "failed" })]
		expect(hasInFlightSend(ops, VIEWING)).toBe(true)
	})
})
