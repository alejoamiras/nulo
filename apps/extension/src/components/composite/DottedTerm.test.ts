import { Tooltip } from "@nulo/design"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { GLOSSARY } from "@/utils/glossary"
import DottedTerm from "./DottedTerm.vue"

enableAutoUnmount(afterEach)

const mountTerm = (props: Record<string, unknown> = {}, slot = "Private Fee Juice") =>
	mount(DottedTerm, {
		props: { term: "private-fee-juice", testid: "term", ...props },
		slots: { default: slot },
		attachTo: document.body,
		global: { components: { Tooltip } },
	})

const bubbleText = () => document.querySelector('[data-testid="tooltip-text"]')

describe("composite/DottedTerm", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="tooltip"></div>'
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		document.body.innerHTML = ""
	})

	test("renders the slot, not the entry's term", () => {
		const w = mountTerm({ term: "authorization" }, "authorizations")
		expect(w.get('[data-testid="term"]').text()).toBe("authorizations")
	})

	test("shows the definition its key names", async () => {
		const w = mountTerm()
		await w.get('[data-testid="term"]').trigger("focusin")
		expect(bubbleText()?.textContent?.trim()).toBe(GLOSSARY["private-fee-juice"].definition)
	})

	test("an unknown key warns", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			mountTerm({ term: "no-such-term" })
			expect(warn.mock.calls.some((c) => String(c[0]).includes('Invalid prop: custom validator check failed for prop "term"'))).toBe(
				true,
			)
		} finally {
			warn.mockRestore()
		}
	})

	test("is a Tab stop", () => {
		expect(mountTerm().get('[data-testid="term"]').attributes("tabindex")).toBe("0")
	})

	test("describes itself from a hidden, always-mounted copy of the definition", () => {
		const w = mountTerm()
		const id = w.get('[data-testid="term"]').attributes("aria-describedby")
		const description = document.getElementById(id as string)
		expect(description?.hidden).toBe(true)
		expect(description?.textContent).toBe(GLOSSARY["private-fee-juice"].definition)
	})

	test("focus opens at once, hover after 300ms", async () => {
		const focused = mountTerm()
		await focused.get('[data-testid="term"]').trigger("focusin")
		expect(bubbleText()).not.toBeNull()
		focused.unmount()

		const hovered = mountTerm()
		await hovered.trigger("mouseenter")
		vi.advanceTimersByTime(299)
		await flushPromises()
		expect(bubbleText()).toBeNull()
		vi.advanceTimersByTime(1)
		await flushPromises()
		expect(bubbleText()).not.toBeNull()
	})

	test("a click shows the definition, and Enter leaves it open", async () => {
		const term = mountTerm().get('[data-testid="term"]')
		await term.trigger("pointerdown", { pointerType: "mouse" })
		await term.trigger("focusin")
		expect(bubbleText()).not.toBeNull()
		await term.trigger("keydown", { key: "Enter" })
		expect(bubbleText()).not.toBeNull()
	})

	test("passes its position through, centred by default", () => {
		expect(mountTerm().getComponent(Tooltip).props("position")).toBe("center")
		expect(mountTerm({ position: "end" }).getComponent(Tooltip).props("position")).toBe("end")
	})

	test("left-aligns the definition", async () => {
		const w = mountTerm()
		await w.get('[data-testid="term"]').trigger("focusin")
		expect((bubbleText() as HTMLElement).style.textAlign).toBe("left")
	})

	test("puts its testid on the term span", () => {
		expect(mountTerm({ testid: "gas-label-private" }).get('[data-testid="gas-label-private"]').element.tagName).toBe("SPAN")
	})

	test("two terms on one screen get distinct description ids", () => {
		const w = mount(
			{
				components: { DottedTerm },
				template: `<div>
					<DottedTerm term="public-fee-juice" testid="a">Public Fee Juice</DottedTerm>
					<DottedTerm term="private-fee-juice" testid="b">Private Fee Juice</DottedTerm>
				</div>`,
			},
			{ attachTo: document.body, global: { components: { Tooltip } } },
		)
		const a = w.get('[data-testid="a"]').attributes("aria-describedby")
		const b = w.get('[data-testid="b"]').attributes("aria-describedby")
		expect(a).toBeTruthy()
		expect(a).not.toBe(b)
		expect(document.getElementById(b as string)?.textContent).toBe(GLOSSARY["private-fee-juice"].definition)
	})

	test("lays its tooltip out inline (a class check: jsdom has no layout)", () => {
		const w = mountTerm()
		const tooltip = w.getComponent(Tooltip)
		expect(tooltip.props("inline")).toBe(true)
		expect(tooltip.classes()).toHaveLength(2)
	})
})
