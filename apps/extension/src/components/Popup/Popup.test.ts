import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick, ref } from "vue"

type Options = Record<string, unknown>
type FakeTrap = {
	active: boolean
	activate: () => void
	deactivate: (options?: Options) => void
	options: Options
	/** What was focused when the trap was created — what a real trap would record as the return target. */
	focusedAtCreate: Element | null
}

const traps: FakeTrap[] = []
vi.mock("focus-trap", () => ({
	createFocusTrap: vi.fn((_el: Element, options: Options) => {
		const trap: FakeTrap = {
			active: false,
			options,
			focusedAtCreate: document.activeElement,
			activate: vi.fn(() => {
				trap.active = true
			}),
			deactivate: vi.fn(() => {
				trap.active = false
			}),
		}
		traps.push(trap)
		return trap
	}),
}))
vi.mock("@/utils/core", () => ({ managers: { profile: { refreshSession: vi.fn() } } }))

import Popup from "./Popup.vue"

/** `Popup` reads the trap container off `Flex`'s exposed `wrapper`; the stub exposes its root the same way. */
const FlexStub = {
	template: '<div ref="wrapper"><slot /></div>',
	setup() {
		const wrapper = ref<HTMLElement>()
		return { wrapper }
	},
}

const mountPopup = (props: Record<string, unknown> = {}) =>
	mount(Popup, {
		props: { show: false, displaceIdx: 1, ...props },
		slots: { default: '<button data-testid="inside">in</button>' },
		attachTo: document.body,
		global: { stubs: { Flex: FlexStub } },
	})

const settle = async () => {
	await nextTick()
	await flushPromises()
}

/** Registry popups mount closed and are toggled open; the watcher is not immediate, so the harness does the same. */
const openPopup = async (props: Record<string, unknown> = {}) => {
	const w = mountPopup(props)
	await w.setProps({ show: true })
	await settle()
	return w
}

describe("Popup", () => {
	beforeEach(() => {
		traps.length = 0
		document.body.innerHTML = '<div id="popup"></div>'
	})
	afterEach(() => {
		document.body.innerHTML = ""
	})

	test("shown: one trap is created after the tick and activated on the wrapper", async () => {
		const w = mountPopup()
		await w.setProps({ show: true })
		expect(traps).toHaveLength(0)
		await settle()
		expect(traps).toHaveLength(1)
		expect(traps[0]?.active).toBe(true)
		expect(traps[0]?.options.fallbackFocus).toBe(document.querySelector('[data-testid="inside"]')?.parentElement)
		w.unmount()
	})

	test("unmounted before the tick: no trap is created", async () => {
		const w = mountPopup()
		await w.setProps({ show: true })
		w.unmount()
		await settle()
		expect(traps).toHaveLength(0)
	})

	test("unmounted while open: the active trap is released without moving focus", async () => {
		const w = await openPopup()
		const trap = traps[0]
		w.unmount()
		expect(trap?.deactivate).toHaveBeenCalledWith({ returnFocus: false })
		expect(trap?.active).toBe(false)
	})

	test("hidden: the trap is deactivated with focus returned to the opener", async () => {
		const w = await openPopup()
		await w.setProps({ show: false })
		await settle()
		expect(traps[0]?.deactivate).toHaveBeenCalledWith(undefined)
		expect(traps[0]?.active).toBe(false)
		w.unmount()
	})

	test("re-shown within the tick: exactly one trap ends up active, the first released", async () => {
		const w = await openPopup()
		await w.setProps({ show: false })
		await w.setProps({ show: true })
		await settle()
		expect(traps).toHaveLength(2)
		expect(traps.map((t) => t.active)).toEqual([false, true])
		w.unmount()
	})

	test("by default Escape is swallowed, onClose emitted, and the trap is left to the close", async () => {
		const w = await openPopup()
		const onEscape = traps[0]?.options.escapeDeactivates as (event: KeyboardEvent) => boolean
		const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
		expect(onEscape(event)).toBe(false)
		expect(event.defaultPrevented).toBe(true)
		expect(w.emitted("onClose")).toEqual([[]])
		expect(traps[0]?.active).toBe(true)
		w.unmount()
	})

	test("closeOnEscape false: the trap ignores Escape rather than releasing, and nothing is emitted", async () => {
		const w = await openPopup({ closeOnEscape: false })
		expect(traps[0]?.options.escapeDeactivates).toBe(false)
		expect(w.emitted("onClose")).toBeUndefined()
		w.unmount()
	})

	test("focus returns to what was focused when the popup was shown, even if a child focuses its own input first", async () => {
		document.body.insertAdjacentHTML("beforeend", '<button id="opener">open</button>')
		const opener = document.querySelector<HTMLElement>("#opener")
		opener?.focus()
		const w = mountPopup()
		const shown = w.setProps({ show: true })
		// Queued before the popup's own tick, like a form focusing its first field from onShow.
		void nextTick(() => document.querySelector<HTMLElement>('[data-testid="inside"]')?.focus())
		await shown
		await settle()
		expect(traps[0]?.focusedAtCreate).toBe(document.querySelector('[data-testid="inside"]'))
		expect(traps[0]?.options.setReturnFocus).toBe(opener)
		w.unmount()
	})

	test("initialFocus is handed to the trap; off by default", async () => {
		const a = await openPopup()
		expect(traps[0]?.options.initialFocus).toBe(false)
		a.unmount()
		const b = await openPopup({ initialFocus: "#title" })
		expect(traps[1]?.options.initialFocus).toBe("#title")
		b.unmount()
	})
})
