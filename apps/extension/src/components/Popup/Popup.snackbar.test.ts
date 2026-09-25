/**
 * The popup's trap on the real focus-trap with the snack as its second container: what Tab
 * visits, and what × and Escape do to the popup and the snack. jsdom reports no client rects and
 * moves no focus on Tab, so the harness supplies both: one rect for every connected element
 * (tabbable's display check) and, when the trap leaves a Tab alone, the browser's default — a
 * step to the next tabbable in DOM order.
 */
import { Flex, ToastManagerBase } from "@nulo/design"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { defineComponent, nextTick } from "vue"
import { useSnackInset, vSnackFooter } from "@/composables/snackInset"
import { useToast } from "@/composables/toast"

vi.mock("@/utils/core", () => ({ managers: { profile: { refreshSession: vi.fn() } } }))

import Popup from "./Popup.vue"

enableAutoUnmount(afterEach)

const byTestId = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
const activeTestId = () => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "none"
const snack = () => byTestId("snackbar")
const popupOpen = () => byTestId("popup-content") !== null
const realGetClientRects = Element.prototype.getClientRects

/** focus-trap activates after a tick and returns focus on a timer. */
const settle = async () => {
	await nextTick()
	await flushPromises()
	await new Promise((resolve) => setTimeout(resolve, 0))
	await flushPromises()
}

/** The browser's default Tab: the next (or previous) tabbable in DOM order, wrapping at the ends. */
function nativeTab(from: Element, backward: boolean) {
	const all = [...document.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]")].filter(
		(el) => el.tabIndex >= 0 && !el.matches(":disabled"),
	)
	const at = all.indexOf(from as HTMLElement)
	all[(at + (backward ? -1 : 1) + all.length) % all.length]?.focus()
}

async function pressTab(backward = false): Promise<string> {
	const from = document.activeElement ?? document.body
	const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: backward, bubbles: true, cancelable: true })
	from.dispatchEvent(event)
	if (!event.defaultPrevented) nativeTab(from, backward)
	await settle()
	return activeTestId()
}

const pressEscape = async (target: Element) => {
	target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
	await settle()
}

const STUBS = { Icon: { template: "<i />" }, MaterialIcon: { template: "<i />" } }

const mountHost = (template: string) =>
	mount(
		{ components: { Popup, ToastManagerBase }, data: () => ({ show: false, second: false }), template },
		{ attachTo: document.body, global: { components: { Flex }, stubs: STUBS } },
	)

const OPENER = '<button data-testid="opener" @click="show = true">open</button>'
const POPUP = `<Popup :show="show" :displaceIdx="1" @onClose="show = false">
	<div data-testid="popup-content"><button data-testid="first">a</button><button data-testid="second">b</button></div>
</Popup>`
const TOP = `<Popup :show="second" :displaceIdx="2" @onClose="second = false">
	<div data-testid="top-content"><button data-testid="top-first">c</button><button data-testid="top-second">d</button></div>
</Popup>`

/** Opens the popup from a focused opener, the way a page does. */
async function openFromOpener(): Promise<HTMLElement> {
	const opener = byTestId("opener") as HTMLElement
	opener.focus()
	opener.click()
	await settle()
	return opener
}

async function openError() {
	useToast().openToast({ kind: "error", label: "Couldn't copy" })
	await settle()
}

