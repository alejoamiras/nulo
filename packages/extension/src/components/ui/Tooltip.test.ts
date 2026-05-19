/**
 * Tooltip teleports its content to `#tooltip`, so observability relies on
 * the document, not the wrapper. Tests use a teleport target appended to
 * `document.body` and assert on its contents after the relevant trigger.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import Tooltip from "./Tooltip.vue"

let tooltipRoot: HTMLDivElement

const mountTooltip = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Tooltip, {
		props,
		slots: { default: "<button>trigger</button>", content: "Tip body", ...slots },
		attachTo: document.body,
	})

describe("ui/Tooltip", () => {
	beforeEach(() => {
		tooltipRoot = document.createElement("div")
		tooltipRoot.id = "tooltip"
		document.body.appendChild(tooltipRoot)
		vi.useFakeTimers()
	})

	afterEach(() => {
		tooltipRoot.remove()
		vi.useRealTimers()
	})

	test("renders the default slot (trigger) inside the wrapper", () => {
		const w = mountTooltip()
		expect(w.find("button").text()).toBe("trigger")
	})

	test("does not render content slot until mouse enters", () => {
		mountTooltip()
		expect(tooltipRoot.textContent).not.toContain("Tip body")
	})

	test("mouseenter teleports the content slot into #tooltip", async () => {
		const w = mountTooltip()
		await w.trigger("mouseenter")
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
	})

	test("mouseleave hides the content again", async () => {
		const w = mountTooltip()
		await w.trigger("mouseenter")
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
		await w.trigger("mouseleave")
		await flushPromises()
		expect(tooltipRoot.textContent).not.toContain("Tip body")
	})

	test("disabled tooltip does NOT show on mouseenter", async () => {
		const w = mountTooltip({ disabled: true })
		await w.trigger("mouseenter")
		await flushPromises()
		expect(tooltipRoot.textContent).not.toContain("Tip body")
	})

	test("delay defers the show until the timeout elapses", async () => {
		const w = mountTooltip({ delay: 500 })
		await w.trigger("mouseenter")
		await flushPromises()
		expect(tooltipRoot.textContent).not.toContain("Tip body")
		vi.advanceTimersByTime(500)
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
	})

	test("delay can be passed as a string and is parsed to a number", async () => {
		const w = mountTooltip({ delay: "300" })
		await w.trigger("mouseenter")
		expect(tooltipRoot.textContent).not.toContain("Tip body")
		vi.advanceTimersByTime(300)
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
	})
})
