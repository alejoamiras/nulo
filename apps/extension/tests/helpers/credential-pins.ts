import type { VueWrapper } from "@vue/test-utils"
import { flushPromises } from "@vue/test-utils"
import { expect } from "vitest"

/** A password visibility toggle and the fields it masks, by testid. */
export interface MaskToggleCase {
	toggle: string
	/** The field whose `Input` hosts the toggle; a click must leave focus on its native input. */
	field: string
	drives: string[]
	others?: string[]
	subject?: string
}

export const nativeInput = (w: VueWrapper, id: string) => w.get(`[data-testid="${id}"] input`).element as HTMLInputElement
const types = (w: VueWrapper, ids: string[]) => ids.map((id) => nativeInput(w, id).type)

/** The toggle's attributes, its masked default, its exact reach, two activations in one task, and focus. Needs the real `Input` and `MaterialIcon`, mounted attached. */
export async function expectMaskToggle(w: VueWrapper, c: MaskToggleCase): Promise<void> {
	const subject = c.subject ?? "password"
	const others = c.others ?? []
	const btn = w.get(`[data-testid="${c.toggle}"]`).element as HTMLButtonElement
	const icon = () => btn.querySelector("span")
	expect(btn.tagName).toBe("BUTTON")
	expect(btn.getAttribute("type")).toBe("button")
	expect(btn.getAttribute("tabindex")).toBe("-1")
	const fieldRoot = w.get(`[data-testid="${c.field}"]`).element
	expect(fieldRoot.contains(btn)).toBe(true)
	// The `#suffix` slot sits in the input's clickable row; `#bottom` is a direct child of the root.
	expect(btn.parentElement).not.toBe(fieldRoot)
	expect(btn.parentElement?.contains(nativeInput(w, c.field))).toBe(true)
	expect(icon()?.className).toContain("color--secondary")
	expect(icon()?.style.fontSize).toBe("18px")

	const masked = () => {
		expect(types(w, c.drives)).toEqual(c.drives.map(() => "password"))
		expect(btn.getAttribute("aria-label")).toBe(`Show ${subject}`)
		expect(icon()?.textContent).toBe("visibility")
	}
	masked()
	const othersBefore = types(w, others)

	btn.click()
	btn.click()
	await flushPromises()
	masked()

	btn.click()
	await flushPromises()
	expect(types(w, c.drives)).toEqual(c.drives.map(() => "text"))
	expect(types(w, others)).toEqual(othersBefore)
	expect(btn.getAttribute("aria-label")).toBe(`Hide ${subject}`)
	expect(icon()?.textContent).toBe("visibility_off")
	expect(document.activeElement).toBe(nativeInput(w, c.field))

	btn.click()
	await flushPromises()
	masked()
	expect(types(w, others)).toEqual(othersBefore)
}

/** Native attributes of a field's `<input>`, literally; `null` means absent. */
export function expectNativeAttrs(w: VueWrapper, id: string, attrs: Record<string, string | null>): void {
	const input = nativeInput(w, id)
	const wanted = { spellcheck: "false", autofocus: null, maxlength: null, ...attrs }
	for (const [name, value] of Object.entries(wanted)) expect([name, input.getAttribute(name)]).toEqual([name, value])
}

/** A real `paste` event carrying `text`; returns whether a handler cancelled it. */
export function pasteInto(input: HTMLInputElement, text: string): boolean {
	input.focus()
	input.setSelectionRange(input.value.length, input.value.length)
	const ev = new Event("paste", { bubbles: true, cancelable: true })
	Object.defineProperty(ev, "clipboardData", { value: { getData: () => text } })
	input.dispatchEvent(ev)
	return ev.defaultPrevented
}

/** Sets a native input's value and dispatches its `input` event, synchronously. */
export function typeNow(input: HTMLInputElement, value: string): void {
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
}

/** A keydown Enter on `el`, synchronously; `init` sets `repeat`, `isComposing` or `keyCode`. */
export function enterOn(el: Element, init: KeyboardEventInit = {}): KeyboardEvent {
	const ev = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true, ...init })
	el.dispatchEvent(ev)
	return ev
}

/** The Enter variants a field's submit shortcut must ignore: already handled, repeated, composing, IME keyCode 229. */
export const IGNORED_ENTERS: Array<[string, (el: Element) => void]> = [
	[
		"handled",
		(el) => {
			const cancel = (e: Event) => e.preventDefault()
			el.addEventListener("keydown", cancel, { once: true })
			enterOn(el)
		},
	],
	["repeated", (el) => void enterOn(el, { repeat: true })],
	["composing", (el) => void enterOn(el, { isComposing: true })],
	["keyCode 229", (el) => void enterOn(el, { keyCode: 229 })],
]
