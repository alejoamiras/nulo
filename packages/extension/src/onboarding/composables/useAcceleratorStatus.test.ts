import { effectScope } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { useAcceleratorStatus } from "./useAcceleratorStatus"

const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
}

beforeEach(() => {
	vi.unstubAllGlobals()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("useAcceleratorStatus", () => {
	test("initial state is idle when autoDetect=false", () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		expect(result.status.value).toBe("idle")
		expect(result.info.value).toBeNull()
		expect(fetchMock).not.toHaveBeenCalled()
		scope.stop()
	})

	test("detect transitions to active when bb_available is true", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ status: "ok", version: "1.1.0", aztec_version: "0.78.0", bb_available: true }),
			})),
		)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		await result.detect()
		expect(result.status.value).toBe("active")
		expect(result.info.value?.version).toBe("1.1.0")
		expect(result.info.value?.aztec_version).toBe("0.78.0")
		scope.stop()
	})

	test("detect transitions to no-bb when bb_available is false", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ status: "ok", version: "1.1.0", aztec_version: "0.78.0", bb_available: false }),
			})),
		)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		await result.detect()
		expect(result.status.value).toBe("no-bb")
		scope.stop()
	})

	test("detect transitions to not-detected on HTTP error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })),
		)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		await result.detect()
		expect(result.status.value).toBe("not-detected")
		expect(result.info.value).toBeNull()
		scope.stop()
	})

	test("detect transitions to not-detected on fetch rejection (timeout / refused)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("Failed to fetch")
			}),
		)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		await result.detect()
		expect(result.status.value).toBe("not-detected")
		scope.stop()
	})

	test("detect can be re-run; status cycles from active back through detecting", async () => {
		let callCount = 0
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				callCount++
				if (callCount === 1) {
					return { ok: true, json: async () => ({ status: "ok", version: "1.1.0", aztec_version: "0.78.0", bb_available: true }) }
				}
				throw new Error("Failed")
			}),
		)
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false }))!
		await result.detect()
		expect(result.status.value).toBe("active")
		await result.detect()
		expect(result.status.value).toBe("not-detected")
		scope.stop()
	})
})
