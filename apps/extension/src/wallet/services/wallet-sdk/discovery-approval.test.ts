import type { PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test, vi } from "vitest"
import { approveOrRollbackDiscoverySession } from "./discovery-approval"

const noopLogger: ILogger = { log: () => {} }

const discoveryAt = (requestId: string, timestamp: number): PendingDiscovery =>
	({ requestId, origin: "https://a.com", status: "pending", timestamp }) as unknown as PendingDiscovery

function harness() {
	return {
		approve: vi.fn(),
		reject: vi.fn(),
		del: vi.fn(async () => {}),
		pv: new Set<string>(),
	}
}

describe("approveOrRollbackDiscoverySession (B-16)", () => {
	// The durable writes (addDappSession + setCapabilityGrants) can cross the
	// dApp's 60s window; by the time we reach this decision the discovery is
	// already past the 55s cutoff. It must roll the session back and reject —
	// never approve, never schedule verification.
	test("rolls back the session and rejects when the discovery expired during the writes", async () => {
		const h = harness()
		const approved = await approveOrRollbackDiscoverySession({
			discovery: discoveryAt("r1", Date.now() - 61_000), // expired by the decision point
			sessionId: "S1",
			dedupeKey: "https://a.com|1",
			approveDiscovery: h.approve,
			rejectDiscovery: h.reject,
			deleteSession: h.del,
			pendingVerification: h.pv,
			logger: noopLogger,
		})

		expect(approved).toBe(false)
		expect(h.del).toHaveBeenCalledWith("S1") // rolled back
		expect(h.reject).toHaveBeenCalledWith("r1")
		expect(h.approve).not.toHaveBeenCalled()
		expect(h.pv.size).toBe(0) // no verification scheduled for a dead discovery
	})

	test("still rejects (does not approve) even if the rollback delete throws", async () => {
		const h = harness()
		h.del.mockRejectedValueOnce(new Error("Invalid id")) // concurrent disconnect already removed it
		const approved = await approveOrRollbackDiscoverySession({
			discovery: discoveryAt("r1", Date.now() - 61_000),
			sessionId: "S1",
			dedupeKey: "k",
			approveDiscovery: h.approve,
			rejectDiscovery: h.reject,
			deleteSession: h.del,
			pendingVerification: h.pv,
			logger: noopLogger,
		})

		expect(approved).toBe(false)
		expect(h.reject).toHaveBeenCalledWith("r1")
		expect(h.approve).not.toHaveBeenCalled()
	})

	test("approves and schedules verification when still fresh", async () => {
		const h = harness()
		const approved = await approveOrRollbackDiscoverySession({
			discovery: discoveryAt("r1", Date.now() - 5_000), // well within the window
			sessionId: "S1",
			dedupeKey: "https://a.com|1",
			approveDiscovery: h.approve,
			rejectDiscovery: h.reject,
			deleteSession: h.del,
			pendingVerification: h.pv,
			logger: noopLogger,
		})

		expect(approved).toBe(true)
		expect(h.approve).toHaveBeenCalledWith("r1")
		expect(h.del).not.toHaveBeenCalled() // no rollback
		expect(h.reject).not.toHaveBeenCalled()
		expect(h.pv.has("https://a.com|1")).toBe(true) // verification scheduled
	})
})
