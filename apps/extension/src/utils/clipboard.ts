import type { ToastOptions } from "@/composables/toast"
import { stripWireControl } from "@/wallet/services/dapp-session/capability-meta"

type ToastFn = (toast: ToastOptions) => void

/** One outcome's snack text; the kind follows the outcome. */
export interface CopyToastSpec {
	label: string
}

/**
 * Copy `text` and toast HONESTLY: the success toast fires only after the
 * clipboard write resolved; a rejection (permission denial, focus loss,
 * transient platform error) shows the failure toast instead — never a false
 * "copied".
 *
 * Invariants:
 * - The `writeText` invocation is this function's FIRST effect, synchronous
 *   within the caller's user gesture (transient-activation-safe).
 * - Deliberately guard-free: empty/nullish-coerced inputs write exactly what
 *   the caller passed, as every migrated site did before. The address-specific
 *   falsy guard lives only in `copyAddressToClipboard`.
 * - `sanitize` (strip control/bidi chars) is OPT-IN — copied bytes are frozen
 *   at every site; only the three historically-sanitizing sites pass it.
 */
export async function copyToClipboard(
	text: string,
	openToast: ToastFn,
	opts: { success: CopyToastSpec; failure: CopyToastSpec; sanitize?: boolean },
): Promise<boolean> {
	try {
		await window.navigator.clipboard.writeText(opts.sanitize ? stripWireControl(text) : text)
	} catch {
		openToast({ kind: "error", label: opts.failure.label })
		return false
	}
	openToast({ kind: "success", label: opts.success.label })
	return true
}

/** The toast pair every plain copy button shares; sites whose failure copy differs keep
 *  calling `copyToClipboard` directly. */
export function copyWithToast(text: string, openToast: ToastFn, successLabel: string, opts: { sanitize?: boolean } = {}): Promise<boolean> {
	return copyToClipboard(text, openToast, {
		success: { label: successLabel },
		failure: { label: "Couldn't copy" },
		sanitize: opts.sanitize,
	})
}
