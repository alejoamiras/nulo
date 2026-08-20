/**
 * Unit tests for `usePopupEntity` — the narrow show/hide lifecycle helper the
 * plain FormPopup create/edit popups share (Q-14). Covers the Enter-key guard
 * (input-only), the listener add/remove on show/hide, the onShow/onHide hooks,
 * and the remove-before-onHide order that the hand-rolled copies relied on.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { effectScope, nextTick, ref } from "vue"
import { isPopupSubmitKey, usePopupEntity } from "./usePopupEntity"

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
function pressKey(target: Element, key: string) {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
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

describe("isPopupSubmitKey (Q-07)", () => {
	const keyOn = (tag: string, key: string) => isPopupSubmitKey({ key, target: document.createElement(tag) } as unknown as KeyboardEvent)

	it("true for Enter on an <input>", () => expect(keyOn("input", "Enter")).toBe(true))
	it("true for Enter on a <textarea>", () => expect(keyOn("textarea", "Enter")).toBe(true))
	it("false for Enter on a non-field element (<div>)", () => expect(keyOn("div", "Enter")).toBe(false))
	it("false for a non-Enter key on an <input>", () => expect(keyOn("input", "a")).toBe(false))
	it("false when target is null", () => expect(isPopupSubmitKey({ key: "Enter", target: null } as unknown as KeyboardEvent)).toBe(false))
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

	it("submitWaitsForShow: a REJECTED onShow unblocks the gate AND re-dispatches the error", async () => {
		const submit = vi.fn()
		let rejectShow!: (e: Error) => void
		const show = ref(false)
		// Capture the deliberate re-dispatch instead of letting it hit the
		// process: the stub both silences vitest's unhandled-error net and PINS
		// that the rejection is re-surfaced rather than swallowed.
		const microtasks: Array<() => void> = []
		vi.stubGlobal("queueMicrotask", (fn: () => void) => microtasks.push(fn))
		cleanup.push(mount(show, { submit, onShow: () => new Promise<void>((_r, rj) => (rejectShow = rj)) }, { submitWaitsForShow: true }))
		show.value = true
		await nextTick()
		rejectShow(new Error("population failed"))
		await Promise.resolve()
		await Promise.resolve()
		pressKey(makeInput(), "Enter")
		expect(submit).toHaveBeenCalledOnce() // the gate opened — no lockout
		expect(microtasks).toHaveLength(1)
		expect(() => microtasks[0]()).toThrow("population failed") // the error is re-surfaced
		vi.unstubAllGlobals()
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
