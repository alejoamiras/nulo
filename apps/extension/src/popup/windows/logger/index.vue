<script setup>
/** Utils */
import { ProfileServiceClient } from "@/wallet/services/profile/client"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

let profileService
let unsubscribe

function onActiveProfileChanged(profile) {
	if (!profile) {
		chrome.windows.getCurrent((window) => {
			chrome.windows.remove(window.id)
		})
	}
}

function onClose() {
	unsubscribe?.()
	unsubscribe = null
	profileService.disconnect()
	profileService = null
	appStore.loggerWindowId = null
}

onMounted(async () => {
	profileService = new ProfileServiceClient()
	profileService.connect()
	// subscribeActiveProfile delivers the current state once on subscribe,
	// then on every change, and re-delivers after SW-restart reconnects.
	// If the wallet is already locked when this window mounts, the first
	// invocation closes the window immediately instead of leaving it
	// stranded in a stale state (pre-existing subtle bug).
	unsubscribe = await profileService.subscribeActiveProfile(onActiveProfileChanged)
	window.addEventListener("beforeunload", onClose)
})

onUnmounted(() => {
	window.removeEventListener("beforeunload", onClose)
})
</script>

<template>
	<Flex
		align="start"
		direction="column"
		justify="start"
		gap="12"
		:class="[$style.wrapper, $style.json_viewer]"
	>
         <LogsViewer />
	</Flex>
</template>

<style module>
body {
	width: 100%;
	height: 100%;

	background: var(--app-bg);

	margin: 0 auto;
}

.wrapper {
	width: 100%;
	background: var(--app-bg);
}

.json_viewer {
	width: 100%;
	height: 100%;
	max-height: 100%;

	border: 1px solid var(--nulo-border);
	border-radius: 8px;
}
</style>
