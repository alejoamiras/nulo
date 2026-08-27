import { stripWireControl } from "@/wallet/services/dapp-session/capability-meta"

type ToastFn = (toast: { label: string; icon: string }, duration?: number) => void

/** One toast's full shape — success and failure each carry their own, because
 *  the migrated sites use genuinely different icon/duration combinations per
 *  outcome (e.g. failure warning/3s at the header vs alert/2s on the received
 *  page) and none of them may drift. */
export interface CopyToastSpec {
	label: string
	icon?: string
	duration?: number
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
		openToast({ label: opts.failure.label, icon: opts.failure.icon ?? "warning" }, opts.failure.duration)
		return false
	}
	openToast({ label: opts.success.label, icon: opts.success.icon ?? "copy" }, opts.success.duration)
	return true
}
