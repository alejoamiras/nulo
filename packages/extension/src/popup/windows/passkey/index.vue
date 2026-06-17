<route lang="json">
{
	"meta": {
		"isAuthRequired": false,
		"isPasskeyInteraction": true
	}
}
</route>

<script setup lang="ts">
/**
 * PATH B — SW-driven passkey window. Currently NO production callers
 * exercise this route. PATH A (`PasskeyCeremonyDialog.vue` rendered
 * inline by auth/profile-new/import.vue) is the active host for
 * popup-originated ceremonies.
 *
 * Path B is preserved for future SW/dApp-triggered passkey ceremonies
 * (e.g. content-script-triggered tx confirm via passkey when no popup
 * is open). The SW spawns this window via `WindowManager.openAndAwait`,
 * passes a `requestId`, and we post the result back via
 * `PasskeyService.resolvePasskeyRequest` so the SW can settle its
 * pending promise.
 *
 * Both paths call the same `runPasskeyCeremony` helper so the WebAuthn
 * parameter shape stays consistent. AbortSignal threading is wired
 * through here too — `onBeforeUnmount` aborts in case the window is
 * closed before the ceremony resolves.
 */
import { onBeforeUnmount, onMounted } from "vue"
import { PasskeyServiceClient } from "@/wallet/services/passkey/client"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { runPasskeyCeremony } from "@/wallet/utils/passkey-ceremony"

const route = useRoute()

const passkey = new PasskeyServiceClient()
const controller = new AbortController()

const run = async () => {
	const requestIdRaw = route.query.requestId
	const requestId = typeof requestIdRaw === "string" ? requestIdRaw : undefined
	if (!requestId) {
		window.close()
		return
	}
	try {
		passkey.connect()
		const request: PasskeyRequest = await passkey.getPendingRequest(requestId)
		const credentialData = await runPasskeyCeremony(request, controller.signal)
		await passkey.resolvePasskeyRequest(requestId, credentialData)
	} catch (e) {
		passkey.rejectPasskeyRequest(requestId, getErrorMessage(e))
	} finally {
		passkey.disconnect()
		window.close()
	}
}

onMounted(() => {
	run()
})

onBeforeUnmount(() => {
	// Abort any in-flight WebAuthn call so the navigator.credentials
	// promise rejects cleanly rather than dangling. Mirrors PasskeyCeremonyDialog.
	controller.abort(new DOMException("window closing", "AbortError"))
})
</script>

<template>
	<Flex align="center" justify="center" :class="$style.wrapper">
		<Text size="14" weight="600" color="primary"> Waiting for passkey... </Text>
	</Flex>
</template>

<style module>
.wrapper {
	height: 100%;
}
</style>
