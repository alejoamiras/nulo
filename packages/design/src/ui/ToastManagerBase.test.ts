/**
 * ToastManagerBase teleports its two live regions into `teleportTo` (default `#toast`). The
 * composable `useToast` is module-scoped, so the tests drive the snack through it. Transitions run
 * for real: rAF is faked and stepped 16 ms at a time, and where a case needs the leave to last,
 * `getComputedStyle` reports a 0.15 s transition (jsdom computes none, so Vue would otherwise end a
 * leave after two frames).
 */
import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick } from "vue"
import { type ToastOptions, useToast } from "../composables/toast"
import ToastManagerBase from "./ToastManagerBase.vue"

// Auto-unmount between tests: every region shares the module-scope toast singleton, so a lingering
// instance from a prior test would also render the next test's toast.
enableAutoUnmount(afterEach)

const CARD = '[data-testid="snackbar"]'
let toastRoot: HTMLDivElement
const realComputedStyle = window.getComputedStyle.bind(window)

const STUBS = {
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: '<span data-testid="stub-mat-icon" :data-name="name" />', props: ["name", "size", "color"] },
	transition: false,
}

const mountRegion = (props: Record<string, unknown> = {}) =>
	mount(ToastManagerBase, { attachTo: document.body, props, global: { stubs: STUBS } })

const open = (options: ToastOptions) => useToast().openToast(options)
const cards = () => toastRoot.querySelectorAll(CARD)
const card = () => toastRoot.querySelector<HTMLElement>(CARD)
const status = () => toastRoot.querySelector('[role="status"]') as HTMLElement
const alert = () => toastRoot.querySelector('[role="alert"]') as HTMLElement

/** Flushes Vue, then advances fake time in 16 ms frames, flushing between frames. */
async function step(ms: number) {
	await nextTick()
	for (let t = 0; t < ms; t += 16) {
		vi.advanceTimersByTime(Math.min(16, ms - t))
		await nextTick()
	}
}

/** Long enough for any leave plus any enter with the 0.15 s stub (two frames + 151 ms each). */
const settle = () => step(600)

/** Vue reads the transition duration off computed style; the stub gives the cards one. */
function stubTransitionDuration() {
	vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
		if (el instanceof HTMLElement && el.closest("#toast")) {
			return {
				transitionDelay: "0s",
				transitionDuration: "0.15s",
				transitionProperty: "opacity, transform",
				animationDelay: "0s",
				animationDuration: "0s",
			} as unknown as CSSStyleDeclaration
		}
		return realComputedStyle(el, pseudo)
	})
}

/** Steps frame by frame until `until` holds, failing if two cards ever show at once. */
async function stepUntil(until: () => boolean, ms = 800) {
	for (let t = 0; t < ms; t += 16) {
		expect(cards().length, `${cards().length} cards at ${t} ms`).toBeLessThanOrEqual(1)
		if (until()) return
		vi.advanceTimersByTime(16)
		await nextTick()
	}
	throw new Error("the condition did not hold within the window")
}

const entered = (label: string) => () => {
	const el = card()
	return el !== null && el.textContent?.includes(label) === true && !/enter/.test(el.className)
}

const mouse = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: false }))
const pointerAt = (el: EventTarget, x: number, y: number) =>
	el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }))
/** A person reaching the card: the pointer moves across it. */
const moveOnto = (el: Element) => {
	pointerAt(el, 40, 30)
	pointerAt(el, 44, 31)
}

