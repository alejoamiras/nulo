import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core/logger"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DiscoveryQueue } from "./discovery-queue"

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
