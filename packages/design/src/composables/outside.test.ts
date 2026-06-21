import { afterEach, describe, expect, test, vi } from "vitest"
import { nextTick, ref } from "vue"
import { useEvent, useOutside } from "./outside"

function press(node: Element | Document, type = "mousedown") {
	node.dispatchEvent(new MouseEvent(type, { bubbles: true }))
}

const el = (tag = "div") => {
	const n = document.createElement(tag)
	document.body.append(n)
	return n
}

afterEach(() => {
	document.body.innerHTML = ""
})

describe("useEvent", () => {
	test("attaches a listener that fires on the event", () => {
		const cb = vi.fn()
		useEvent(document, "mousedown", cb)
		press(document)
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test("the returned remove() detaches the listener", () => {
		const cb = vi.fn()
		const remove = useEvent(document, "mousedown", cb)
		remove()
		press(document)
		expect(cb).not.toHaveBeenCalled()
	})

	test("null el → no-op remove (no throw)", () => {
		const remove = useEvent(null, "mousedown", vi.fn())
		expect(() => remove()).not.toThrow()
	})

	test("re-attaches when a ref el changes", async () => {
		const cb = vi.fn()
		const a = el()
		const elRef = ref<HTMLElement | null>(a)
		useEvent(elRef, "mousedown", cb)
		press(a)
		expect(cb).toHaveBeenCalledTimes(1)
		const b = el()
		elRef.value = b
		await nextTick()
		press(b)
		expect(cb).toHaveBeenCalledTimes(2)
	})
})

describe("useOutside", () => {
	test("press OUTSIDE the element fires the callback", () => {
		const target = el("div")
		const outside = el("button")
		const cb = vi.fn()
		useOutside(target, cb)
		press(outside)
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test("press INSIDE the element does NOT fire", () => {
		const target = el("div")
		const inner = document.createElement("span")
		target.append(inner)
		const cb = vi.fn()
		useOutside(target, cb)
		press(inner)
		expect(cb).not.toHaveBeenCalled()
	})

	test("accepts a ref element", () => {
		const target = el("div")
		const outside = el("button")
		const cb = vi.fn()
		useOutside(ref(target), cb)
		press(outside)
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test("the returned remove() detaches", () => {
		const target = el("div")
		const outside = el("button")
		const cb = vi.fn()
		useOutside(target, cb)()
		press(outside)
		expect(cb).not.toHaveBeenCalled()
	})

	test("listens on mousedown for a non-touch UA (jsdom default); touchstart does not fire", () => {
		const target = el("div")
		const outside = el("button")
		const cb = vi.fn()
		useOutside(target, cb)
		press(outside, "touchstart")
		expect(cb).not.toHaveBeenCalled()
		press(outside, "mousedown")
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test("(BUG PIN) data-outside collision guard suppresses presses from a different region", () => {
		// element nested under <div data-outside id="A">; a press whose parent is region "B" is ignored
		// because anchor.id ("A") !== e.target.parentNode.id ("B") — the verbatim collision guard.
		const regionA = el("div")
		regionA.setAttribute("data-outside", "")
		regionA.id = "A"
		const target = document.createElement("div")
		regionA.append(target)

		const regionB = el("div")
		regionB.id = "B"
		const press_target = document.createElement("button")
		regionB.append(press_target)

		const cb = vi.fn()
		useOutside(target, cb)
		press(press_target)
		expect(cb).not.toHaveBeenCalled()
	})
})