describe("ToastManagerBase", () => {
	beforeEach(() => {
		toastRoot = document.createElement("div")
		toastRoot.id = "toast"
		document.body.appendChild(toastRoot)
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
		})
		useToast().closeToast()
	})

	afterEach(() => {
		useToast().closeToast()
		toastRoot.remove()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	test("both regions exist before any toast, and each kind renders inside its own region", async () => {
		mountRegion()
		expect(status()).not.toBeNull()
		expect(alert()).not.toBeNull()
		expect(status().getAttribute("aria-live")).toBe("polite")
		expect(status().getAttribute("aria-atomic")).toBe("true")
		expect(alert().getAttribute("aria-atomic")).toBe("true")
		expect(cards().length).toBe(0)

		open({ kind: "success", label: "Saved" })
		await nextTick()
		expect(status().querySelector(CARD)?.getAttribute("data-kind")).toBe("success")
		expect(alert().querySelector(CARD)).toBeNull()
		expect(status().querySelector('[data-name="check-circle"]')?.getAttribute("data-color")).toBe("green")
		await settle()

		open({ kind: "error", label: "Failed" })
		await settle()
		expect(status().querySelector(CARD)).toBeNull()
		expect(alert().querySelector(CARD)?.getAttribute("data-kind")).toBe("error")
		expect(alert().querySelector('[data-name="close-circle"]')?.getAttribute("data-color")).toBe("red")
	})

	test("the same text opened twice renders twice: the second card is a new element", async () => {
		mountRegion()
		open({ kind: "success", label: "Copied" })
		await settle()
		const first = card()
		open({ kind: "success", label: "Copied" })
		await settle()
		const second = card()
		expect(second).not.toBeNull()
		expect(second).not.toBe(first)
		expect(first?.isConnected).toBe(false)
	})

	test.each([
		["same kind", { kind: "success", label: "First" }, { kind: "success", label: "Second" }],
		["success then error", { kind: "success", label: "First" }, { kind: "error", label: "Second" }],
		["error then success", { kind: "error", label: "First" }, { kind: "success", label: "Second" }],
	] as const)("a replacement (%s) never shows two cards at once and ends with the new one", async (_, a, b) => {
		stubTransitionDuration()
		mountRegion()
		open(a)
		await stepUntil(entered("First"))

		open(b)
		await nextTick()
		expect(cards().length).toBeLessThanOrEqual(1)
		await stepUntil(entered("Second"))
		expect(card()?.getAttribute("data-kind")).toBe(b.kind)
		expect(card()?.textContent).toContain("Second")
		expect(cards().length).toBe(1)
		expect(status().className).toBe(alert().className)
		expect(status().parentElement).toBe(alert().parentElement)
	})

	test("a close during a cross-kind leave installs nothing, on that frame or later", async () => {
		stubTransitionDuration()
		mountRegion()
		open({ kind: "success", label: "First" })
		await stepUntil(entered("First"))
		open({ kind: "error", label: "Second" })
		await step(16)
		useToast().closeToast()
		await settle()
		expect(cards().length).toBe(0)
		expect(toastRoot.textContent?.trim()).toBe("")
		await settle()
		expect(cards().length).toBe(0)
	})

	test("a second open during the wait: only the newest enters", async () => {
		stubTransitionDuration()
		mountRegion()
		open({ kind: "success", label: "First" })
		await stepUntil(entered("First"))
		open({ kind: "error", label: "Second" })
		await step(16)
		open({ kind: "error", label: "Third" })
		await stepUntil(entered("Third"))
		expect(cards().length).toBe(1)
		expect(toastRoot.textContent).not.toContain("Second")
		await settle()
		expect(cards().length).toBe(1)
		expect(card()?.textContent).toContain("Third")
	})

	test("unmounting during the wait renders nothing and throws nothing", async () => {
		stubTransitionDuration()
		const wrapper = mountRegion()
		open({ kind: "success", label: "First" })
		await stepUntil(entered("First"))
		open({ kind: "error", label: "Second" })
		await step(16)
		wrapper.unmount()
		await settle()
		expect(toastRoot.querySelectorAll(CARD).length).toBe(0)
	})

	test("title, sub and the action render; selecting the action closes first, then runs", async () => {
		mountRegion()
		const seen: unknown[] = []
		open({
			kind: "success",
			label: "Transaction submitted",
			sub: "1 TST to 0x1234…5678",
			action: { label: "View", onSelect: () => seen.push(useToast().toast.value) },
		})
		await settle()
		expect(card()?.querySelector('[data-testid="snackbar-title"]')?.textContent).toBe("Transaction submitted")
		expect(card()?.querySelector('[data-testid="snackbar-sub"]')?.textContent).toBe("1 TST to 0x1234…5678")
		const action = card()?.querySelector<HTMLButtonElement>('[data-testid="snackbar-action"]')
		expect(action?.textContent?.trim()).toBe("View")
		expect(card()?.querySelector('[data-testid="snackbar-close"]')).toBeNull()
		action?.click()
		await settle()
		expect(seen).toEqual([null])
		expect(cards().length).toBe(0)
	})

	test.each([
		["View", "success", "snackbar-action"],
		["×", "error", "snackbar-close"],
	] as const)("%s on a card leaving for a same-kind replacement acts on neither snack", async (_, kind, testid) => {
		stubTransitionDuration()
		mountRegion()
		const selected: string[] = []
		const action = (name: string) => ({ label: "View", onSelect: () => selected.push(name) })
		open({ kind, label: "Receipt A", action: action("A") })
		await stepUntil(entered("Receipt A"))

		open({ kind, label: "Receipt B", action: action("B") })
		await step(16)
		expect(card()?.textContent).toContain("Receipt A")
		card()?.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)?.click()
		expect(selected).toEqual([])
		expect(useToast().toast.value?.label).toBe("Receipt B")

		await stepUntil(entered("Receipt B"))
	})

	test("an error has × with aria-label Close, and × closes it", async () => {
		mountRegion()
		open({ kind: "error", label: "Failed" })
		await settle()
		expect(card()?.querySelector('[data-testid="snackbar-sub"]')).toBeNull()
		const close = card()?.querySelector<HTMLButtonElement>('[data-testid="snackbar-close"]')
		expect(close?.getAttribute("aria-label")).toBe("Close")
		expect(close?.getAttribute("type")).toBe("button")
		await step(60_000)
		expect(cards().length).toBe(1)
		close?.click()
		await settle()
		expect(cards().length).toBe(0)
		expect(useToast().toast.value).toBeNull()
	})

	test("× returns focus to where focus came from, when that element is still on the page", async () => {
		mountRegion()
		const origin = document.createElement("button")
		document.body.appendChild(origin)
		try {
			open({ kind: "error", label: "Failed" })
			await settle()
			origin.focus()
			const close = card()?.querySelector<HTMLButtonElement>('[data-testid="snackbar-close"]')
			close?.focus()
			expect(document.activeElement).toBe(close)
			close?.click()
			await settle()
			expect(document.activeElement).toBe(origin)
		} finally {
			origin.remove()
		}
	})

	test("a click on the card leaves the timer armed", async () => {
		mountRegion()
		open({ kind: "success", label: "Disposable" })
		await settle()
		card()?.click()
		await step(5_900 - 600)
		expect(cards().length).toBe(1)
		await step(100)
		expect(useToast().toast.value).toBeNull()
		await settle()
		expect(cards().length).toBe(0)
	})

	test("hover then focus: leaving the pointer keeps the hold while focus holds", async () => {
		mountRegion()
		open({ kind: "success", label: "Held", action: { label: "View", onSelect: () => {} } })
		await settle()
		const el = card() as HTMLElement
		moveOnto(el)
		await step(2_000)
		el.querySelector<HTMLButtonElement>('[data-testid="snackbar-action"]')?.focus()
		await step(60_000)
		mouse(el, "mouseleave")
		await step(60_000)
		expect(cards().length).toBe(1)
		el.querySelector<HTMLButtonElement>('[data-testid="snackbar-action"]')?.blur()
		await step(5_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("focus then hover: blurring keeps the hold while the pointer holds", async () => {
		mountRegion()
		open({ kind: "success", label: "Held", action: { label: "View", onSelect: () => {} } })
		await settle()
		const el = card() as HTMLElement
		const action = el.querySelector<HTMLButtonElement>('[data-testid="snackbar-action"]') as HTMLButtonElement
		action.focus()
		await step(2_000)
		moveOnto(el)
		await step(60_000)
		action.blur()
		await step(60_000)
		expect(cards().length).toBe(1)
		mouse(el, "mouseleave")
		await step(5_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("focus moving between two controls inside the card keeps the hold; leaving the card releases it", async () => {
		mountRegion()
		open({ kind: "success", label: "Held", action: { label: "View", onSelect: () => {} } })
		await settle()
		const el = card() as HTMLElement
		const action = el.querySelector<HTMLButtonElement>('[data-testid="snackbar-action"]') as HTMLButtonElement
		const title = el.querySelector('[data-testid="snackbar-title"]') as HTMLElement
		action.focus()
		await step(2_000)
		action.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: title }))
		await step(60_000)
		expect(cards().length).toBe(1)
		action.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }))
		await step(5_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("a card that opens under a still pointer runs its 6 s: hover events and moves under a pixel off hold nothing", async () => {
		mountRegion()
		pointerAt(document.body, 120, 540)
		open({ kind: "success", label: "Under the cursor" })
		await settle()
		const el = card() as HTMLElement
		mouse(el, "mouseover")
		mouse(el, "mouseenter")
		el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: 120, clientY: 540 }))
		pointerAt(el, 120, 540)
		pointerAt(el, 120.6, 539.4)
		await step(5_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("a replacement under a still pointer starts its own 6 s, though the card before it was held", async () => {
		mountRegion()
		open({ kind: "success", label: "First" })
		await settle()
		moveOnto(card() as HTMLElement)
		await step(60_000)
		expect(card()?.textContent).toContain("First")

		open({ kind: "success", label: "Second" })
		await settle()
		pointerAt(card() as HTMLElement, 44, 31)
		await step(5_399)
		expect(card()?.textContent).toContain("Second")
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("with no position known at the open, a first move at the card's spot holds nothing", async () => {
		mountRegion()
		open({ kind: "success", label: "Under the cursor" })
		await settle()
		pointerAt(card() as HTMLElement, 10, 10)
		await step(5_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("with no position known at the open, the first move anywhere is the rest spot: one move from there onto the card holds it", async () => {
		mountRegion()
		open({ kind: "success", label: "Reached" })
		await settle()
		const el = card() as HTMLElement
		pointerAt(document.body, 200, 10)
		await step(3_000)
		pointerAt(el, 40, 30)
		await step(60_000)
		expect(cards().length).toBe(1)
		mouse(el, "mouseleave")
		await step(2_399)
		expect(cards().length).toBe(1)
		await step(1)
		expect(useToast().toast.value).toBeNull()
	})

	test("bottomInset sets the wrap's bottom", () => {
		mountRegion({ bottomInset: 76 })
		const wrap = toastRoot.firstElementChild as HTMLElement
		expect(wrap.style.bottom).toBe("76px")
	})

	test("the default inset is 12px", () => {
		mountRegion()
		expect((toastRoot.firstElementChild as HTMLElement).style.bottom).toBe("12px")
	})

	test("inColumn narrows the card to the content column; without it the card keeps the viewport's width", () => {
		const wrapper = mountRegion({ inColumn: true })
		expect((toastRoot.firstElementChild as HTMLElement).className).toMatch(/in_column/)
		wrapper.unmount()
		mountRegion()
		expect((toastRoot.firstElementChild as HTMLElement).className).not.toMatch(/in_column/)
	})

	test("unmounting while held releases the hold", async () => {
		const wrapper = mountRegion()
		open({ kind: "success", label: "Held" })
		await settle()
		moveOnto(card() as HTMLElement)
		await step(1_000)
		wrapper.unmount()
		await step(6_000)
		expect(useToast().toast.value).toBeNull()
	})

	test("teleportTo overrides the target root", async () => {
		const custom = document.createElement("div")
		custom.id = "custom-toast"
		document.body.appendChild(custom)
		try {
			mountRegion({ teleportTo: "#custom-toast" })
			open({ kind: "success", label: "Elsewhere" })
			await nextTick()
			expect(custom.textContent).toContain("Elsewhere")
			expect(toastRoot.textContent).toBe("")
		} finally {
			custom.remove()
		}
	})
})
