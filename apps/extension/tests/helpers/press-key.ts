/**
 * Presses `key` on `el` the way a browser activates a focused button: focus, a cancelable keydown
 * (`init` sets its `repeat`, `isComposing` or `keyCode`), then `el.click()` on that keydown for
 * Enter, or on the keyup for Space, unless a handler cancelled the key. It simulates a button's
 * activation only and proves nothing about native form submission or browser timing, so a field
 * case dispatches a plain keydown on the field instead.
 *
 * @returns Whether each dispatched key event went through uncancelled.
 */
export function pressOn(el: HTMLElement, key: "Enter" | " ", init: KeyboardEventInit = {}): boolean[] {
	el.focus()
	const down = el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
	if (key === "Enter") {
		if (down) el.click()
		return [down]
	}
	const up = el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }))
	if (down && up) el.click()
	return [down, up]
}
