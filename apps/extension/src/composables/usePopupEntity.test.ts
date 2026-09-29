/**
 * Unit tests for `usePopupEntity`, the show/hide lifecycle the popups share: the Enter guard (a field
 * only, never a repeat or a composition), the listener installed only with `submit` and removed on hide
 * and on scope dispose, and the onShow/onHide hooks; and for `refuseRepeatEnter`, a control's refusal.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { createApp, effectScope, nextTick, ref } from "vue"
import { isPopupSubmitKey, refuseRepeatEnter, usePopupEntity } from "./usePopupEntity"

/** Run the composable inside an effect scope so its `watch` is active; return a
 *  `stop()` to tear it down (mirrors component unmount). */
function mount(
	show: ReturnType<typeof ref<boolean>>,
	handlers: Parameters<typeof usePopupEntity>[1],
	options?: Parameters<typeof usePopupEntity>[2],
) {
	const scope = effectScope()
	scope.run(() => usePopupEntity(() => Boolean(show.value), handlers, options))
	return () => scope.stop()
}

/** Dispatch a bubbling keydown FROM `target` so the document-level listener sees
 *  it with `event.target === target` (jsdom sets target from the dispatch node). */
function pressKey(target: Element, key: string, init: KeyboardEventInit = {}) {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }))
}

const cleanup: Array<() => void> = []
afterEach(() => {
	for (const c of cleanup.splice(0)) c()
	document.body.innerHTML = ""
})

function makeInput(): HTMLInputElement {
	const el = document.createElement("input")
	document.body.appendChild(el)
	return el
}

describe("isPopupSubmitKey", () => {
	const keyOn = (tag: string, key: string) => isPopupSubmitKey({ key, target: document.createElement(tag) } as unknown as KeyboardEvent)

	it("true for Enter on an <input>", () => expect(keyOn("input", "Enter")).toBe(true))
	it("true for Enter on a <textarea>", () => expect(keyOn("textarea", "Enter")).toBe(true))
	it("false for Enter on a non-field element (<div>)", () => expect(keyOn("div", "Enter")).toBe(false))
	it("false for a non-Enter key on an <input>", () => expect(keyOn("input", "a")).toBe(false))
	it("false when target is null", () => expect(isPopupSubmitKey({ key: "Enter", target: null } as unknown as KeyboardEvent)).toBe(false))
})

describe("refuseRepeatEnter", () => {
	const enter = (init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: "Enter", cancelable: true, ...init })

	it("cancels a repeat and a composing Enter", () => {
		const repeat = enter({ repeat: true })
		const composing = enter({ isComposing: true })
		refuseRepeatEnter(repeat)
		refuseRepeatEnter(composing)
		expect([repeat.defaultPrevented, composing.defaultPrevented]).toEqual([true, true])
	})

	it("leaves a plain Enter, and another key's repeat, to the control", () => {
		const plain = enter()
		const otherRepeat = enter({ key: "ArrowDown", repeat: true })
		refuseRepeatEnter(plain)
		refuseRepeatEnter(otherRepeat)
		expect([plain.defaultPrevented, otherRepeat.defaultPrevented]).toEqual([false, false])
	})
})

