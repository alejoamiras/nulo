import { defineStore } from "pinia"

type OpenedPopups = {
	[key: string]: {
		order: number
		payload?: unknown
	}
}

export const usePopupStore = defineStore("popup", () => {
	const popups = ref<OpenedPopups>({})
	const len = computed(() => Object.keys(popups.value).length)

	const isOpened = (target: string) => {
		return target in popups.value
	}
	const open = (target: string, payload?: unknown) => {
		popups.value[target] = {
			order: Object.keys(popups.value).length,
			payload,
		}
	}
	const getPayload = (target: string) => {
		return popups.value[target]?.payload
	}
	// Orders stay 0..len-1 with no gaps, so a popup closed underneath a newer one never leaves its
	// slot for the next `open` to duplicate.
	const close = (target: string) => {
		const closed = popups.value[target]
		if (!closed) return
		delete popups.value[target]
		for (const entry of Object.values(popups.value)) {
			if (entry.order > closed.order) entry.order -= 1
		}
	}
	const closeAll = () => {
		popups.value = {}
	}

	return { popups, len, isOpened, open, close, closeAll, getPayload }
})
