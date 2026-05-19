import type { Ref } from "vue"

/** Standard toast durations (ms). */
export const TOAST_DURATION: {
	/** Quick feedback: copy, settings toggle. */
	SHORT: 1500
	/** Standard: success, download, info. */
	DEFAULT: 2000
	/** Longer: errors, warnings. */
	LONG: 4000
}

export interface ToastOptions {
	label: string
	icon?: string
	color?: string
}

export function useToast(): {
	toast: Ref<ToastOptions | null | undefined>
	openToast: (newToast: ToastOptions, duration?: number) => void
	closeToast: () => void
}
