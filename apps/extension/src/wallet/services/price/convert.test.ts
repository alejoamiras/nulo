import { describe, expect, test } from "vitest"
import { formatUsdMicro, parseUsdToMicro, rateToMicroUsd, tokenAmountToUsdMicro, usdMicroToTokenAmount, usdToTokenAmount } from "./convert"

describe("rateToMicroUsd", () => {
	test("snaps a provider rate to micro-USD", () => {
		expect(rateToMicroUsd(0.999857)).toBe(999_857n)
		expect(rateToMicroUsd(0.01466932)).toBe(14_669n)
		expect(rateToMicroUsd(1)).toBe(1_000_000n)
	})

	test("throws on non-finite, zero, negative, and sub-precision rates", () => {
		expect(() => rateToMicroUsd(Number.NaN)).toThrow()
		expect(() => rateToMicroUsd(Number.POSITIVE_INFINITY)).toThrow()
		expect(() => rateToMicroUsd(0)).toThrow()
		expect(() => rateToMicroUsd(-1)).toThrow()
		expect(() => rateToMicroUsd(0.000_000_4)).toThrow()
	})
})

describe("tokenAmountToUsdMicro", () => {
	test("18-decimal token at a stablecoin rate", () => {
		// 1,250 tokens at $0.999857 → $1,249.82125 → 1_249_821_250 micro.
		expect(tokenAmountToUsdMicro(1_250n * 10n ** 18n, 18, 0.999857)).toBe(1_249_821_250n)
	})

	test("half-up rounding at the micro boundary", () => {
		// 1.5 raw units of a 6-dec token at $1 → 1.5 micro-USD → rounds to 2.
		expect(tokenAmountToUsdMicro(15n, 6, 1)).toBe(15n)
		expect(tokenAmountToUsdMicro(1n, 6, 1.5)).toBe(2n)
	})

	test("zero amount is zero dollars", () => {
		expect(tokenAmountToUsdMicro(0n, 18, 123.45)).toBe(0n)
	})

	test("rejects negative amounts", () => {
		expect(() => tokenAmountToUsdMicro(-1n, 18, 1)).toThrow()
	})

	test("no precision loss at extreme magnitudes (max-ish 18-dec balance)", () => {
		// 10^12 whole tokens with 18 decimals at $1 → exactly 10^18 micro-USD.
		expect(tokenAmountToUsdMicro(10n ** 30n, 18, 1)).toBe(10n ** 18n)
	})
})

describe("formatUsdMicro", () => {
	test("formats cents half-up with two decimals", () => {
		expect(formatUsdMicro(1_249_821_250n)).toBe("$1,249.82")
		expect(formatUsdMicro(1_249_825_000n)).toBe("$1,249.83")
	})

	test("zero and sub-cent hints", () => {
		expect(formatUsdMicro(0n)).toBe("$0.00")
		expect(formatUsdMicro(9_999n)).toBe("<$0.01")
		expect(formatUsdMicro(10_000n)).toBe("$0.01")
	})

	test("rejects negative values", () => {
		expect(() => formatUsdMicro(-1n)).toThrow()
	})
})

describe("parseUsdToMicro", () => {
	test("parses whole and fractional inputs", () => {
		expect(parseUsdToMicro("125")).toBe(125_000_000n)
		expect(parseUsdToMicro("125.5")).toBe(125_500_000n)
		expect(parseUsdToMicro("0.004999")).toBe(4_999n)
	})

	test("truncates beyond micro precision (never credits extra dollars)", () => {
		expect(parseUsdToMicro("0.0000019")).toBe(1n)
	})

	test("rejects malformed input", () => {
		expect(parseUsdToMicro("")).toBeNull()
		expect(parseUsdToMicro("abc")).toBeNull()
		expect(parseUsdToMicro("-5")).toBeNull()
		expect(parseUsdToMicro("1,5")).toBeNull()
		expect(parseUsdToMicro("1e6")).toBeNull()
		expect(parseUsdToMicro(".")).toBeNull()
	})

	test("accepts trailing dot as whole number", () => {
		expect(parseUsdToMicro("5.")).toBe(5_000_000n)
	})
})

