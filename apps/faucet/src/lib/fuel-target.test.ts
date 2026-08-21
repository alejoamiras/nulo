import { describe, expect, it } from "vitest"
import { fuelRecipientFor } from "./fuel-target"

const USER = "0x1234567890abcdef1234567890abcdef12345678"

describe("fuelRecipientFor", () => {
	it("public fuel lands at the user's own Aztec address", () => {
		expect(fuelRecipientFor(false, USER)).toBe(USER)
	})

	it("private fuel lands at the canonical PrivateFPC — never the user's address on L1", () => {
		expect(fuelRecipientFor(true, USER)).not.toBe(USER)
		expect(fuelRecipientFor(true, USER)).toMatch(/^0x[0-9a-f]{64}$/)
		expect(fuelRecipientFor(true, "0x" + "ff".repeat(64))).toBe(fuelRecipientFor(true, "0x" + "00".repeat(64)))
	})
})
