<script setup>
/** Vendor */
import { onMounted } from "vue"

/** Utils */
import { DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"

const params = new URLSearchParams(window.location.search)
const requestId = params.get("requestId")
const payload = ref()
const data = computed(() => payload.value?.params.operations)

let profileService

function onActiveProfileChanged(profile) {
	if (!profile) {
		chrome.windows.getCurrent((window) => {
			chrome.windows.remove(window.id)
		})
	}
}

function onClose() {
	profileService?.disconnect()
	profileService = null
}

onMounted(async () => {
	const client = new DappInteractionServiceClient()
	payload.value = await client.getInteractionPayload(requestId)
	client.disconnect()

	profileService = new ProfileServiceClient()
	profileService.onActiveProfileChanged.add(onActiveProfileChanged)
	await profileService.connect()

	window.addEventListener("beforeunload", onClose)
})

onUnmounted(() => {
	window.removeEventListener("beforeunload", onClose)
})
</script>

<template>
	<Flex
		v-if="data"
		data-testid="json-content"
		align="start"
		direction="column"
		justify="start"
		gap="12"
		:class="[$style.wrapper, $style.json_viewer]"
	>
		<JsonViewer :data="data" fullscreen />
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
	composes: viewer_wrapper from "../window-shell.module.css";
}

.json_viewer {
	composes: json_viewer from "../window-shell.module.css";
}
</style>
