import { watch } from "vue"

/**
 * Q-07: the Enter-submit guard shared by the plain create/edit popups — fire
 * only when Enter is pressed WHILE an `<input>`/`<textarea>` is focused (a
 * global Enter must NOT submit). Five popups hand-copied this exact predicate;
 * this is its single source of truth (also used by `usePopupEntity` below).
 */
export function isPopupSubmitKey(e: KeyboardEvent): boolean {
	if (e.key !== "Enter") return false
	const target = e.target
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/** Handlers a plain create/edit popup wires into its show/hide lifecycle. */
export type UsePopupEntityHandlers = {
	/** The popup's primary submit — fired on Enter pressed WHILE an
	 *  `<input>` / `<textarea>` is focused (matches the hand-rolled per-popup
	 *  keydown guard; a global Enter must NOT trigger it). */
	submit: () => void
	/** Ran when the popup becomes visible, AFTER the keydown listener is
	 *  installed. Optional (e.g. connect a client / focus). */
	onShow?: () => void
	/** Ran when the popup hides, AFTER the keydown listener is removed.
	 *  Optional (e.g. `form.reset()` / disconnect a client). */
	onHide?: () => void
}

/**
 * Narrow lifecycle helper shared by the plain `FormPopup` create/edit popups
 * (Q-14). Extracts the `watch(show)` + document Enter-key listener that each
 * popup hand-rolled identically:
 *   - on SHOW: install the keydown listener, then run `onShow`.
 *   - on HIDE: remove the keydown listener, then run `onHide`.
 *   - Enter (only while an `<input>`/`<textarea>` is focused) fires `submit`.
 *
 * Behavior-preserving vs the hand-rolled copies: same listener add/remove
 * ORDER relative to reset/disconnect (remove-before-onHide), same Enter guard.
 * Does NOT own any service client — the parent owns `.connect()/.disconnect()`
 * (the C1 rule); this helper only fires callbacks at the lifecycle points.
 *
 * @param show A getter for the popup's `show` prop (e.g. `() => props.show`).
 */
export function usePopupEntity(show: () => boolean, handlers: UsePopupEntityHandlers): void {
	const onKeydown = (e: KeyboardEvent) => {
		if (isPopupSubmitKey(e)) handlers.submit()
	}
	watch(show, (isShown) => {
		if (isShown) {
			document.addEventListener("keydown", onKeydown)
			handlers.onShow?.()
		} else {
			document.removeEventListener("keydown", onKeydown)
			handlers.onHide?.()
		}
	})
}
