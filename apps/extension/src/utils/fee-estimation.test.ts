/**
 * D2 pricing contract: fee USD comes ONLY from live pricing — no pricing in,
 * no dollar figure out (the hardcoded 0.02-rate era is over).
 */

import { describe, expect, test } from "vitest"
import { buildFeeEstimate, feeJuicePricingFromUsd, feeToUsd } from "./fee-estimation"

const FJ = 10n ** 18n // 1 Fee Juice (18 decimals)

describe("feeJuicePricingFromUsd", () => {
	test("builds live Fee Juice pricing from a quote's usd", () => {
		const pricing = feeJuicePricingFromUsd(0.0147)
		expect(pricing).toMatchObject({ usdRate: 0.0147, symbol: "FJ", decimals: 18 })
	})

	test("no quote / garbage → undefined (USD omitted, never faked)", () => {
		expect(feeJuicePricingFromUsd(undefined)).toBeUndefined()
		expect(feeJuicePricingFromUsd(0)).toBeUndefined()
		expect(feeJuicePricingFromUsd(-1)).toBeUndefined()
		expect(feeJuicePricingFromUsd(Number.NaN)).toBeUndefined()
	})
})

describe("feeToUsd — live pricing only", () => {
	test("prices a fee at the live rate (bigint, half-up to 3 decimals)", () => {
		// 3.5 FJ at $0.02 → $0.070 (matches the old stub's math with a live rate).
		expect(feeToUsd((35n * FJ) / 10n, feeJuicePricingFromUsd(0.02))).toBe("$0.070")
		// At the real-ish AZTEC rate: 1 FJ at $0.0147 → $0.015 (half-up from 0.0147).
		expect(feeToUsd(FJ, feeJuicePricingFromUsd(0.0147))).toBe("$0.015")
	})

	test("sub-$0.001 hint and zero-fee shape survive", () => {
		expect(feeToUsd(1n, feeJuicePricingFromUsd(0.02))).toBe("<$0.001")
		expect(feeToUsd(0n, feeJuicePricingFromUsd(0.02))).toBe("$0.000")
	})

	test("no pricing → null", () => {
		expect(feeToUsd(FJ, undefined)).toBeNull()
	})
})

describe("buildFeeEstimate — pricing threads through", () => {
	test("with pricing: maxFeeUsd populated; without: null", () => {
		const withPricing = buildFeeEstimate(10, 20, 5n * 10n ** 14n, 5n * 10n ** 14n, feeJuicePricingFromUsd(1))
		expect(withPricing.maxFee).toBe(30n * 5n * 10n ** 14n)
		expect(withPricing.maxFeeUsd).toBe("$0.015")

		const without = buildFeeEstimate(10, 20, 5n * 10n ** 14n, 5n * 10n ** 14n)
		expect(without.maxFeeUsd).toBeNull()
		expect(without.maxFeeFormatted).toBe(withPricing.maxFeeFormatted)
	})
})
