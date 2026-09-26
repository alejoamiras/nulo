import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { defineComponent, h, nextTick, ref } from "vue"

type Options = Record<string, unknown>
type FakeTrap = {
	active: boolean
	activate: () => void
	deactivate: (options?: Options) => void
	containers: Element | Element[]
	options: Options
	/** What was focused when the trap was created — what a real trap would record as the return target. */
	focusedAtCreate: Element | null
}

const traps: FakeTrap[] = []
vi.mock("focus-trap", () => ({
	createFocusTrap: vi.fn((containers: Element | Element[], options: Options) => {
		const trap: FakeTrap = {
			active: false,
			containers,
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

import { useSnackInset } from "@/composables/snackInset"
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

/** Registry popups mount closed and are toggled open; the harness does the same. */
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

	test("shown: one trap is created after the tick and activated on the wrapper, its one container without a `#toast` anchor", async () => {
		const w = mountPopup()
		await w.setProps({ show: true })
		expect(traps).toHaveLength(0)
		await settle()
		expect(traps).toHaveLength(1)
		expect(traps[0]?.active).toBe(true)
		const wrapper = document.querySelector('[data-testid="inside"]')?.parentElement
		expect(traps[0]?.containers).toBe(wrapper)
		expect(traps[0]?.options.fallbackFocus).toBe(wrapper)
		w.unmount()
	})

	test("with a `#toast` anchor the trap takes it as its second container, after the wrapper", async () => {
		document.body.insertAdjacentHTML("beforeend", '<div id="toast"></div>')
		const w = await openPopup()
		const wrapper = document.querySelector('[data-testid="inside"]')?.parentElement
		expect(traps[0]?.containers).toEqual([wrapper, document.getElementById("toast")])
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

	test("created already shown: one trap after the tick, on the wrapper, returning focus to what was focused at creation even if a child focuses its own input first", async () => {
		document.body.insertAdjacentHTML("beforeend", '<button id="opener">open</button>')
		const opener = document.querySelector<HTMLElement>("#opener")
		opener?.focus()
		const w = mountPopup({ show: true })
		void nextTick(() => document.querySelector<HTMLElement>('[data-testid="inside"]')?.focus())
		expect(traps).toHaveLength(0)
		await settle()
		expect(traps).toHaveLength(1)
		expect(traps[0]?.active).toBe(true)
		expect(traps[0]?.containers).toBe(document.querySelector('[data-testid="inside"]')?.parentElement)
		expect(traps[0]?.options.setReturnFocus).toBe(opener)
		w.unmount()
	})

	test("created already shown and unmounted before the tick: no trap is created", async () => {
		const w = mountPopup({ show: true })
		w.unmount()
		await settle()
		expect(traps).toHaveLength(0)
	})

	test("initialFocus is handed to the trap; off by default", async () => {
		const a = await openPopup()
		expect(traps[0]?.options.initialFocus).toBe(false)
		a.unmount()
		const b = await openPopup({ initialFocus: "#title" })
		expect(traps[1]?.options.initialFocus).toBe("#title")
		b.unmount()
	})

	test("an open popup covers the nav: the snack drops from the nav's 76px to 12px and goes back when it closes", async () => {
		let inset = { value: -1 }
		const host = mount(
			defineComponent({
				setup() {
					inset = useSnackInset(() => 76)
					return () => h("div")
				},
			}),
		)
		const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
		const w = await openPopup()
		await frame()
		expect(inset.value).toBe(12)

		await w.setProps({ show: false })
		await settle()
		await frame()
		expect(inset.value).toBe(76)
		w.unmount()
		host.unmount()
	})
})
