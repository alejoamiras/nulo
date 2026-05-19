import { describe, expect, test } from "vitest"
import { CAPABILITY_LABELS, getCapabilityInfo } from "./capability-meta"

describe("capabilities/capability-meta", () => {
	test("known types return their canonical label + risk", () => {
		expect(getCapabilityInfo("transaction")).toEqual(CAPABILITY_LABELS.transaction)
		expect(getCapabilityInfo("data").risk).toBe("high")
	})

	test("unknown types fall back to a generic shape", () => {
		const info = getCapabilityInfo("__weird__")
		expect(info.label).toBe("__weird__")
		expect(info.description).toContain("__weird__")
		expect(info.risk).toBe("medium")
	})

	test("every entry has the required shape", () => {
		for (const [key, info] of Object.entries(CAPABILITY_LABELS)) {
			expect(typeof info.label).toBe("string")
			expect(typeof info.description).toBe("string")
			expect(["low", "medium", "high"]).toContain(info.risk)
			expect(key.length).toBeGreaterThan(0)
		}
	})
})
