import type { Ref } from "vue"
import { ref } from "vue"
import { defaultConfig } from "@/wallet/config"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/**
 * Reactive `showPopupFullscreen` config flag with the auto-fullscreen behavior on tall windows.
 *
 * Per-instance: each call owns one ConfigServiceClient subscription. The parent calls `start()` in
 * its `onMounted` (refresh from config, force `true` on a tall window) and `dispose()` in its
 * `onBeforeUnmount`. The ref is writable so consumers can toggle locally (e.g. the drag handle);
 * writes do NOT propagate back to the config service.
 */
export function useFullscreenPopupSetting(): { showFullscreen: Ref<boolean>; start: () => Promise<void>; dispose: () => void } {
	const showFullscreen = ref<boolean>(defaultConfig().showPopupFullscreen)

	const client = new ConfigServiceClient()
	client.onUpdate.add((setting) => {
		if (setting.key === "showPopupFullscreen") {
			showFullscreen.value = setting.value as boolean
		}
	})

	return {
		showFullscreen,
		start: async () => {
			showFullscreen.value = await client.getValue("showPopupFullscreen")
			if (window.innerHeight > 600) {
				showFullscreen.value = true
			}
		},
		dispose: () => client.disconnect(),
	}
}
