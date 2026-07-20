import { describe, expect, it, vi } from "vitest"
import { completeImportWithRecovery, IMPORT_ACTIVATION_TIMEOUT_MS } from "./completeImportWithRecovery"

describe("completeImportWithRecovery", () => {
	it("returns 'active' on the fast path without ever calling recover", async () => {
		const recover = vi.fn(async () => true)
		const outcome = await completeImportWithRecovery({
			waitForActive: async () => {},
			recover,
		})
		expect(outcome).toBe("active")
		expect(recover).not.toHaveBeenCalled()
	})

	it("passes the default timeout to waitForActive", async () => {
		const waitForActive = vi.fn(async () => {})
		await completeImportWithRecovery({ waitForActive, recover: async () => false })
		expect(waitForActive).toHaveBeenCalledWith(IMPORT_ACTIVATION_TIMEOUT_MS)
	})

	it("passes an explicit timeout through", async () => {
		const waitForActive = vi.fn(async () => {})
		await completeImportWithRecovery({ waitForActive, recover: async () => false, timeoutMs: 1234 })
		expect(waitForActive).toHaveBeenCalledWith(1234)
	})

	it("recovers to 'active' when the handshake times out but a session survives", async () => {
		const outcome = await completeImportWithRecovery({
			waitForActive: async () => {
				throw new Error("Profile activation timeout")
			},
			recover: async () => true,
		})
		expect(outcome).toBe("active")
	})

	it("returns 'needs-unlock' when the handshake times out AND recovery finds no session", async () => {
		const outcome = await completeImportWithRecovery({
			waitForActive: async () => {
				throw new Error("Profile activation timeout")
			},
			recover: async () => false,
		})
		expect(outcome).toBe("needs-unlock")
	})

	it("returns 'needs-unlock' (never throws) when recovery itself throws", async () => {
		const outcome = await completeImportWithRecovery({
			waitForActive: async () => {
				throw new Error("Profile activation timeout")
			},
			recover: async () => {
				throw new Error("store refuses to open")
			},
		})
		expect(outcome).toBe("needs-unlock")
	})

	it("does NOT dead-end: a rejecting waitForActive always reaches recover (no unbounded wait)", async () => {
		const recover = vi.fn(async () => false)
		await completeImportWithRecovery({
			waitForActive: async () => {
				throw new Error("timeout")
			},
			recover,
		})
		expect(recover).toHaveBeenCalledOnce()
	})
})
