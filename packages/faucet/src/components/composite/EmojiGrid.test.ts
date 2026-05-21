import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import EmojiGrid from "./EmojiGrid.vue"

const NINE = "🟢🔵🟡🟣🔴⚪⚫🟠🟤"

describe("EmojiGrid", () => {
	it("renders exactly 9 cells for a 9-emoji string", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		expect(w.findAll(".cell")).toHaveLength(9)
	})

	it("each cell has a stable data-testid (fa-emoji-cell-0..8)", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		for (let i = 0; i < 9; i++) {
			expect(w.find(`[data-testid="${TESTIDS.emojiCell(i)}"]`).exists()).toBe(true)
		}
	})

	it("identical input produces identical output (deterministic)", () => {
		const a = mount(EmojiGrid, { props: { emojis: NINE } })
		const b = mount(EmojiGrid, { props: { emojis: NINE } })
		expect(a.html()).toBe(b.html())
	})

	it("pads with empty cells if the input has fewer than 9 emoji", () => {
		const w = mount(EmojiGrid, { props: { emojis: "🟢🔵🟡" } })
		const cells = w.findAll(".cell")
		expect(cells).toHaveLength(9)
		expect(cells[0].text()).toBe("🟢")
		expect(cells[8].text()).toBe("")
	})

	it("carries the role=img + accessible name", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		const root = w.get(`[data-testid="${TESTIDS.emojiGrid}"]`)
		expect(root.attributes("role")).toBe("img")
		expect(root.attributes("aria-label")).toMatch(/verification/i)
	})

	it("truncates if more than 9 emoji are passed", () => {
		const w = mount(EmojiGrid, { props: { emojis: `${NINE}🦊🦉` } })
		expect(w.findAll(".cell")).toHaveLength(9)
	})

	it("first cell renders the first input emoji", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		expect(w.findAll(".cell")[0].text()).toBe("🟢")
	})

	it("last cell renders the ninth input emoji", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		expect(w.findAll(".cell")[8].text()).toBe("🟤")
	})

	it("handles the empty string by rendering 9 blank cells", () => {
		const w = mount(EmojiGrid, { props: { emojis: "" } })
		const cells = w.findAll(".cell")
		expect(cells).toHaveLength(9)
		expect(cells.every((c) => c.text() === "")).toBe(true)
	})

	it("the grid root is the testid'd element", () => {
		const w = mount(EmojiGrid, { props: { emojis: NINE } })
		expect(w.get(`[data-testid="${TESTIDS.emojiGrid}"]`).classes()).toContain("emoji-grid")
	})
})