describe("Popup with a snack", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="popup"></div><div id="toast"></div>'
		Element.prototype.getClientRects = function (this: Element) {
			return (this.isConnected ? [{}] : []) as unknown as DOMRectList
		}
	})
	afterEach(() => {
		Element.prototype.getClientRects = realGetClientRects
		useToast().closeToast()
		document.body.innerHTML = ""
	})

	test("Tab from the first control visits the popup's controls in order, then the snack's ×, then the first control again", async () => {
		mountHost(`<div>${OPENER}${POPUP}<ToastManagerBase /></div>`)
		await openFromOpener()
		await openError()
		byTestId("first")?.focus()
		expect([await pressTab(), await pressTab(), await pressTab()]).toEqual(["second", "snackbar-close", "first"])
		expect(await pressTab(true)).toBe("snackbar-close")
	})

	test("two popups stacked: only the top one's controls and the snack cycle", async () => {
		mountHost(
			`<div>${OPENER}<button data-testid="opener-2" @click="second = true">more</button>${POPUP}${TOP}<ToastManagerBase /></div>`,
		)
		await openFromOpener()
		byTestId("opener-2")?.click()
		await settle()
		await openError()
		byTestId("top-first")?.focus()
		const visited = [await pressTab(), await pressTab(), await pressTab(), await pressTab()]
		expect(visited).toEqual(["top-second", "snackbar-close", "top-first", "top-second"])
	})

	test("× by keyboard closes the snack, keeps the popup and returns focus to the control it came from", async () => {
		mountHost(`<div>${OPENER}${POPUP}<ToastManagerBase /></div>`)
		await openFromOpener()
		await openError()
		byTestId("second")?.focus()
		expect(await pressTab()).toBe("snackbar-close")
		;(document.activeElement as HTMLElement).click()
		await settle()
		expect(snack()).toBeNull()
		expect(popupOpen()).toBe(true)
		expect(activeTestId()).toBe("second")
	})

	test("Escape on the snack's × closes the popup and leaves the snack", async () => {
		mountHost(`<div>${OPENER}${POPUP}<ToastManagerBase /></div>`)
		const opener = await openFromOpener()
		await openError()
		byTestId("second")?.focus()
		expect(await pressTab()).toBe("snackbar-close")
		await pressEscape(document.activeElement as Element)
		expect(popupOpen()).toBe(false)
		expect(snack()).not.toBeNull()
		expect(document.activeElement).toBe(opener)
	})

	test("a popup with no tabbable control focuses its wrapper", async () => {
		mountHost(`<div>${OPENER}<Popup :show="show" :displaceIdx="1" @onClose="show = false">
			<div data-testid="popup-content">nothing to press</div>
		</Popup><ToastManagerBase /></div>`)
		await openFromOpener()
		await pressTab()
		const wrapper = document.querySelector("#popup > *")
		expect(wrapper?.getAttribute("tabindex")).toBe("-1")
		expect(document.activeElement).toBe(wrapper)
	})

	test("with no `#toast` anchor the cycle is the popup's controls alone", async () => {
		document.body.innerHTML = '<div id="popup"></div>'
		mountHost(`<div>${OPENER}${POPUP}</div>`)
		await openFromOpener()
		byTestId("first")?.focus()
		expect([await pressTab(), await pressTab()]).toEqual(["second", "first"])
	})
})

describe("Popup and the snack's place", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="popup"></div>'
		vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600)
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const top = this.dataset.top
			return DOMRect.fromRect({ x: 0, y: Number(top ?? 0), width: 360, height: top ? 40 : 0 })
		})
	})
	afterEach(() => {
		vi.restoreAllMocks()
		document.body.innerHTML = ""
	})

	test("the popup drawn on top places the snack, though a lower one mounted after it", async () => {
		let inset = { value: -1 }
		const Host = defineComponent({
			setup() {
				inset = useSnackInset(() => 76)
				return () => null
			},
		})
		const wrapper = mount(
			{
				components: { Popup, Host },
				directives: { snackFooter: vSnackFooter },
				data: () => ({ lower: false }),
				template: `<div><Host />
					<Popup :show="true" :displaceIdx="2"><div v-snack-footer data-top="420" /></Popup>
					<Popup :show="lower" :displaceIdx="1"><div v-snack-footer data-top="540" /></Popup>
				</div>`,
			},
			{ attachTo: document.body, global: { components: { Flex }, stubs: STUBS } },
		)
		const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
		await settle()
		await frame()
		expect(inset.value).toBe(600 - 420 + 12)

		await wrapper.setData({ lower: true })
		await settle()
		await frame()
		expect(inset.value).toBe(600 - 420 + 12)
	})
})
