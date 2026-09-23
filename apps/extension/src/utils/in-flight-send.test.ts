import { describe, expect, test } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { approvedSendsInFlight, hasInFlightSend, isApprovedSendInFlight, isInFlightSend } from "./in-flight-send"

const op = (over: Partial<OperationRecord> & { stage?: string } = {}): OperationRecord => {
	const { stage = "pending", ...rest } = over
	return {
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		accountAddress: "0xa",
		networkId: "n1",
		progress: { stage },
		...rest,
	} as OperationRecord
}

/** A dApp's send, as the lane journals it: a `dapp_execute` the popup never started. */
const dappSend = (over: Partial<OperationRecord> & { stage?: string } = {}) => op({ kind: "dapp_execute", origin: "dapp", ...over })

/** The scope the user is looking at. */
const VIEWING = { profileId: "p1", accountAddress: "0xa", networkId: "n1" }

describe("isInFlightSend", () => {
	test("every pre-broadcast stage of a popup send counts as in flight", () => {
		for (const stage of ["queued", "pending", "simulating", "proving", "submitting"]) {
			expect(isInFlightSend(op({ stage })), stage).toBe(true)
		}
	})

	test("a finished send does not", () => {
		for (const stage of ["succeeded", "failed", "cancelled"]) {
			expect(isInFlightSend(op({ stage })), stage).toBe(false)
		}
	})

	test("a send the popup did not start never counts, whatever its kind", () => {
		for (const stage of ["queued", "pending", "simulating", "proving", "submitting"]) {
			expect(isInFlightSend(dappSend({ stage })), stage).toBe(false)
		}
		// A wallet-initiated send journaled through the lane carries the lane's origin, not the popup's.
		expect(isInFlightSend(dappSend({ stage: "proving", subtitle: "Nulo" }))).toBe(false)
		expect(isInFlightSend(op({ origin: "seed", stage: "proving" }))).toBe(false)
	})

	test("only kinds that actually send count", () => {
		// A token import journals an operation but broadcasts nothing.
		expect(isInFlightSend(op({ kind: "token_import" as never }))).toBe(false)
	})
})

describe("isApprovedSendInFlight", () => {
	test("counts a dApp's send as well as the popup's: a lock cancels both", () => {
		expect(isApprovedSendInFlight(dappSend({ stage: "proving" }))).toBe(true)
		expect(isApprovedSendInFlight(op({ stage: "proving" }))).toBe(true)
		expect(isApprovedSendInFlight(dappSend({ stage: "queued" }))).toBe(false)
	})
})

describe("hasInFlightSend", () => {
	test("true while this profile has a popup send under way", () => {
		expect(hasInFlightSend([op({ stage: "proving" })], VIEWING)).toBe(true)
	})

	test("a dApp's send in the viewed scope does not block", () => {
		expect(hasInFlightSend([dappSend({ stage: "proving" })], VIEWING)).toBe(false)
	})

	test("popup and dApp sends side by side block iff the popup's is in flight", () => {
		expect(hasInFlightSend([dappSend({ stage: "proving" }), op({ stage: "queued" })], VIEWING)).toBe(true)
		expect(hasInFlightSend([dappSend({ stage: "proving" }), op({ stage: "succeeded" })], VIEWING)).toBe(false)
	})

	test("a send on another account does not block the account being viewed", () => {
		// The cancel card renders for the active account, so a block over a record
		// the user cannot see would be a hold they cannot release.
		expect(hasInFlightSend([op({ accountAddress: "0xb", stage: "proving" })], VIEWING)).toBe(false)
	})

	test("another profile's send does not block this one", () => {
		expect(hasInFlightSend([op({ profileId: "p2", stage: "proving" })], VIEWING)).toBe(false)
	})

	test("a send on another network does not block; one without a network does", () => {
		expect(hasInFlightSend([op({ networkId: "n2", stage: "proving" })], VIEWING)).toBe(false)
		expect(hasInFlightSend([op({ networkId: undefined, stage: "proving" })], VIEWING)).toBe(true)
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

describe("approvedSendsInFlight", () => {
	test("counts the profile's sends past approval and before submitting, on every account and from any origin", () => {
		const ops = [
			op({ stage: "pending" }),
			op({ stage: "simulating", accountAddress: "0xb" }),
			dappSend({ stage: "proving", accountAddress: "0xc", networkId: "n2" }),
		]
		expect(approvedSendsInFlight(ops, "p1")).toBe(3)
	})

	test("a queued request, a send at submitting, a finished send, a token import and another profile's send do not count", () => {
		const ops = [
			op({ stage: "queued" }),
			op({ stage: "submitting" }),
			op({ stage: "succeeded" }),
			op({ stage: "proving", kind: "token_import" as never }),
			op({ stage: "proving", profileId: "p2" }),
		]
		expect(approvedSendsInFlight(ops, "p1")).toBe(0)
		expect(approvedSendsInFlight([op({ stage: "proving" })], undefined)).toBe(0)
	})
})
