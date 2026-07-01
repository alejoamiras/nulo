/** Utils */
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

const STORAGE_PREFIX = "nulo:ui:"

export function useSyncedRef(key, defaultValue) {
	const storageKey = STORAGE_PREFIX + key
	const state = ref(defaultValue)

	storageLocalGet([storageKey]).then((result) => {
		if (result[storageKey] !== undefined) {
			state.value = result[storageKey]
		}
	})

	watch(state, (newVal) => {
		storageLocalSet({ [storageKey]: newVal })
	})

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes[storageKey]) {
			state.value = changes[storageKey].newValue
		}
	})

	return state
}
