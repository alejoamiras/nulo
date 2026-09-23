type ToastFn = (toast: { label: string; icon: string }, duration?: number) => void

const CLIPBOARD_CLEAR_MS = 60_000
const COPIED_FLASH_MS = 2_500

/**
 * Secret-export clipboard copy with the F-14 scrub, extracted verbatim from
 * the key/seed export pages (which duplicated it word for word).
 *
 * F-14: best-effort clipboard scrub a while after copy. Extension popups may
 * deny clipboard writes without a transient user gesture, so this is a bonus
 * layer — the on-page warning is the reliable mitigation. We deliberately do
 * NOT add a clipboardRead permission (it would only widen the wallet's
 * clipboard-read surface); the scrub is therefore unconditional, not
 * equals-checked, and is scheduled in the SAME tick as the copy — a hung
 * clipboard promise can never prevent it.
 *
 * NO lifecycle hooks and NO dispose() export, BY DESIGN — do not "fix" this
 * to the repo's usual composable-dispose convention: closing the export page
 * is a route-nav that keeps the popup's JS context alive, so cancelling the
 * scrub on unmount would make it near-inert in the common copy-then-close
 * flow. The timer only runs an idempotent `writeText("")` (no secret
 * reference, `.catch`-guarded) — safe to outlive the component, at the
 * documented small cost of clobbering an unrelated clipboard copy made
 * within the 60s window (accepted; no clipboardRead).
 */
export function useSecretClipboardCopy(opts: { toastLabel: string; openToast: ToastFn }) {
	let clipboardClearTimer: ReturnType<typeof setTimeout> | undefined
	const isCopied = ref(false)

	const copySecret = (value: string): void => {
		// FIRST effect: the write starts synchronously inside the user gesture.
		const write = window.navigator.clipboard.writeText(value)
		// Flash + scrub schedule in the same tick, regardless of write outcome
		// (the flash always started before the write settled historically; the
		// scrub must not depend on a promise that may never settle).
		isCopied.value = true
		clearTimeout(clipboardClearTimer)
		clipboardClearTimer = setTimeout(() => {
			void window.navigator.clipboard.writeText("").catch(() => {})
		}, CLIPBOARD_CLEAR_MS)
		setTimeout(() => {
			isCopied.value = false
		}, COPIED_FLASH_MS)
		// The toast is the only outcome-dependent piece: honest, never a false
		// "copied" (the one authorized behavior change of the dedup arc).
		write
			.then(() => opts.openToast({ label: opts.toastLabel, icon: "copy" }))
			.catch(() => opts.openToast({ label: "Couldn't copy", icon: "warning" }, 3_000))
	}

	return { isCopied, copySecret }
}
