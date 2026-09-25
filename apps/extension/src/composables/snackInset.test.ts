import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { defineComponent, h, nextTick, ref, withDirectives } from "vue"
import { useToast } from "@/composables/toast"
import { SNACK_GAP, snackInset, useSnackInset, vSnackFooter, vSnackSheet } from "./snackInset"

const VIEWPORT = 600
const NAV_BASE = 76

enableAutoUnmount(afterEach)

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** A footer whose box is read from its `data-top` / `data-height`, as the stubbed rect reports it. */
const Footer = defineComponent({
	props: { top: { type: Number, required: true }, height: { type: Number, default: 60 } },
	setup: (props) => () =>
		withDirectives(h("div", { "data-top": props.top, "data-height": props.height, "data-testid": "footer" }), [[vSnackFooter]]),
})

/** An open sheet holding whatever footers it is given. */
const Sheet = defineComponent({
	setup:
		(_, { slots }) =>
		() =>
			withDirectives(h("div", { "data-testid": "sheet" }, slots.default?.()), [[vSnackSheet]]),
})

const base = ref(NAV_BASE)
let inset: { value: number } = { value: -1 }

const Host = defineComponent({
	setup() {
		inset = useSnackInset(() => base.value)
		return () => h("div")
	},
})

let observed: Element[] = []
let notifyResize: () => void = () => {}

beforeEach(() => {
	base.value = NAV_BASE
	observed = []
	vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(VIEWPORT)
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		const top = Number(this.dataset.top ?? 0)
		const height = Number(this.dataset.height ?? 0)
		return DOMRect.fromRect({ x: 0, y: top, width: 360, height })
	})
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				notifyResize = callback
			}
			observe(el: Element) {
				observed.push(el)
			}
			disconnect() {
				observed = []
			}
		},
	)
})

afterEach(() => {
	useToast().closeToast()
	vi.restoreAllMocks()
})

describe("snackInset", () => {
	test("keeps the base when nothing places the snack", () => {
		expect(snackInset(NAV_BASE, VIEWPORT, [])).toBe(NAV_BASE)
	})

	test("sits SNACK_GAP above a footer's top edge, and the highest footer wins", () => {
		expect(snackInset(SNACK_GAP, VIEWPORT, [{ top: 520, bottom: 600 }])).toBe(92)
		expect(
			snackInset(SNACK_GAP, VIEWPORT, [
				{ top: 540, bottom: 600 },
				{ top: 480, bottom: 530 },
			]),
		).toBe(132)
	})

	test("never drops below the base", () => {
		expect(snackInset(NAV_BASE, VIEWPORT, [{ top: 590, bottom: 600 }])).toBe(NAV_BASE)
	})

	test("ignores a footer with no height and one whose top edge is off screen", () => {
		expect(
			snackInset(SNACK_GAP, VIEWPORT, [
				{ top: 500, bottom: 500 },
				{ top: 640, bottom: 700 },
				{ top: 0, bottom: 40 },
			]),
		).toBe(SNACK_GAP)
	})

	test("a footer below the fold counts where it stops once the page is scrolled to its end", () => {
		// A 500px window over a 600px page: the page's 73px footer starts at 527 and stops at 427.
		expect(snackInset(SNACK_GAP, 500, [{ top: 527, bottom: 600 }], 100)).toBe(500 - 427 + SNACK_GAP)
		expect(snackInset(SNACK_GAP, 500, [{ top: 900, bottom: 973 }], 100)).toBe(SNACK_GAP)
		expect(snackInset(SNACK_GAP, 500, [{ top: 700, bottom: 773 }], 1_000)).toBe(SNACK_GAP)
	})

	test("where the page cannot scroll further, a footer on screen keeps the inset it had: pinned, or a long page at its end", () => {
		expect(snackInset(SNACK_GAP, VIEWPORT, [{ top: 520, bottom: 600 }])).toBe(VIEWPORT - 520 + SNACK_GAP)
		expect(snackInset(SNACK_GAP, 500, [{ top: 427, bottom: 500 }], 0)).toBe(500 - 427 + SNACK_GAP)
	})

	test("while the page can still scroll, a footer on screen also counts where it stops at the end", () => {
		// The same page with the footer grown by an error line: its top peeks 1px onto the screen.
		expect(snackInset(SNACK_GAP, 500, [{ top: 499, bottom: 600 }], 100)).toBe(500 - 399 + SNACK_GAP)
		// One that would scroll off the top before the page's end counts where it is.
		expect(snackInset(SNACK_GAP, 500, [{ top: 300, bottom: 373 }], 400)).toBe(500 - 300 + SNACK_GAP)
	})
})

