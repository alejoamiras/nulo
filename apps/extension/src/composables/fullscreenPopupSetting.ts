import type { Ref } from "vue"
import { onBeforeUnmount, onMounted, ref } from "vue"

import { Config } from "@/wallet/config"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/**
 * Reactive `showPopupFullscreen` config flag with the auto-fullscreen
 * behavior on tall windows that `PopupCard` had inline.
 *
 * Per-instance: each call creates its own ConfigServiceClient
 * subscription and disposes it on the parent's unmount. Returns a
 * writable Ref so consumers can toggle locally (e.g. drag handle);
 * writes do NOT propagate back to the config service.
 *
 * Mirrors the prior PopupCard.vue lifecycle 1:1 (no behavior change):
 *   - initial: Config().showPopupFullscreen default
 *   - onUpdate: subscribed to config service "showPopupFullscreen" key
 *   - onMounted: refresh from config + force `true` if window is tall
 *   - onBeforeUnmount: dispose the client
 */
export function useFullscreenPopupSetting(): Ref<boolean> {
	const showFullscreen = ref<boolean>(new Config().showPopupFullscreen)

	const client = new ConfigServiceClient()
	client.onUpdate.add((setting) => {
		if (setting.key === "showPopupFullscreen") {
			showFullscreen.value = setting.value as boolean
		}
	})

	onMounted(async () => {
		showFullscreen.value = await client.getValue("showPopupFullscreen")
		if (window.innerHeight > 600) {
			showFullscreen.value = true
		}
	})

	onBeforeUnmount(() => {
		client.disconnect()
	})

	return showFullscreen
}