describe("usdMicroToTokenAmount / usdToTokenAmount (C3 inverse, round-DOWN)", () => {
	test("dollar input to 18-dec token units at a stablecoin rate", () => {
		// $125 at $0.999857/token → 125.017875... tokens, rounded down.
		const raw = usdToTokenAmount("125", 18, 0.999857)
		expect(raw).not.toBeNull()
		// Must never exceed the true value: raw * rate ≤ typed dollars.
		const micro = raw as bigint
		expect((micro * 999_857n) / 10n ** 18n <= 125_000_000n).toBe(true)
		expect(micro).toBe((125_000_000n * 10n ** 18n) / 999_857n)
	})

	test("rounds down at every precision (6-dec token)", () => {
		// $1 at $3/token → 0.333333 tokens exactly (truncated).
		expect(usdToTokenAmount("1", 6, 3)).toBe(333_333n)
		expect(usdMicroToTokenAmount(1_000_000n, 6, 3)).toBe(333_333n)
	})

	test("null on unparseable input", () => {
		expect(usdToTokenAmount("nope", 18, 1)).toBeNull()
	})

	test("property: round-trip never overshoots across magnitudes", () => {
		// Deterministic sweep standing in for a property test: for a range of
		// rates and amounts, usd→token→usd must be ≤ the typed dollars.
		const rates = [0.0001, 0.014669, 0.5, 0.999857, 1, 3.171717, 42, 99.99]
		const inputs = ["0.01", "1", "19.99", "1234.567891", "999999999.999999"]
		const decimalsSet = [0, 6, 8, 18]
		for (const rate of rates) {
			for (const input of inputs) {
				for (const decimals of decimalsSet) {
					const typedMicro = parseUsdToMicro(input) as bigint
					const raw = usdToTokenAmount(input, decimals, rate)
					expect(raw).not.toBeNull()
					const backMicro = ((raw as bigint) * rateToMicroUsd(rate)) / 10n ** BigInt(decimals)
					expect(backMicro <= typedMicro).toBe(true)
					// And the undershoot is bounded by one token quantum's value.
					const quantumValue = rateToMicroUsd(rate) / 10n ** BigInt(decimals) + 1n
					expect(typedMicro - backMicro <= quantumValue).toBe(true)
				}
			}
		}
	})
})

describe("codex post-impl fixes — ceil rate + machine formatting", () => {
	test("the C3 inverse uses a CEILED rate: sub-micro rates never yield extra tokens", async () => {
		const { rateToMicroUsdCeil, usdMicroToTokenAmount } = await import("./convert")
		// 0.0000014 above the micro grid: round would floor the rate (more tokens), ceil must not.
		expect(rateToMicroUsdCeil(1.0000014)).toBe(1_000_002n)
		expect(rateToMicroUsd(1.0000014)).toBe(1_000_001n)
		// $1 at that rate: ceil-rate derivation ≤ round-rate derivation.
		const viaCeil = usdMicroToTokenAmount(1_000_000n, 6, 1.0000014)
		expect(viaCeil * 1_000_002n <= 1_000_000n * 10n ** 6n).toBe(true)
	})

	test("usdMicroToPlainString is locale-proof machine format", async () => {
		const { usdMicroToPlainString } = await import("./convert")
		expect(usdMicroToPlainString(1_250_000_000n)).toBe("1250")
		expect(usdMicroToPlainString(1_250_500_000n)).toBe("1250.5")
		expect(usdMicroToPlainString(4_999n)).toBe("0.004999")
		expect(usdMicroToPlainString(0n)).toBe("0")
		// Never a comma, never a symbol — parseable by parseUsdToMicro round-trip.
		expect(parseUsdToMicro(usdMicroToPlainString(1_249_821_250n))).toBe(1_249_821_250n)
	})
})
