import { copyToClipboard } from "@/utils/clipboard"

type ToastFn = (toast: { label: string; icon: string }, duration?: number) => void

/** The received-detail page's copy shape — one of the three historically
 *  independent await/catch sites: its failure toast is "Copy failed" with the
 *  `alert` icon at 2s (NOT the fleet default warning/3s), and both outcomes
 *  run at 2s. Extracted so the shape is pinnable without mounting the page. */
export function copyReceivedValue(value: string, label: string, openToast: ToastFn): Promise<boolean> {
	return copyToClipboard(value, openToast, {
		success: { label: `${label} copied`, duration: 2_000 },
		failure: { label: "Copy failed", icon: "alert", duration: 2_000 },
	})
}
