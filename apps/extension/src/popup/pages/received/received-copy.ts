import type { ToastOptions } from "@/composables/toast"
import { copyToClipboard } from "@/utils/clipboard"

type ToastFn = (toast: ToastOptions) => void

/** The received-detail page's copy shape: its failure reads "Copy failed", not the fleet's
 *  "Couldn't copy". Extracted so the shape is pinnable without mounting the page. */
export function copyReceivedValue(value: string, label: string, openToast: ToastFn): Promise<boolean> {
	return copyToClipboard(value, openToast, {
		success: { label: `${label} copied` },
		failure: { label: "Copy failed" },
	})
}
