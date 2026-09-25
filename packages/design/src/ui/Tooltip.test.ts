/**
 * Tooltip teleports its content to `teleportTo` (default `#tooltip`), so observability relies on the
 * document, not the wrapper. Tests append a teleport target to `document.body` and assert its contents.
 */
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Tooltip from "./Tooltip.vue"

enableAutoUnmount(afterEach)

let tooltipRoot: HTMLDivElement

const mountTooltip = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Tooltip, {
		props,
		slots: { default: "<button>trigger</button>", content: "Tip body", ...slots },
		attachTo: document.body,
	})

const bubble = () => tooltipRoot.querySelector<HTMLElement>('[data-testid="tooltip-bubble"]')
const isOpen = () => bubble() !== null

const escapeKey = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })

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

	test("focusout hides the tooltip at once", async () => {
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

	describe("pointer onto the bubble", () => {
		test("leaving the trigger keeps it open 150ms, then closes it", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			await w.trigger("mouseleave")
			vi.advanceTimersByTime(149)
			await flushPromises()
			expect(isOpen()).toBe(true)
			vi.advanceTimersByTime(1)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test("entering the bubble keeps it open, and leaving the bubble closes it after 150ms", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			await w.trigger("mouseleave")
			const onBubble = new DOMWrapper(bubble() as HTMLElement)
			await onBubble.trigger("mouseenter")
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(true)
			await onBubble.trigger("mouseleave")
			vi.advanceTimersByTime(149)
			await flushPromises()
			expect(isOpen()).toBe(true)
			vi.advanceTimersByTime(1)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test("entering the trigger again keeps it open", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			await w.trigger("mouseleave")
			vi.advanceTimersByTime(100)
			await w.trigger("mouseenter")
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(true)
		})

		test("leaving before the delay fires means it never opens", async () => {
			const w = mountTooltip({ delay: 300 })
			await w.trigger("mouseenter")
			vi.advanceTimersByTime(200)
			await w.trigger("mouseleave")
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test("hover, leave, then focus: the focused tooltip stays open", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			await w.trigger("mouseleave")
			await w.find("button").trigger("focusin")
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(true)
		})

		test("a click on the bubble never reaches what it covers, and a press on it keeps focus", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			await flushPromises()
			const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
			bubble()?.dispatchEvent(down)
			expect(down.defaultPrevented).toBe(true)
			const onDocument = vi.fn()
			document.addEventListener("click", onDocument)
			bubble()?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
			document.removeEventListener("click", onDocument)
			expect(onDocument).not.toHaveBeenCalled()
		})
	})

	describe("Escape", () => {
		test("closes it, marks the key handled, and no document listener sees it", async () => {
			const w = mountTooltip()
			await w.find("button").trigger("focusin")
			const onDocument = vi.fn()
			document.addEventListener("keydown", onDocument)
			const event = escapeKey()
			w.find("button").element.dispatchEvent(event)
			document.removeEventListener("keydown", onDocument)
			await flushPromises()
			expect(isOpen()).toBe(false)
			expect(event.defaultPrevented).toBe(true)
			expect(onDocument).not.toHaveBeenCalled()
		})

		test("leaves the key alone while closed", async () => {
			const w = mountTooltip()
			const onDocument = vi.fn()
			document.addEventListener("keydown", onDocument)
			const event = escapeKey()
			w.find("button").element.dispatchEvent(event)
			document.removeEventListener("keydown", onDocument)
			expect(onDocument).toHaveBeenCalledTimes(1)
			expect(event.defaultPrevented).toBe(false)
		})

		test("hover, focus, then Escape: no pending timer reopens it", async () => {
			const w = mountTooltip({ delay: 300 })
			await w.trigger("mouseenter")
			await w.find("button").trigger("focusin")
			window.dispatchEvent(escapeKey())
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test("sets no latch: after Escape on the bubble, the next hover opens it after the delay", async () => {
			const w = mountTooltip({ delay: 300 })
			await w.trigger("mouseenter")
			vi.advanceTimersByTime(300)
			await flushPromises()
			await w.trigger("mouseleave")
			await new DOMWrapper(bubble() as HTMLElement).trigger("mouseenter")
			window.dispatchEvent(escapeKey())
			await flushPromises()
			expect(isOpen()).toBe(false)
			await w.trigger("mouseenter")
			vi.advanceTimersByTime(299)
			await flushPromises()
			expect(isOpen()).toBe(false)
			vi.advanceTimersByTime(1)
			await flushPromises()
			expect(isOpen()).toBe(true)
		})
	})

	describe("a press on a control inside the trigger", () => {
		test.each([
			["pointerdown", "pointerdown", { pointerType: "mouse" }],
			["Enter", "keydown", { key: "Enter" }],
			["Space", "keydown", { key: " " }],
			["a click alone", "click", {}],
		])("%s closes it", async (_name, event, options) => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			expect(isOpen()).toBe(true)
			await w.find("button").trigger(event, options)
			expect(isOpen()).toBe(false)
		})

		test.each([
			["Enter", () => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })],
			["a click", () => new MouseEvent("click", { bubbles: true, cancelable: true })],
		])("%s on a control that stops propagation still closes it, and the control still acts", async (_name, make) => {
			const activate = vi.fn()
			const w = mount(
				{
					components: { Tooltip },
					setup: () => ({ activate }),
					template: `<Tooltip><span role="button" tabindex="0" @click.stop="activate" @keydown.enter.stop="activate">x</span><template #content>Tip body</template></Tooltip>`,
				},
				{ attachTo: document.body },
			)
			const control = w.find("span")
			await control.trigger("focusin")
			expect(isOpen()).toBe(true)
			// Vue skips a listener attached no earlier than the event's first Vue handler ran, and fake
			// time stands still, so the control's own listener would never run without this.
			vi.advanceTimersByTime(1)
			const event = make()
			control.element.dispatchEvent(event)
			await flushPromises()
			expect(isOpen()).toBe(false)
			expect(activate).toHaveBeenCalledTimes(1)
			expect(event.defaultPrevented).toBe(false)
		})

		test("cancels a pending open", async () => {
			const w = mountTooltip({ delay: 300 })
			await w.trigger("mouseenter")
			await w.find("button").trigger("pointerdown", { pointerType: "mouse" })
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test.each(["Enter", " "])("does not prevent the %j keydown, so the button still clicks", async (key) => {
			const w = mountTooltip()
			await w.trigger("focusin")
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
			w.find("button").element.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(false)
		})

		test("the focusin that follows stays closed until focus leaves; a later focusin opens it", async () => {
			const w = mountTooltip()
			const button = w.find("button")
			await button.trigger("pointerdown", { pointerType: "mouse" })
			await button.trigger("focusin")
			expect(isOpen()).toBe(false)
			await button.trigger("focusout")
			await button.trigger("focusin")
			expect(isOpen()).toBe(true)
		})

		test.each(["mouse", "pen"])("after a keyboard press, a %s arriving opens it after the delay", async (pointerType) => {
			const w = mountTooltip({ delay: 300 })
			await w.find("button").trigger("keydown", { key: "Enter" })
			await w.trigger("pointerenter", { pointerType })
			await w.trigger("mouseenter")
			vi.advanceTimersByTime(300)
			await flushPromises()
			expect(isOpen()).toBe(true)
		})

		test("a tap's compatibility mouseenter does not clear the latch before its focus", async () => {
			const w = mountTooltip()
			const button = w.find("button")
			await button.trigger("pointerdown", { pointerType: "touch" })
			await w.trigger("touchend")
			await w.trigger("mouseenter")
			await button.trigger("focusin")
			vi.advanceTimersByTime(1_000)
			await flushPromises()
			expect(isOpen()).toBe(false)
		})

		test("a press on a plain focusable span is not a control press", async () => {
			const w = mountTooltip({}, { default: '<span tabindex="0">term</span>' })
			const term = w.find("span")
			await term.trigger("pointerdown", { pointerType: "mouse" })
			await term.trigger("focusin")
			expect(isOpen()).toBe(true)
			const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
			term.element.dispatchEvent(space)
			await flushPromises()
			expect(space.defaultPrevented).toBe(false)
			expect(isOpen()).toBe(true)
		})
	})

	describe("unmount", () => {
		const assertNothingLeft = () => {
			expect(vi.getTimerCount()).toBe(0)
			const onDocument = vi.fn()
			document.addEventListener("keydown", onDocument)
			const event = escapeKey()
			document.body.dispatchEvent(event)
			document.removeEventListener("keydown", onDocument)
			expect(onDocument).toHaveBeenCalledTimes(1)
			expect(event.defaultPrevented).toBe(false)
		}

		const mountHost = (delay = 0) =>
			mount(
				{
					components: { Tooltip },
					data: () => ({ shown: true }),
					template: `<div><Tooltip v-if="shown" :delay="${delay}"><button>trigger</button><template #content>Tip body</template></Tooltip></div>`,
				},
				{ attachTo: document.body },
			)

		test("while an open is pending", async () => {
			const host = mountHost(300)
			await host.find("button").trigger("mouseenter")
			await host.setData({ shown: false })
			assertNothingLeft()
		})

		test("while a close is pending", async () => {
			const host = mountHost()
			await host.find("button").trigger("mouseenter")
			await host.find("button").trigger("mouseleave")
			await host.setData({ shown: false })
			assertNothingLeft()
		})

		test("while open", async () => {
			const host = mountHost()
			await host.find("button").trigger("focusin")
			expect(isOpen()).toBe(true)
			await host.setData({ shown: false })
			assertNothingLeft()
		})
	})

	describe("bubble", () => {
		test("is a tooltip with testids on the bubble and its text", async () => {
			const w = mountTooltip()
			await w.trigger("mouseenter")
			expect(bubble()?.getAttribute("role")).toBe("tooltip")
			expect(bubble()?.querySelector('[data-testid="tooltip-text"]')?.textContent).toContain("Tip body")
		})

		test("inline puts the inline class on the wrapper and the trigger", () => {
			const plain = mountTooltip()
			const inline = mountTooltip({ inline: true })
			const inlineClass = inline.classes().find((c) => !plain.classes().includes(c))
			expect(inlineClass).toBeDefined()
			expect(inline.find("button").element.parentElement?.classList.contains(inlineClass as string)).toBe(true)
			expect(plain.find("button").element.parentElement?.classList.contains(inlineClass as string)).toBe(false)
		})

		test("renders a long unbroken string and a tall text", async () => {
			const long = "0x".padEnd(200, "f")
			const tall = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("<br>")
			const w = mountTooltip({}, { content: `<span>${long}</span><div>${tall}</div>` })
			await w.trigger("mouseenter")
			expect(bubble()?.textContent).toContain(long)
			expect(bubble()?.textContent).toContain("line 39")
		})
	})

	describe("positioning geometry (side × position matrix)", () => {
		// Every case fits jsdom's 1024x768 window, so the clamp leaves it where its side puts it.
		const TRIGGER = { top: 100, left: 200, right: 260, bottom: 120, width: 60, height: 20 }
		const TIP = { top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }

		type Rect = typeof TRIGGER
		type Viewport = { width: number; height: number }

		const setViewport = ({ width, height }: Viewport) => {
			Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
			Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
		}

		const stubGeometry = (trigger: Rect, viewport?: Viewport) => {
			const orig = Element.prototype.getBoundingClientRect
			const size = { width: window.innerWidth, height: window.innerHeight }
			Element.prototype.getBoundingClientRect = function (this: Element) {
				const r = tooltipRoot.contains(this) ? TIP : trigger
				return { ...r, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect
			}
			if (viewport) setViewport(viewport)
			return () => {
				Element.prototype.getBoundingClientRect = orig
				setViewport(size)
			}
		}

		const withRects = async (
			props: Record<string, unknown>,
			{ trigger = TRIGGER, viewport }: { trigger?: Rect; viewport?: Viewport } = {},
		): Promise<string> => {
			const restore = stubGeometry(trigger, viewport)
			try {
				const w = mountTooltip(props)
				await w.trigger("mouseenter")
				await flushPromises()
				await flushPromises()
				return bubble()?.style.transform ?? ""
			} finally {
				restore()
			}
		}

		const cases: Array<[string, string, number, number]> = [
			// side, position, expected x, expected y
			["top", "center", 180, 54],
			["top", "start", 200, 54],
			["top", "end", 160, 54],
			["bottom", "center", 180, 126],
			["bottom", "start", 200, 126],
			["bottom", "end", 160, 126],
			["left", "center", 94, 90],
			["left", "start", 94, 100],
			["left", "end", 94, 80],
			["right", "center", 266, 90],
			["right", "start", 266, 100],
			["right", "end", 266, 80],
		]

		for (const [side, position, x, y] of cases) {
			test(`${side}/${position} → translate3d(${x}px, ${y}px, 0)`, async () => {
				expect(await withRects({ side, position })).toBe(`translate3d(${x}px, ${y}px,0)`)
			})
		}

		test("an invalid position lands on the left inset (the validator only warns)", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			try {
				expect(await withRects({ side: "top", position: "diagonal" })).toBe("translate3d(8px, 54px,0)")
			} finally {
				warn.mockRestore()
			}
		})

		test("flips above a trigger at the bottom of the window", async () => {
			const trigger = { top: 560, left: 200, right: 260, bottom: 580, width: 60, height: 20 }
			expect(await withRects({}, { trigger, viewport: { width: 360, height: 600 } })).toBe("translate3d(180px, 514px,0)")
		})

		test("shifts left of a trigger at the right edge", async () => {
			const trigger = { top: 100, left: 320, right: 350, bottom: 120, width: 30, height: 20 }
			expect(await withRects({}, { trigger, viewport: { width: 360, height: 600 } })).toBe("translate3d(252px, 126px,0)")
		})

		test("shifts right of a trigger at the left edge", async () => {
			const trigger = { top: 100, left: 0, right: 20, bottom: 120, width: 20, height: 20 }
			expect(await withRects({}, { trigger, viewport: { width: 360, height: 600 } })).toBe("translate3d(8px, 126px,0)")
		})

		test("an open bubble that no longer fits after the window narrows moves back inside", async () => {
			const trigger = { top: 100, left: 250, right: 280, bottom: 120, width: 30, height: 20 }
			const restore = stubGeometry(trigger, { width: 360, height: 600 })
			try {
				const w = mountTooltip()
				await w.trigger("mouseenter")
				await flushPromises()
				expect(bubble()?.style.transform).toBe("translate3d(215px, 126px,0)")
				setViewport({ width: 300, height: 600 })
				window.dispatchEvent(new Event("resize"))
				await flushPromises()
				expect(bubble()?.style.transform).toBe("translate3d(192px, 126px,0)")
			} finally {
				restore()
			}
		})

		test("stops listening for resize once closed, and once unmounted while open", async () => {
			const add = vi.spyOn(window, "addEventListener")
			const remove = vi.spyOn(window, "removeEventListener")
			const resizeListener = () => add.mock.calls.findLast(([type]) => type === "resize")?.[1]
			try {
				const closed = mountTooltip()
				await closed.trigger("focusin")
				const first = resizeListener()
				expect(first).toBeDefined()
				await closed.trigger("focusout")
				expect(remove).toHaveBeenCalledWith("resize", first)

				const unmounted = mountTooltip()
				await unmounted.trigger("focusin")
				const second = resizeListener()
				expect(second).toBeDefined()
				unmounted.unmount()
				expect(remove).toHaveBeenCalledWith("resize", second)
			} finally {
				add.mockRestore()
				remove.mockRestore()
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
