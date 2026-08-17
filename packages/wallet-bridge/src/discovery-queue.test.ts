import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core/logger"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DISCOVERY_STALE_MS, DiscoveryQueue, isDiscoveryExpired } from "./discovery-queue"

const noopLogger: ILogger = { log: () => {} }

// `updateBadge()` calls `chrome.action.*` — provide a minimal stub.
beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the badge
	;(globalThis as any).chrome = {
		action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
	}
})

function makeHandler(pending: (id: string) => PendingDiscovery | undefined): BackgroundConnectionHandler {
	return {
		getPendingDiscovery: pending,
		rejectDiscovery: vi.fn(),
	} as unknown as BackgroundConnectionHandler
}

const pendingRow = (id: string): PendingDiscovery =>
	({ requestId: id, origin: "x", status: "pending", timestamp: Date.now() }) as unknown as PendingDiscovery

describe("DiscoveryQueue — F-04 flood caps", () => {
	test("coalesces a duplicate (origin,chainId)", () => {
		const q = new DiscoveryQueue(
			makeHandler(() => undefined),
			noopLogger,
		)
		expect(q.enqueue("r1", "https://a.com", "1")).toBe(true)
		expect(q.enqueue("r2", "https://a.com", "1")).toBe(false) // same (origin,chainId) → coalesced
		expect(q.size).toBe(1)
	})

	test("per-origin cap rejects past 4 for one origin; a different origin is unaffected", () => {
		const q = new DiscoveryQueue(
			makeHandler(() => undefined),
			noopLogger,
		)
		for (let i = 0; i < 4; i++) expect(q.enqueue(`r${i}`, "https://a.com", String(i))).toBe(true)
		expect(q.enqueue("r5", "https://a.com", "9")).toBe(false) // per-origin cap
		expect(q.enqueue("rb", "https://b.com", "1")).toBe(true) // isolation: other origin OK
		expect(q.size).toBe(5)
	})

	test("global cap rejects past 32 across many single-item origins", () => {
		const q = new DiscoveryQueue(
			makeHandler(() => undefined),
			noopLogger,
		)
		let accepted = 0
		// 40 distinct origins, 1 each → the per-origin cap (4) never trips; the
		// global cap (32) is the binding limit.
		for (let i = 0; i < 40; i++) if (q.enqueue(`r${i}`, `https://o${i}.com`, "1")) accepted++
		expect(accepted).toBe(32)
		expect(q.size).toBe(32)
	})

	test("drain processes exactly the accepted (non-coalesced) set", async () => {
		const seen: string[] = []
		const q = new DiscoveryQueue(makeHandler(pendingRow), noopLogger)
		q.enqueue("r1", "https://a.com", "1")
		q.enqueue("r2", "https://a.com", "1") // coalesced → never queued
		q.enqueue("r3", "https://b.com", "1")
		await q.drain(async (d) => {
			seen.push(d.requestId)
			return true
		})
		expect(seen.sort()).toEqual(["r1", "r3"])
		expect(q.size).toBe(0)
	})
})

const rowAt = (id: string, timestamp: number): PendingDiscovery =>
	({ requestId: id, origin: "https://a.com", status: "pending", timestamp }) as unknown as PendingDiscovery

describe("DiscoveryQueue — B-16 SDK-timeout-aligned expiry", () => {
	// The SDK's DEFAULT_DISCOVERY_TIMEOUT_MS is 60s (extension_provider): the
	// dApp removes its DISCOVERY_RESPONSE listener at t=60s. A discovery drained
	// after that window must be REJECTED, never approved — approving a connection
	// the dApp has already abandoned strands a half-open handshake. The queue's
	// old 5-minute staleness let a locked→unlock-at-t>60s path approve it.
	test("rejects a discovery drained past the SDK's 60s discovery window", async () => {
		const reject = vi.fn()
		const staleTs = Date.now() - 61_000 // 61s ago — the dApp's 60s listener is gone
		const handler = {
			getPendingDiscovery: (id: string) => rowAt(id, staleTs),
			rejectDiscovery: reject,
		} as unknown as BackgroundConnectionHandler
		const q = new DiscoveryQueue(handler, noopLogger)
		q.enqueue("r1", "https://a.com", "1")

		const processed: string[] = []
		await q.drain(async (d) => {
			processed.push(d.requestId)
			return true
		})

		expect(processed).toEqual([]) // NOT processed — past the dApp's window
		expect(reject).toHaveBeenCalledWith("r1") // rejected instead of approved
	})

	test("still processes a discovery well within the window", async () => {
		const freshTs = Date.now() - 5_000 // 5s ago — the dApp is still waiting
		const q = new DiscoveryQueue(
			makeHandler((id) => rowAt(id, freshTs)),
			noopLogger,
		)
		q.enqueue("r1", "https://a.com", "1")

		const processed: string[] = []
		await q.drain(async (d) => {
			processed.push(d.requestId)
			return true
		})

		expect(processed).toEqual(["r1"])
	})

	// Pin the exact 55s policy boundary (a 5s-green/61s-red pair alone would
	// accept any threshold between them).
	test("isDiscoveryExpired pins the 55s boundary exactly", () => {
		expect(DISCOVERY_STALE_MS).toBe(55_000)
		const base = 1_000_000
		expect(isDiscoveryExpired(rowAt("r", base), base + 54_000)).toBe(false) // 54s — inside
		expect(isDiscoveryExpired(rowAt("r", base), base + 55_000)).toBe(false) // exactly 55s — inside (not strictly past)
		expect(isDiscoveryExpired(rowAt("r", base), base + 55_001)).toBe(true) // 55.001s — past
		expect(isDiscoveryExpired(rowAt("r", base), base + 61_000)).toBe(true) // 61s — well past
	})

	// The per-entry clock re-read (drain no longer captures `now` once): a slow
	// first drain can push a later, already-aging entry past the window.
	test("drain re-reads the clock per entry, expiring a later item during a slow drain", async () => {
		vi.useFakeTimers()
		try {
			const base = Date.now()
			const reject = vi.fn()
			const rows: Record<string, PendingDiscovery> = {
				r1: rowAt("r1", base), // fresh
				r2: rowAt("r2", base - 30_000), // 30s old at drain start — still inside 55s
			}
			const handler = {
				getPendingDiscovery: (id: string) => rows[id],
				rejectDiscovery: reject,
			} as unknown as BackgroundConnectionHandler
			const q = new DiscoveryQueue(handler, noopLogger)
			q.enqueue("r1", "https://a.com", "1")
			q.enqueue("r2", "https://b.com", "1")

			const processed: string[] = []
			await q.drain(async (d) => {
				processed.push(d.requestId)
				// Processing r1 takes 30s → r2 (already 30s old) crosses 55s.
				if (d.requestId === "r1") vi.advanceTimersByTime(30_000)
				return true
			})

			expect(processed).toEqual(["r1"]) // r2 rejected as stale after the clock advanced
			expect(reject).toHaveBeenCalledWith("r2")
		} finally {
			vi.useRealTimers()
		}
	})
})
