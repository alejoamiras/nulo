import { describe, expect, test } from "vitest"
import { walletChainId } from "./chain-id"

describe("walletChainId", () => {
	test("a high-bit pair is unsigned", () => {
		expect(walletChainId(1, 2 ** 31)).toBe(2147483649)
	})

	test("a rollup version above u32 wraps to its low 32 bits", () => {
		expect(walletChainId(1, 2 ** 32 + 5)).toBe(4)
	})
})
