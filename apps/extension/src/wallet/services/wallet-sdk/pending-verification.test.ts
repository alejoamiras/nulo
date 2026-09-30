import { describe, expect, test } from "vitest"
import {
	cancelPendingVerification,
	consumePendingVerification,
	deletePendingVerificationForTab,
	isPendingVerificationDead,
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

	test("cancelling tombstones an existing marker in place and creates none for an absent id", () => {
		const fresh = entry()
		const markers = new Map<string, PendingVerificationEntry>([["r1", fresh]])
		cancelPendingVerification(markers, "r1")
		cancelPendingVerification(markers, "absent")
		expect(markers.get("r1")).toBe(fresh)
		expect(fresh.cancelled).toBe(true)
		expect([...markers.keys()]).toEqual(["r1"])
	})

	test("a cancelled or stale marker is dead; a fresh one is not", () => {
		const now = 1_000_000 + PENDING_VERIFICATION_STALE_MS
		expect(isPendingVerificationDead(entry(), now)).toBe(false)
		expect(isPendingVerificationDead(entry({ cancelled: true }), now)).toBe(true)
		expect(isPendingVerificationDead(entry(), now + 1)).toBe(true)
	})

	test("consuming deletes a live or stale marker and keeps a tombstone", () => {
		const markers = new Map<string, PendingVerificationEntry>([
			["live", entry()],
			["stale", entry({ at: 0 })],
			["dead", entry({ cancelled: true })],
		])
		for (const id of ["live", "stale", "dead", "absent"]) consumePendingVerification(markers, id)
		expect([...markers.keys()]).toEqual(["dead"])
	})

	test("tab teardown deletes the tab's tombstones too", () => {
		const markers = new Map<string, PendingVerificationEntry>([
			["r1", entry()],
			["r2", entry({ tabId: 9 })],
		])
		cancelPendingVerification(markers, "r1")
		deletePendingVerificationForTab(markers, 7)
		expect([...markers.keys()]).toEqual(["r2"])
	})
})
