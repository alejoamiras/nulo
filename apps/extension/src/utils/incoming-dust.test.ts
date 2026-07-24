import { describe, expect, test } from "vitest"
import { isReceiptAboveDustThreshold, usdThresholdToMicro } from "./incoming-dust"

describe("usdThresholdToMicro", () => {
	test("converts USD to micro-USD; 0 / invalid → 0n (off)", () => {
		expect(usdThresholdToMicro(0.01)).toBe(10_000n)
		expect(usdThresholdToMicro(1)).toBe(1_000_000n)
		expect(usdThresholdToMicro(0)).toBe(0n)
		expect(usdThresholdToMicro(-5)).toBe(0n)
		expect(usdThresholdToMicro(Number.NaN)).toBe(0n)
	})
})

describe("isReceiptAboveDustThreshold", () => {
	// A token with 18 decimals priced at $2/token; threshold $0.01 = 10_000 micro-USD.
	const threshold = usdThresholdToMicro(0.01)

	test("filter OFF (threshold 0) → always shown", () => {
		expect(isReceiptAboveDustThreshold({ amountRaw: "1", decimals: 18, usdRate: 2, thresholdMicro: 0n })).toBe(true)
	})

	test("no fresh rate (undefined) → fail OPEN (shown)", () => {
		expect(isReceiptAboveDustThreshold({ amountRaw: "1", decimals: 18, usdRate: undefined, thresholdMicro: threshold })).toBe(true)
	})

	test("value ABOVE threshold → shown", () => {
		// 1 whole token @ $2 = $2.00 >> $0.01.
		expect(
			isReceiptAboveDustThreshold({ amountRaw: (10n ** 18n).toString(), decimals: 18, usdRate: 2, thresholdMicro: threshold }),
		).toBe(true)
	})

	test("value BELOW threshold → hidden (dust)", () => {
		// 0.001 token @ $2 = $0.002 < $0.01.
		expect(
			isReceiptAboveDustThreshold({ amountRaw: (10n ** 15n).toString(), decimals: 18, usdRate: 2, thresholdMicro: threshold }),
		).toBe(false)
	})

	test("value EXACTLY at threshold → shown (>=, no boundary rounding)", () => {
		// amount × rate = threshold × scale exactly: 0.005 token @ $2 = $0.01.
		expect(
			isReceiptAboveDustThreshold({ amountRaw: (5n * 10n ** 15n).toString(), decimals: 18, usdRate: 2, thresholdMicro: threshold }),
		).toBe(true)
	})

	test("RAISING the threshold hides MORE; LOWERING re-reveals", () => {
		const args = { amountRaw: (10n ** 16n).toString(), decimals: 18, usdRate: 2 } // 0.01 token @ $2 = $0.02
		expect(isReceiptAboveDustThreshold({ ...args, thresholdMicro: usdThresholdToMicro(0.01) })).toBe(true) // $0.02 >= $0.01
		expect(isReceiptAboveDustThreshold({ ...args, thresholdMicro: usdThresholdToMicro(0.05) })).toBe(false) // $0.02 < $0.05 → hidden
		expect(isReceiptAboveDustThreshold({ ...args, thresholdMicro: usdThresholdToMicro(0.01) })).toBe(true) // lower back → re-revealed
	})

	test("unparseable amount → fail OPEN", () => {
		expect(isReceiptAboveDustThreshold({ amountRaw: "not-a-number", decimals: 18, usdRate: 2, thresholdMicro: threshold })).toBe(true)
	})

	test("zero rate (invalid) → fail OPEN", () => {
		expect(isReceiptAboveDustThreshold({ amountRaw: "1", decimals: 18, usdRate: 0, thresholdMicro: threshold })).toBe(true)
	})

	test("a zero-value receipt is dust when the filter is on", () => {
		expect(isReceiptAboveDustThreshold({ amountRaw: "0", decimals: 18, usdRate: 2, thresholdMicro: threshold })).toBe(false)
	})
})
