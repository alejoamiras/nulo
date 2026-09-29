import { onScopeDispose, watch } from "vue"

/** An auto-repeated or composing keydown. An IME's boundary keydown can report `isComposing` false,
 *  so `keyCode` 229 counts too. */
export function isRepeatOrComposing(e: KeyboardEvent): boolean {
	return e.repeat || e.isComposing || e.keyCode === 229
}

/** Enter pressed in an `<input>` or `<textarea>`, neither repeated nor composing. */
export function isPopupSubmitKey(e: KeyboardEvent): boolean {
	if (e.key !== "Enter" || isRepeatOrComposing(e)) return false
	const target = e.target
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/** Handlers a popup wires into its show/hide lifecycle. */
export type UsePopupEntityHandlers = {
	/** The form popup's submit, fired on `isPopupSubmitKey`. A popup without a form field passes none
	 *  and has no Enter shortcut: its confirm button is the keyboard path. */
	submit?: () => void
	/** Ran when the popup becomes visible, AFTER the keydown listener is
	 *  installed. Optional (e.g. connect a client / populate / focus). May be
	 *  async — the promise is AWAITED by the watcher, so rejections travel
	 *  Vue's watcher error channel; it also drives `submitWaitsForShow`. */
	onShow?: () => void | Promise<void>
	/** Ran when the popup hides, AFTER the keydown listener is removed.
	 *  Optional (e.g. `form.reset()` / disconnect a client). May be async;
	 *  awaited the same way. */
	onHide?: () => void | Promise<void>
}

export type UsePopupEntityOptions = {
	/** While `onShow`'s returned promise is pending, `submit` is inert. Popups
	 *  whose entry checks depend on the populated data (duplicate lists, edit
	 *  targets) need this — their re-entrancy latches stop DOUBLE submits, not
	 *  a premature FIRST submit against an incomplete list. */
	submitWaitsForShow?: boolean
}

/**
 * A popup's show/hide lifecycle. On show, the keydown listener (only with a `submit`) is installed
 * before `onShow` runs; on hide, it is removed before `onHide` runs; on scope dispose (unmount
 * included), it is removed.
 *
 * @param show A getter for the popup's `show` prop (e.g. `() => props.show`).
 */
export function usePopupEntity(show: () => boolean, handlers: UsePopupEntityHandlers, options: UsePopupEntityOptions = {}): void {
	const { submit } = handlers
	// Token-guarded pending marker: a stale show's settling promise must not
	// clear the gate a NEWER show opened (fast hide→show cycles).
	let pendingShowToken: object | null = null

	const onKeydown = (e: KeyboardEvent) => {
		if (options.submitWaitsForShow && pendingShowToken !== null) return
		if (isPopupSubmitKey(e)) submit?.()
	}
	// The watcher is ASYNC and awaits the handlers so their rejections travel
	// Vue's watcher error channel (onErrorCaptured / app errorHandler / watcher
	// metadata).
	watch(show, async (isShown) => {
		if (isShown) {
			if (submit) document.addEventListener("keydown", onKeydown)
			if (!handlers.onShow) {
				pendingShowToken = null
				return
			}
			const token = {}
			pendingShowToken = token
			// The gate opens on FULFILLMENT ONLY: a rejected population keeps
			// Enter inert until a fresh show repopulates. (A new show replaces
			// the token, so no stale settle can unlock it, and no rejection can
			// lock a LATER show.)
			await handlers.onShow()
			if (pendingShowToken === token) pendingShowToken = null
		} else {
			document.removeEventListener("keydown", onKeydown)
			await handlers.onHide?.()
		}
	})
	onScopeDispose(() => document.removeEventListener("keydown", onKeydown))
}
