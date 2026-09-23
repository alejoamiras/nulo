import { ref } from "vue"

export type ToastKind = "ok" | "error" | "info"

export interface ToastEntry {
	readonly id: number
	readonly kind: ToastKind
	readonly text: string
	readonly link?: { label: string; href: string }
}

interface NewToast {
	readonly kind: ToastKind
	readonly text: string
	readonly link?: { label: string; href: string }
	readonly ttlMs?: number
}

const DEFAULT_TTL_MS = 6_000
const MAX_QUEUE = 4

const toasts = ref<ToastEntry[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1

export function useToast() {
	return {
		toasts,
		push,
		dismiss,
	}
}

function push(toast: NewToast): number {
	const id = nextId++
	const entry: ToastEntry = { id, kind: toast.kind, text: toast.text, link: toast.link }
	// Append to the end; if we exceed MAX_QUEUE, drop the oldest.
	const next = [...toasts.value, entry]
	while (next.length > MAX_QUEUE) {
		const dropped = next.shift()
		if (dropped) clearTimer(dropped.id)
	}
	toasts.value = next

	const ttl = toast.ttlMs ?? DEFAULT_TTL_MS
	const handle = setTimeout(() => dismiss(id), ttl)
	timers.set(id, handle)
	return id
}

function dismiss(id: number): void {
	clearTimer(id)
	toasts.value = toasts.value.filter((t) => t.id !== id)
}

function clearTimer(id: number): void {
	const handle = timers.get(id)
	if (handle !== undefined) {
		clearTimeout(handle)
		timers.delete(id)
	}
}

/** Test-only: clear state between cases. */
export function __resetToastsForTests(): void {
	for (const handle of timers.values()) clearTimeout(handle)
	timers.clear()
	toasts.value = []
	nextId = 1
}
