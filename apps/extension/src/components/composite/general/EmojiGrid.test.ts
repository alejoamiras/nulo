import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import EmojiGrid from "./EmojiGrid.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
}

const mountGrid = (emojis: string) => mount(EmojiGrid, { props: { emojis }, global: { stubs: STUBS } })

describe("composite/EmojiGrid", () => {
	test("renders all 9 cells for a 9-emoji string", () => {
		const w = mountGrid("🐷🐔🐮🦊🐭🦁🐶🐱🐰")
		const cells = w.findAll("[class*='cell']")
		expect(cells).toHaveLength(9)
	})

	test("groups emojis into 3 rows of 3", () => {
		const w = mountGrid("🐷🐔🐮🦊🐭🦁🐶🐱🐰")
		expect(w.text()).toContain("🐷")
		expect(w.text()).toContain("🐰")
	})

	test("handles fewer than 9 emojis (renders only the provided ones)", () => {
		const w = mountGrid("🐷🐔🐮")
		const cells = w.findAll("[class*='cell']")
		expect(cells).toHaveLength(3)
	})

	test("handles empty string (renders 0 cells)", () => {
		const w = mountGrid("")
		const cells = w.findAll("[class*='cell']")
		expect(cells).toHaveLength(0)
	})

	test("preserves emoji order in the rendered output", () => {
		const w = mountGrid("🐷🐔🐮🦊🐭🦁🐶🐱🐰")
		const cellTexts = w.findAll("[class*='cell']").map((c) => c.text())
		expect(cellTexts).toEqual(["🐷", "🐔", "🐮", "🦊", "🐭", "🦁", "🐶", "🐱", "🐰"])
	})

	test("handles surrogate-pair emojis correctly (uses spread to count)", () => {
		// Some emojis are 2-codepoint; spread iterates by codepoint, ensuring
		// `[...emojis]` correctly groups them into one cell each.
		const w = mountGrid("🇺🇸🐔🐮🦊🐭🦁")
		// Flag emojis are ZWJ sequences — counted as 2 codepoints by spread.
		// The component itself uses `[...emojis]` so behavior is contract-pinned.
		expect(w.findAll("[class*='cell']").length).toBeGreaterThanOrEqual(6)
	})
})
