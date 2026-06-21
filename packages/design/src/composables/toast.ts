import { type Ref, ref } from "vue"

/** Standard toast durations (ms). */
export const TOAST_DURATION = {
	/** Quick feedback: copy, settings toggle. */
	SHORT: 1_500,
	/** Standard: success, download, info. */
	DEFAULT: 2_000,
	/** Longer: errors, warnings. */
	LONG: 4_000,
} as const

export interface ToastOptions {
	label: string
	icon?: string
	color?: string
}

// Module-scope singleton: ONE transient toast across all useToast() callers AND the region that
// renders it. A second module-level copy would split this ref — a toast opened via one copy would
// not show in a region driven by the other. The extension's composables/toast.{js,d.ts} re-export
// from here so all consumers share this single ref.
const toast: Ref<ToastOptions | null | undefined> = ref()
let closeTm: ReturnType<typeof setTimeout> | undefined

export const useToast = () => {
	const openToast = (newToast: ToastOptions, duration: number = TOAST_DURATION.DEFAULT) => {
		// Cancel any in-flight timer before swapping the toast value. Without this, a rapid second
		// openToast inherits the first toast's timeout and disappears early.
		clearTimeout(closeTm)
		toast.value = newToast

		closeTm = setTimeout(() => {
			toast.value = null
		}, duration)
	}

	const closeToast = () => {
		clearTimeout(closeTm)
		toast.value = null
	}

	return { toast, openToast, closeToast }
}
