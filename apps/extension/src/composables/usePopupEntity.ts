import { onScopeDispose, watch } from "vue"

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
	 *  installed. Optional (e.g. connect a client / populate / focus). May be
	 *  async — the returned promise's rejection is re-dispatched (never
	 *  silently dropped), and it drives `submitWaitsForShow` when set. */
	onShow?: () => void | Promise<void>
	/** Ran when the popup hides, AFTER the keydown listener is removed.
	 *  Optional (e.g. `form.reset()` / disconnect a client). May be async;
	 *  rejections are re-dispatched. */
	onHide?: () => void | Promise<void>
}

export type UsePopupEntityOptions = {
	/** Reproduce the install-listener-AFTER-population timing of the
	 *  hand-rolled watchers this composable replaced: while `onShow`'s
	 *  returned promise is pending, `submit` is inert. Popups whose entry
	 *  checks depend on the populated data (duplicate lists, edit targets)
	 *  need this — their re-entrancy latches stop DOUBLE submits, not a
	 *  premature FIRST submit against an incomplete list. */
	submitWaitsForShow?: boolean
}

/** An async watcher surfaced its rejection through Vue's error channel; the
 *  sync watcher below must not silently swallow what used to be loud. */
const redispatch = (err: unknown) => {
	queueMicrotask(() => {
		throw err
	})
}

/**
 * Narrow lifecycle helper shared by the plain `FormPopup` create/edit popups
 * (Q-14). Extracts the `watch(show)` + document Enter-key listener that each
 * popup hand-rolled identically:
 *   - on SHOW: install the keydown listener, then run `onShow`.
 *   - on HIDE: remove the keydown listener, then run `onHide`.
 *   - Enter (only while an `<input>`/`<textarea>` is focused) fires `submit`.
 *   - on SCOPE DISPOSE (unmount included): remove the listener.
 *
 * Behavior-preserving vs the hand-rolled copies: same listener add/remove
 * ORDER relative to reset/disconnect (remove-before-onHide), same Enter guard,
 * and — via `submitWaitsForShow` — the same effective submit timing for popups
 * that installed their listener after their population awaits.
 *
 * Does NOT own any service client — the parent owns `.connect()/.disconnect()`
 * (the C1 rule); this helper only fires callbacks at the lifecycle points. The
 * scope-dispose cleanup is the C1 rule's sanctioned non-service carve-out (see
 * CLAUDE.md, Composables): a DOM listener participates in no order-sensitive
 * teardown sequence TODAY — note the direction-dependence: `onBeforeUnmount`
 * hooks run BEFORE scope cleanup, so a future parent hook would still see the
 * listener installed; only post-scope-death delivery is impossible.
 *
 * @param show A getter for the popup's `show` prop (e.g. `() => props.show`).
 */
export function usePopupEntity(show: () => boolean, handlers: UsePopupEntityHandlers, options: UsePopupEntityOptions = {}): void {
	// Token-guarded pending marker: a stale show's settling promise must not
	// clear the gate a NEWER show opened (fast hide→show cycles).
	let pendingShowToken: object | null = null

	const onKeydown = (e: KeyboardEvent) => {
		if (options.submitWaitsForShow && pendingShowToken !== null) return
		if (isPopupSubmitKey(e)) handlers.submit()
	}
	watch(show, (isShown) => {
		if (isShown) {
			document.addEventListener("keydown", onKeydown)
			pendingShowToken = null
			const result = handlers.onShow?.()
			if (result instanceof Promise) {
				const token = {}
				pendingShowToken = token
				result
					.catch(redispatch)
					// The gate opens on settle EITHER way — a failed population
					// must not lock the popup shut (matches the old timing: the
					// hand-rolled watcher installed its listener only on the
					// success path, but its async-watcher rejection left the
					// popup closed-for-Enter, which surfaced as the SAME "try
					// again after reopening" UX this preserves via the error).
					.finally(() => {
						if (pendingShowToken === token) pendingShowToken = null
					})
			}
		} else {
			document.removeEventListener("keydown", onKeydown)
			const result = handlers.onHide?.()
			if (result instanceof Promise) result.catch(redispatch)
		}
	})
	onScopeDispose(() => document.removeEventListener("keydown", onKeydown))
}
