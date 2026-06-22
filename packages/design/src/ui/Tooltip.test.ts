/**
 * Tooltip teleports its content to `teleportTo` (default `#tooltip`), so observability relies on the
 * document, not the wrapper. Tests append a teleport target to `document.body` and assert its contents.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Tooltip from "./Tooltip.vue"

let tooltipRoot: HTMLDivElement

const mountTooltip = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Tooltip, {
		props,
		slots: { default: "<button>trigger</button>", content: "Tip body", ...slots },
		attachTo: document.body,
	})

describe("Tooltip", () => {
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
		expect(mountTooltip().find("button").text()).toBe("trigger")
	})

	test("does not render the content slot until mouse enters", () => {
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

	test("teleportTo overrides the target root", async () => {
		const custom = document.createElement("div")
		custom.id = "custom-tip"
		document.body.appendChild(custom)
		try {
			const w = mountTooltip({ teleportTo: "#custom-tip" })
			await w.trigger("mouseenter")
			await flushPromises()
			expect(custom.textContent).toContain("Tip body")
			expect(tooltipRoot.textContent).not.toContain("Tip body")
		} finally {
			custom.remove()
		}
	})
})
