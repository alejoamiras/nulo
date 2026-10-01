import { describe, expect, test } from "vitest"
import { FULL_SIZE, fiatHeroCandidates, fitHero, HERO_MIN_SCALE, holdHeroFit, tokenHeroCandidates } from "./hero-fit"

/** An ideal font: each form's width scales exactly with the type. */
const linear = (widths: number[]) => (index: number, scale: number) => (widths[index] ?? 0) * scale

describe("fitHero", () => {
	test("a form that fits keeps the full size", () => {
		expect(fitHero(3, linear([300, 200, 100]), 312)).toEqual(FULL_SIZE)
	})

	test("a wider form shrinks to the largest hundredth at which every character fits", () => {
		expect(fitHero(3, linear([356.6, 200, 100]), 312)).toEqual({ index: 0, scale: 0.87 })
	})

	test("the 60% floor decides when the next, shorter form takes over, at its own largest fit", () => {
		// 312 / 0.6 = 520: at 521 the first form would need 59.9%.
		expect(fitHero(3, linear([520, 452, 210]), 312)).toEqual({ index: 0, scale: HERO_MIN_SCALE })
		expect(fitHero(3, linear([521, 452, 210]), 312)).toEqual({ index: 1, scale: 0.69 })
		expect(fitHero(3, linear([900, 800, 210]), 312)).toEqual({ index: 2, scale: 1 })
	})

	test("a width that does not scale linearly is checked at the chosen size and steps down until it fits", () => {
		// Rounded glyph advances: 2 px over the linear width at every reduced size.
		const rounded = (index: number, scale: number) => linear([356.6])(index, scale) + (scale < 1 ? 2 : 0)
		expect(fitHero(1, rounded, 312)).toEqual({ index: 0, scale: 0.86 })
	})

	test("when no form fits at 60%, the shortest takes whatever size fits; unlaid-out, the full size", () => {
		// Only a symbol too long for the line gets here.
		expect(fitHero(2, linear([900, 700]), 312)).toEqual({ index: 1, scale: 0.44 })
		expect(fitHero(2, linear([900, 700]), 0)).toEqual(FULL_SIZE)
	})
})

test("holdHeroFit lets a held fit shrink or change form, never grow", () => {
	const held = { index: 0, scale: 0.8 }
	expect(holdHeroFit(held, { index: 0, scale: 1 })).toBe(held)
	expect(holdHeroFit(held, { index: 0, scale: 0.75 })).toEqual({ index: 0, scale: 0.75 })
	expect(holdHeroFit(held, { index: 1, scale: 1 })).toEqual({ index: 1, scale: 1 })
})

describe("tokenHeroCandidates", () => {
	test("each shorter length follows the compact rule: fraction digits go first, then the whole part reads K/M/B/T", () => {
		expect(tokenHeroCandidates(1_234_567_890_123_456_789_000n, 18, 20).slice(0, 4)).toEqual([
			"1,234.56789012345678",
			"1,234.5678901234567",
			"1,234.567890123456",
			"1,234.56789012345",
		])
		expect(tokenHeroCandidates(124_458_788_900_000n, 6, 20)).toEqual(["124,458,788.9", "124,458,788", "124.45M", "124.4M", "124M"])
	})

	test("the forms stop before a cut would misstate the balance", () => {
		// Shorter cuts would read "0K" for 999.5 and "0" for 0.5.
		expect(tokenHeroCandidates(9_995n, 1, 20)).toEqual(["999.5", "999"])
		expect(tokenHeroCandidates(5n, 1, 20)).toEqual(["0.5"])
		const tiny = tokenHeroCandidates(5n, 18, 20)
		expect(tiny[0]).toBe("0.000000000000000005")
		expect(tiny.at(-1)).toBe("<0.1")
		expect(tiny).not.toContain("0")
	})

	test("without a length the forms start from the full value", () => {
		expect(tokenHeroCandidates(1_123_456_789_012_345_678n, 18)[0]).toBe("1.123456789012345678")
		expect(tokenHeroCandidates(1_123_456_789_012_345_678n, 18, 20)[0]).toBe("1.123456789012345678")
		expect(tokenHeroCandidates(0n, 18, 20)).toEqual(["0"])
	})
})

describe("fiatHeroCandidates", () => {
	test("the cents go first, then whole dollars read K/M/B/T, truncated", () => {
		expect(fiatHeroCandidates(124_458_788_900_000n)).toEqual(["$124,458,788.90", "$124,458,788", "$124.45M", "$124.4M", "$124M"])
	})

	test("the shorter forms drop the cents of the figure shown, so they never contradict it", () => {
		// $999.995 shows as $1,000.00 (half-up), so its whole dollars read $1,000, not $999.
		expect(fiatHeroCandidates(999_995_000n)).toEqual(["$1,000.00", "$1,000", "$1K"])
		expect(fiatHeroCandidates(5_430_000n)).toEqual(["$5.43", "$5"])
		expect(fiatHeroCandidates(450_000n)).toEqual(["$0.45"])
		expect(fiatHeroCandidates(9_999n)).toEqual(["<$0.01"])
		expect(fiatHeroCandidates(0n)).toEqual(["$0.00"])
	})
})
