import { describe, expect, test } from "vitest"
import { type RevealGeometry, revealMove } from "./collapsing-hero"

// The popup import's errors screen at 360x600, as measured on Chrome and Firefox: a 56 px sticky
// bar, the hero's title box ending at 157.6 and the warning starting at 319.6 at scroll 0.
const opened = (over: Partial<RevealGeometry>): RevealGeometry => ({
	scrollTop: 0,
	maxScroll: 102,
	barBottom: 56,
	viewBottom: 297,
	titleBottom: 157.6,
	blockTop: 319.6,
	blockBottom: 378.8,
	...over,
})

describe("revealMove", () => {
	test.each([
		["four buttons, a three-line warning: the end (102) carries the title past the bar (101.6)", opened({}), "end"],
		["four buttons, a four-line warning", opened({ maxScroll: 116, blockBottom: 393.2 }), "end"],
		["an end exactly at the title's clearance", opened({ maxScroll: 101.6 }), "end"],
		[
			"three buttons: the end (34) leaves the title cut, so only the warning is brought in",
			opened({ maxScroll: 34, viewBottom: 365 }),
			"nearest",
		],
		["a warning already whole below the bar", opened({ blockTop: 230, blockBottom: 290 }), "none"],
	] as const)("%s", (_case, geometry, move) => {
		expect(revealMove(geometry)).toBe(move)
	})

	test("measures the title's clearance from where the scroller already stands", () => {
		const scrolled = { scrollTop: 30, titleBottom: 127.6, blockTop: 289.6, blockBottom: 348.8 }
		expect(revealMove(opened(scrolled))).toBe("end")
		expect(revealMove(opened({ ...scrolled, maxScroll: 101 }))).toBe("nearest")
	})
})
