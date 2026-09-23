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

	test("tab close leaves no orphaned marker (map hygiene until the TTL would reap it)", () => {
		const markers = new Map<string, PendingVerificationEntry>([["r1", entry()]])
		deletePendingVerificationForTab(markers, 7)
		// Request-keyed markers mean a reconnect NEVER reads a prior handshake's
		// entry regardless of deletion (new requestId) — this deletion is pure
		// hygiene so a closed tab's approval doesn't linger for the 90 s TTL.
		expect(markers.get("r1")).toBeUndefined()
	})
})
