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

	test("keyboard focus on a focusable trigger child shows the tooltip (focusin bubbles)", async () => {
		const w = mountTooltip()
		await w.trigger("focusin")
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
	})

	test("focus bypasses the hover delay — deliberate focus shows immediately", async () => {
		const w = mountTooltip({ delay: 350 })
		await w.trigger("focusin")
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
	})

	test("focusout hides the tooltip again", async () => {
		const w = mountTooltip()
		await w.trigger("focusin")
		await flushPromises()
		expect(tooltipRoot.textContent).toContain("Tip body")
		await w.trigger("focusout")
		await flushPromises()
		expect(tooltipRoot.textContent).not.toContain("Tip body")
	})

	test("disabled tooltip does NOT show on focusin", async () => {
		const w = mountTooltip({ disabled: true })
		await w.trigger("focusin")
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

	describe("positioning geometry (side × position matrix)", () => {
		// Pins the extracted crossAxisOffset against all 12 combinations with
		// controlled rects: trigger 60x20 at (200,100), tooltip 100x40, gap 8.
		// A regression that lands on one axis pair and misses the other (the
		// exact hazard of the pre-extraction duplicated switches) reds here.
		const TRIGGER = { top: 100, left: 200, right: 260, bottom: 120, width: 60, height: 20 }
		const TIP = { top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }

		const withRects = async (props: Record<string, unknown>): Promise<string> => {
			const orig = Element.prototype.getBoundingClientRect
			Element.prototype.getBoundingClientRect = function (this: Element) {
				const r = tooltipRoot.contains(this) ? TIP : TRIGGER
				return { ...r, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect
			}
			try {
				const w = mountTooltip(props)
				await w.trigger("mouseenter")
				await flushPromises()
				await flushPromises()
				// The tip div sits INSIDE test-utils' <transition-stub>.
				const tip = tooltipRoot.querySelector("div") as HTMLElement | null
				return tip?.style.transform ?? ""
			} finally {
				Element.prototype.getBoundingClientRect = orig
			}
		}

		const cases: Array<[string, string, number, number]> = [
			// side, position, expected x, expected y
			["top", "center", 180, 52],
			["top", "start", 200, 52],
			["top", "end", 160, 52],
			["bottom", "center", 180, 128],
			["bottom", "start", 200, 128],
			["bottom", "end", 160, 128],
			["left", "center", 92, 90],
			["left", "start", 92, 100],
			["left", "end", 92, 80],
			["right", "center", 268, 90],
			["right", "start", 268, 100],
			["right", "end", 268, 80],
		]

		for (const [side, position, x, y] of cases) {
			test(`${side}/${position} → translate3d(${x}px, ${y}px, 0)`, async () => {
				expect(await withRects({ side, position })).toBe(`translate3d(${x}px, ${y}px,0)`)
			})
		}

		test("invalid position falls back to a 0 cross-axis coordinate (old fall-through preserved)", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			try {
				expect(await withRects({ side: "top", position: "diagonal" })).toBe("translate3d(0px, 52px,0)")
			} finally {
				warn.mockRestore()
			}
		})
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
