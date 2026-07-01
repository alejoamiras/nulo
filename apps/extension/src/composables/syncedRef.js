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
			// Never trust the event's newValue directly: mid-migration commits
			// fire onChanged too, and adopting an intermediate value here would
			// let the watcher above echo it back AFTER the migration finishes.
			// Re-read through the facade instead — it waits for idle, so state
			// only ever reflects settled post-migration values. (Vue's watch
			// skips identical assignments, so the echo terminates.)
			void storageLocalGet([storageKey]).then((result) => {
				state.value = result[storageKey]
			})
		}
	})

	return state
}