describe("useSnackInset", () => {
	test("a page footer raises the snack after the next frame and its removal restores the base", async () => {
		base.value = SNACK_GAP
		mount(Host)
		const show = ref(true)
		mount(defineComponent({ setup: () => () => (show.value ? h(Footer, { top: 520 }) : null) }), { attachTo: document.body })
		await frame()
		expect(inset.value).toBe(VIEWPORT - 520 + SNACK_GAP)

		show.value = false
		await frame()
		await frame()
		expect(inset.value).toBe(SNACK_GAP)
	})

	test("an open sheet covers the nav: SNACK_GAP from the bottom, page footers ignored, 76 again once it closes", async () => {
		mount(Host)
		const open = ref(true)
		mount(defineComponent({ setup: () => () => [h(Footer, { top: 500 }), open.value ? h(Sheet) : null] }), {
			attachTo: document.body,
		})
		await frame()
		expect(inset.value).toBe(SNACK_GAP)

		open.value = false
		await frame()
		await frame()
		expect(inset.value).toBe(VIEWPORT - 500 + SNACK_GAP)
	})

	test("only the top sheet's own footer counts; closing it hands placement to the sheet beneath", async () => {
		mount(Host)
		const topOpen = ref(true)
		mount(
			defineComponent({
				setup: () => () => [
					h(Sheet, null, () => h(Footer, { top: 540 })),
					topOpen.value ? h(Sheet, null, () => h(Footer, { top: 420 })) : null,
				],
			}),
			{ attachTo: document.body },
		)
		await frame()
		expect(inset.value).toBe(VIEWPORT - 420 + SNACK_GAP)

		topOpen.value = false
		await frame()
		await frame()
		expect(inset.value).toBe(VIEWPORT - 540 + SNACK_GAP)
	})

	test("a footer that grows moves the snack with it", async () => {
		base.value = SNACK_GAP
		mount(Host)
		const wrapper = mount(Footer, { props: { top: 520 }, attachTo: document.body })
		await frame()
		expect(observed).toContain(wrapper.element)

		;(wrapper.element as HTMLElement).dataset.top = "490"
		notifyResize()
		await frame()
		expect(inset.value).toBe(VIEWPORT - 490 + SNACK_GAP)
	})

	test.each([
		["scroll", () => document.body],
		["transitionend", () => document.body],
		["animationend", () => document.body],
		["resize", () => window],
	] as const)("a %s measures again", async (type, target) => {
		base.value = SNACK_GAP
		mount(Host)
		const wrapper = mount(Footer, { props: { top: 540 }, attachTo: document.body })
		await frame()
		;(wrapper.element as HTMLElement).dataset.top = "500"
		target().dispatchEvent(new Event(type, { bubbles: false }))
		await frame()
		expect(inset.value).toBe(VIEWPORT - 500 + SNACK_GAP)
	})

	test("in a window shorter than the page, the snack waits above where the footer stops, and scrolling there keeps it", async () => {
		base.value = SNACK_GAP
		vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(VIEWPORT + 100)
		const scrollTop = vi.spyOn(document.documentElement, "scrollTop", "get").mockReturnValue(0)
		mount(Host)
		const wrapper = mount(Footer, { props: { top: 627, height: 73 }, attachTo: document.body })
		await frame()
		expect(inset.value).toBe(VIEWPORT - 527 + SNACK_GAP)

		scrollTop.mockReturnValue(100)
		;(wrapper.element as HTMLElement).dataset.top = "527"
		document.dispatchEvent(new Event("scroll"))
		await frame()
		expect(inset.value).toBe(VIEWPORT - 527 + SNACK_GAP)
	})

	test("a snack opening measures at once, before any frame", async () => {
		base.value = SNACK_GAP
		mount(Host)
		const wrapper = mount(Footer, { props: { top: 540 }, attachTo: document.body })
		await frame()
		;(wrapper.element as HTMLElement).dataset.top = "470"
		useToast().openToast({ kind: "error", label: "Send failed" })
		await nextTick()
		expect(inset.value).toBe(VIEWPORT - 470 + SNACK_GAP)
	})

	test("the base follows its source", async () => {
		mount(Host)
		expect(inset.value).toBe(NAV_BASE)
		base.value = SNACK_GAP
		await frame()
		expect(inset.value).toBe(SNACK_GAP)
	})

	test("disposing stops observing and measuring", async () => {
		base.value = SNACK_GAP
		const host = mount(Host)
		mount(Footer, { props: { top: 520 }, attachTo: document.body })
		await frame()
		const measured = inset.value
		host.unmount()
		expect(observed).toEqual([])

		mount(Footer, { props: { top: 400 }, attachTo: document.body })
		document.dispatchEvent(new Event("scroll"))
		await frame()
		expect(inset.value).toBe(measured)
	})
})
