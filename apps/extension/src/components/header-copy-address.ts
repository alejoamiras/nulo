import { stripWireControl } from "@/wallet/services/dapp-session/capability-meta"

type ToastFn = (toast: { label: string; icon: string }, duration?: number) => void

/**
 * The header address button's copy handler. Awaits the clipboard write so the success toast can
 * never claim a copy that failed; a rejection (permission denial, transient platform error) gets an
 * honest warning instead. The address is stripped of control/bidi characters but NEVER truncated —
 * the user sees a trimmed display and expects to paste the full on-chain value.
 */
export async function copyAddressToClipboard(address: string | null | undefined, openToast: ToastFn): Promise<boolean> {
	if (!address) return false
	try {
		await window.navigator.clipboard.writeText(stripWireControl(address))
	} catch {
		openToast({ label: "Couldn't copy address", icon: "warning" }, 3_000)
		return false
	}
	openToast({ label: "Address is copied", icon: "copy" })
	return true
}