describe("usePopupEntity", () => {
	it("does NOT install the keydown listener until show flips true (watch is not immediate)", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		await nextTick()
		pressKey(makeInput(), "Enter")
		expect(submit).not.toHaveBeenCalled()
	})

	it("Enter while an <input> is focused fires submit after show → true", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce()
	})

	it("Enter fires submit from a <textarea> too", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		const ta = document.createElement("textarea")
		document.body.appendChild(ta)
		pressKey(ta, "Enter")
		expect(submit).toHaveBeenCalledOnce()
	})

	it("Enter from a NON-input target (e.g. a div) does NOT fire submit", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		const div = document.createElement("div")
		document.body.appendChild(div)
		pressKey(div, "Enter")
		expect(submit).not.toHaveBeenCalled()
	})

	it("a non-Enter key on an <input> does NOT fire submit", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		pressKey(makeInput(), "a")
		expect(submit).not.toHaveBeenCalled()
	})

	it.each([
		["a repeat", { repeat: true }],
		["a composing Enter", { isComposing: true }],
		["an IME boundary Enter (keyCode 229, isComposing false)", { keyCode: 229, isComposing: false }],
	] as const)("%s in an <input> does NOT fire submit", async (_name, init) => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		pressKey(makeInput(), "Enter", init)
		expect(submit).not.toHaveBeenCalled()
	})

	it("without submit: no keydown listener is added, and onShow then onHide still run", async () => {
		const addListener = vi.spyOn(document, "addEventListener")
		cleanup.push(() => addListener.mockRestore())
		const calls: string[] = []
		const show = ref(false)
		cleanup.push(mount(show, { onShow: () => void calls.push("show"), onHide: () => void calls.push("hide") }))
		show.value = true
		await nextTick()
		show.value = false
		await nextTick()
		expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toEqual([])
		expect(calls).toEqual(["show", "hide"])
	})

	it("hides: removes the listener (Enter no longer submits) and runs onHide", async () => {
		const submit = vi.fn()
		const onHide = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit, onHide }))
		show.value = true
		await nextTick()
		show.value = false
		await nextTick()
		expect(onHide).toHaveBeenCalledOnce()
		pressKey(makeInput(), "Enter")
		expect(submit).not.toHaveBeenCalled()
	})

	it("runs onShow when it becomes visible (after the listener is installed)", async () => {
		const onShow = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit: vi.fn(), onShow }))
		show.value = true
		await nextTick()
		expect(onShow).toHaveBeenCalledOnce()
	})

	it("re-installs the listener across a hide→show cycle", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit }))
		show.value = true
		await nextTick()
		show.value = false
		await nextTick()
		show.value = true
		await nextTick()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce()
	})

	it("removes the listener on SCOPE DISPOSE even while shown (unmount cannot leak it)", async () => {
		const submit = vi.fn()
		const show = ref(false)
		const stop = mount(show, { submit })
		show.value = true
		await nextTick()
		stop() // component unmount → scope death; the popup was never hidden
		pressKey(makeInput(), "Enter")
		expect(submit).not.toHaveBeenCalled()
	})

	it("submitWaitsForShow: Enter is inert while onShow's promise pends, live after it resolves", async () => {
		const submit = vi.fn()
		let resolveShow!: () => void
		const show = ref(false)
		cleanup.push(mount(show, { submit, onShow: () => new Promise<void>((r) => (resolveShow = r)) }, { submitWaitsForShow: true }))
		show.value = true
		await nextTick()
		pressKey(makeInput(), "Enter")
		expect(submit).not.toHaveBeenCalled() // population pending → inert
		resolveShow()
		await Promise.resolve()
		await Promise.resolve()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce()
	})

	it("submitWaitsForShow: a REJECTED onShow keeps the gate CLOSED, routes through Vue's error channel, and a fresh show reopens", async () => {
		// The hand-rolled watchers never reached addEventListener after a
		// rejection — Enter against a failed/incomplete population must stay
		// impossible until a fresh show repopulates. Mounted through a REAL app
		// so the rejection's routing (Vue's watcher error channel → the app
		// errorHandler) is itself asserted, not just tolerated.
		const submit = vi.fn()
		const errorHandler = vi.fn()
		let rejectShow!: (e: Error) => void
		let attempt = 0
		const show = ref(false)
		const app = createApp({
			setup() {
				usePopupEntity(
					() => Boolean(show.value),
					{
						submit,
						onShow: () => {
							attempt++
							return attempt === 1 ? new Promise<void>((_r, rj) => (rejectShow = rj)) : Promise.resolve()
						},
					},
					{ submitWaitsForShow: true },
				)
				return () => null
			},
		})
		app.config.errorHandler = errorHandler
		app.mount(document.createElement("div"))
		cleanup.push(() => app.unmount())

		show.value = true
		await nextTick()
		rejectShow(new Error("population failed"))
		await Promise.resolve()
		await Promise.resolve()
		pressKey(makeInput(), "Enter")
		expect(submit).not.toHaveBeenCalled() // rejection ≠ open gate
		expect(errorHandler).toHaveBeenCalledTimes(1) // the rejection traveled Vue's channel
		show.value = false
		await nextTick()
		show.value = true
		await nextTick()
		await Promise.resolve()
		await Promise.resolve()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce() // fresh, successful show reopens
	})

	it("WITHOUT submitWaitsForShow, an async onShow does not gate Enter (existing adopters' pinned timing)", async () => {
		const submit = vi.fn()
		const show = ref(false)
		cleanup.push(mount(show, { submit, onShow: () => new Promise<void>(() => {}) }))
		show.value = true
		await nextTick()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce()
	})
})
