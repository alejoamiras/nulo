import { describe, expect, test } from "vitest"
import {
	deletePendingVerificationForTab,
	isPendingVerificationStale,
	PENDING_VERIFICATION_STALE_MS,
	type PendingVerificationEntry,
} from "./pending-verification"

const entry = (over: Partial<PendingVerificationEntry> = {}): PendingVerificationEntry => ({
	at: 1_000_000,
	profileId: "prof-A",
	tabId: 7,
	...over,
})

describe("pending-verification marker", () => {
	test("staleness is a strict window off the write stamp", () => {
		expect(isPendingVerificationStale(entry(), 1_000_000 + PENDING_VERIFICATION_STALE_MS)).toBe(false)
		expect(isPendingVerificationStale(entry(), 1_000_000 + PENDING_VERIFICATION_STALE_MS + 1)).toBe(true)
	})

	test("tab teardown deletes exactly that tab's markers (the mid-ECDH leak fix)", () => {
		const markers = new Map<string, PendingVerificationEntry>([
			["r1", entry({ tabId: 7 })],
			["r2", entry({ tabId: 7, profileId: "prof-B" })],
			["r3", entry({ tabId: 9 })],
		])
		deletePendingVerificationForTab(markers, 7)
		expect([...markers.keys()]).toEqual(["r3"])
	})

	test("an immediate reconnect after tab close reads a clean set (no 90 s poisoning)", () => {
		const markers = new Map<string, PendingVerificationEntry>([["r1", entry()]])
		deletePendingVerificationForTab(markers, 7)
		// The reconnect's establishment sees NO marker → trusted-reconnect
		// branch, no spurious re-verification.
		expect(markers.get("r1")).toBeUndefined()
	})
})
