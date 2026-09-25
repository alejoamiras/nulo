import { describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import RowAction from "./RowAction.vue"

/** A row whose root listens for clicks, holding one action. */
function mountInRow(actionProps: { label: string; href?: string }, onRow: () => void, onAction?: () => void) {
	const Row = defineComponent({
		setup: () => () =>
			h("div", { onClick: onRow, "data-testid": "row" }, [h(RowAction, { ...actionProps, onClick: onAction }, () => "×")]),
	})
	return mount(Row)
}

describe("ui/RowAction", () => {
	test("renders a 24×24 button carrying the label as its accessible name and the slot as its glyph", () => {
		const w = mount(RowAction, { props: { label: "Copy address" }, slots: { default: "<i data-testid='glyph' />" } })
		const button = w.find("button")
		expect(button.attributes("type")).toBe("button")
		expect(button.attributes("aria-label")).toBe("Copy address")
		expect(button.classes().some((c) => c.includes("action"))).toBe(true)
		expect(w.find("[data-testid='glyph']").exists()).toBe(true)
	})

	test("the label is required", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		mount(RowAction)
		expect(warn.mock.calls.some(([msg]) => String(msg).includes('Missing required prop: "label"'))).toBe(true)
		warn.mockRestore()
	})

	test("a click runs the action and never reaches the row", async () => {
		const onRow = vi.fn()
		const onAction = vi.fn()
		const w = mountInRow({ label: "Delete" }, onRow, onAction)
		await w.find("button").trigger("click")
		expect(onAction).toHaveBeenCalledTimes(1)
		expect(onRow).not.toHaveBeenCalled()
	})

	test("with an href it is an external link that opens a new tab without an opener, and its click stays inside", async () => {
		const onRow = vi.fn()
		const w = mountInRow({ label: "Open in block explorer", href: "https://explorer.example/tx/0x1" }, onRow)
		const link = w.find("a")
		expect(link.attributes("href")).toBe("https://explorer.example/tx/0x1")
		expect(link.attributes("target")).toBe("_blank")
		expect(link.attributes("rel")).toBe("noopener noreferrer")
		expect(link.attributes("aria-label")).toBe("Open in block explorer")
		expect(w.find("button").exists()).toBe(false)
		await link.trigger("click")
		expect(onRow).not.toHaveBeenCalled()
	})

	test("a testid and a class pass through to the control", () => {
		const w = mount(RowAction, { props: { label: "Edit" }, attrs: { "data-testid": "fpc-edit-btn", class: "extra" } })
		const button = w.find("button")
		expect(button.attributes("data-testid")).toBe("fpc-edit-btn")
		expect(button.classes()).toContain("extra")
	})
})
