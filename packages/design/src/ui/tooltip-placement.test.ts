import { describe, expect, test } from "vitest"
import { placeTooltip } from "./tooltip-placement"

const box = (left: number, top: number, width: number, height: number) => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height,
})

const POPUP = { width: 360, height: 600 }
const BUBBLE = { width: 100, height: 40 }
const WIDE = { width: 200, height: 30 }

type Case = [name: string, input: Parameters<typeof placeTooltip>[0], expected: { x: number; y: number }]

const cases: Case[] = [
	[
		"bottom flips above at the bottom edge",
		{ trigger: box(100, 560, 60, 20), bubble: BUBBLE, viewport: POPUP, side: "bottom", position: "center" },
		{ x: 80, y: 514 },
	],
	[
		"top flips below at the top edge",
		{ trigger: box(100, 10, 60, 20), bubble: BUBBLE, viewport: POPUP, side: "top", position: "center" },
		{ x: 80, y: 36 },
	],
	[
		"bottom stays below and clamps when neither side fits",
		{ trigger: box(100, 40, 60, 20), bubble: BUBBLE, viewport: { width: 360, height: 100 }, side: "bottom", position: "center" },
		{ x: 80, y: 52 },
	],
	[
		"top stays above and clamps when neither side fits",
		{ trigger: box(100, 40, 60, 20), bubble: BUBBLE, viewport: { width: 360, height: 100 }, side: "top", position: "center" },
		{ x: 80, y: 8 },
	],
	[
		"center clamps at the left edge",
		{ trigger: box(4, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "center" },
		{ x: 8, y: 126 },
	],
	[
		"start clamps at the left edge",
		{ trigger: box(4, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "start" },
		{ x: 8, y: 126 },
	],
	[
		"end clamps at the left edge",
		{ trigger: box(4, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "end" },
		{ x: 8, y: 126 },
	],
	[
		"center clamps at the right edge",
		{ trigger: box(326, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "center" },
		{ x: 152, y: 126 },
	],
	[
		"start clamps at the right edge",
		{ trigger: box(326, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "start" },
		{ x: 152, y: 126 },
	],
	[
		"end clamps at the right edge",
		{ trigger: box(326, 100, 30, 20), bubble: WIDE, viewport: POPUP, side: "bottom", position: "end" },
		{ x: 152, y: 126 },
	],
	[
		"left clamps at the edge instead of flipping",
		{ trigger: box(20, 100, 30, 20), bubble: BUBBLE, viewport: POPUP, side: "left", position: "center" },
		{ x: 8, y: 90 },
	],
	[
		"a bubble taller than the window takes the top inset",
		{ trigger: box(100, 100, 60, 20), bubble: { width: 100, height: 700 }, viewport: POPUP, side: "bottom", position: "center" },
		{ x: 80, y: 8 },
	],
	[
		"a trigger scrolled past the top-left corner keeps the bubble inside",
		{ trigger: box(-50, -30, 60, 20), bubble: BUBBLE, viewport: POPUP, side: "top", position: "center" },
		{ x: 8, y: 8 },
	],
	[
		"an invalid position falls back to the left inset",
		{ trigger: box(200, 100, 60, 20), bubble: BUBBLE, viewport: POPUP, side: "top", position: "diagonal" },
		{ x: 8, y: 54 },
	],
]

describe("placeTooltip", () => {
	test.each(cases)("%s", (_name, input, expected) => {
		expect(placeTooltip(input)).toEqual(expected)
	})
})
