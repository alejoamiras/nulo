import { computed, onScopeDispose, ref } from "vue"

export interface UseSecretCountdownOptions {
	/** Auto-close window in ms. Each export page picks its own (key=2min, seed=5min). */
	autoCloseMs: number
	/** Called when the countdown reaches zero. The page wires its close handler here. */
	onTimeout: () => void
}

export function useSecretCountdown(options: UseSecretCountdownOptions) {
	const closeDeadline = ref(0)
	const isAutoCloseDisabled = ref(false)
	const now = ref(Date.now())
	let closeTimeout: ReturnType<typeof setTimeout> | undefined
	let tickInterval: ReturnType<typeof setInterval> | undefined

	const countdownLabel = computed(() => {
		if (!closeDeadline.value) return ""
		const remaining = Math.max(0, closeDeadline.value - now.value)
		const totalSec = Math.ceil(remaining / 1000)
		const min = Math.floor(totalSec / 60)
		const sec = totalSec % 60
		return `${min}:${sec.toString().padStart(2, "0")}`
	})

	const start = () => {
		closeDeadline.value = Date.now() + options.autoCloseMs
		now.value = Date.now()
		closeTimeout = setTimeout(() => {
			options.onTimeout()
		}, options.autoCloseMs)
		tickInterval = setInterval(() => {
			now.value = Date.now()
		}, 1_000)
	}

	const clear = () => {
		if (closeTimeout) clearTimeout(closeTimeout)
		if (tickInterval) clearInterval(tickInterval)
		closeTimeout = undefined
		tickInterval = undefined
	}

	const disable = () => {
		clear()
		closeDeadline.value = 0
		isAutoCloseDisabled.value = true
	}

	onScopeDispose(clear)

	return {
		closeDeadline,
		countdownLabel,
		isAutoCloseDisabled,
		start,
		disable,
		clear,
	}
}
