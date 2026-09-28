import { type Ref, ref } from "vue"

/** How long a success stays open; an error stays until it is closed. */
export const SUCCESS_TOAST_MS = 6_000

export type ToastKind = "success" | "error"

export interface ToastAction {
	label: string
	/** Runs after the snack has closed. */
	onSelect: () => void
}

export interface ToastOptions {
	kind: ToastKind
	label: string
	sub?: string
	action?: ToastAction
}

export interface ToastState extends ToastOptions {
	/** Grows on every open, so the same text opened twice renders twice. */
	id: number
}

// Module-scope singleton: ONE transient toast across all useToast() callers AND the region that
// renders it. A second module-level copy would split this ref — a toast opened via one copy would
// not show in a region driven by the other. The extension's composables/toast.{js,d.ts} re-export
// from here so all consumers share this single ref.
const toast: Ref<ToastState | null | undefined> = ref()
let nextId = 0
let closeTm: ReturnType<typeof setTimeout> | undefined
let deadline = 0
let remaining = 0
let held = false

const clearTimer = () => {
	clearTimeout(closeTm)
	closeTm = undefined
	remaining = 0
}

const armTimer = (ms: number) => {
	deadline = Date.now() + ms
	closeTm = setTimeout(() => {
		closeTm = undefined
		toast.value = null
	}, ms)
}

/**
 * One snack at a time. A success closes itself after {@link SUCCESS_TOAST_MS} and waits while
 * the pointer or focus is on it (the region reports that through `holdToast`); an error stays
 * until it is closed. A kind that is not `"success"` is treated as an error, so a message of
 * unknown class never leaves on its own.
 */
export const useToast = () => {
	const openToast = (options: ToastOptions) => {
		clearTimer()
		held = false
		const kind: ToastKind = options.kind === "success" ? "success" : "error"
		toast.value = { ...options, kind, id: ++nextId }
		if (kind === "success") armTimer(SUCCESS_TOAST_MS)
	}

	const closeToast = () => {
		clearTimer()
		held = false
		toast.value = null
	}

	/** Pauses a success's close timer while `hold` is true and resumes the remainder after. Repeating
	 *  the same report changes nothing. */
	const holdToast = (hold: boolean) => {
		if (hold === held) return
		held = hold
		if (toast.value?.kind !== "success") return
		if (hold) {
			if (closeTm === undefined) return
			remaining = Math.max(0, deadline - Date.now())
			clearTimeout(closeTm)
			closeTm = undefined
			return
		}
		armTimer(remaining)
	}

	return { toast, openToast, closeToast, holdToast }
}
