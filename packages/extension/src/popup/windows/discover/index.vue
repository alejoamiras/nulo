<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappStatusStrip from "@/components/composite/DappStatusStrip.vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"

/** Utils */
import { getErrorData } from "@nulo/wallet-core/utils"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import { type DiscoveryPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"

type UIError = {
	title: string
	tooltip: string
	type: string
}

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"

const router = useRouter()

const profile = ref<ProfileInfo>()
const isLoading = ref(false)
const processingError = ref<UIError>()

// isReady flips true only after init() commits payload + dApp identity +
// active profile. Gates Allow so the user can't approve a session whose
// hostname/logo/name they haven't seen yet (phishing surface). Allow stays
// disabled until the trust anchor is rendered; Deny stays fast on
// !requestId because early reject is harmless. Codex audit-codex-final-pass
// §2 chose Allow-only-gate over opus's symmetric-gate. Investigation
// journey: implementations-plan/network-followups/investigation-journey.md.
const isReady = ref(false)

const interactionService = new DappInteractionServiceClient()

const {
	requestId,
	dapp,
	isCancelled: isInteractionCancelled,
	load: loadInteractionPayload,
	reject: rejectViaInteractionService,
} = useDappInteractionPayload<DiscoveryPayload>({
	interactionService,
	getRequestId: () => router.currentRoute.value.query.requestId?.toString(),
	dappOf: (p) => p.params.dappMetadata,
})

const { hostname: dappHostname, isSuspicious: hostnameHasNonAscii } = useDappHostname(dapp)

function setError(title: string, tooltip: string = title, type: string = "error") {
	processingError.value = { title, tooltip, type }
}

const stripStatus = computed<"ready" | "loading" | "cancelled">(() => {
	if (isInteractionCancelled.value) return "cancelled"
	if (isLoading.value) return "loading"
	return "ready"
})

const init = async () => {
	try {
		profile.value = await profileService.getActiveProfile()
		await loadInteractionPayload()
		// Belt-and-suspenders: require every state `approve()` reads is committed
		// (profile, requestId, dapp). Codex review nit — relying on the composable
		// invariant alone ("load() only resolves after dapp.value is set") is true
		// today but brittle against future composable refactors. Stays false in
		// error paths so the Allow button never opens on a half-loaded popup.
		if (profile.value && requestId.value && dapp.value) isReady.value = true
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	}
}

const onActiveProfileChanged = (_profile?: ProfileInfo) => {
	if (!_profile || _profile.id !== profile.value?.id) {
		reject()
	}
}

const approve = async () => {
	// Defensive: template's `:disabled="!isReady"` should already block this,
	// but if a stray Enter / programmatic click slips through during init,
	// throw loudly rather than silently no-op. Silent guards on async-init
	// popups cost 19 iterations to find last time — see
	// implementations-plan/network-followups/investigation-journey.md.
	if (!isReady.value) {
		throw new Error("discover approve() called before init() completed — :disabled gate must include !isReady")
	}
	if (isInteractionCancelled.value || isLoading.value || !requestId.value) return
	try {
		isLoading.value = true
		await interactionService.resolveInteraction(requestId.value, { approved: true })
		closeWindow(true)
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	} finally {
		isLoading.value = false
	}
}

const reject = async () => {
	if (isInteractionCancelled.value || !requestId.value) return
	rejectViaInteractionService("User rejected")
	closeWindow(true)
}

const closeWindow = (interactionCompleted?: boolean) => {
	if (interactionCompleted) {
		window.removeEventListener("beforeunload", reject)
	}
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) {
			chrome.windows.remove(window.id)
		}
	})
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(async () => {
	profileService.connect()
	interactionService.connect()

	if (!appStore.isSessionChecked) {
		await new Promise<void>((resolve) => {
			const stop = watch(
				() => appStore.isSessionChecked,
				(checked) => {
					if (checked) {
						stop()
						resolve()
					}
				},
				{ immediate: true },
			)
		})
	}

	if (!appStore.isLogined) {
		appStore.pageAwaitingAuth = router.currentRoute.value.fullPath
		router.push({ path: "/popup/auth" })
		return
	}

	await init()
	window.addEventListener("beforeunload", reject)
})

onUnmounted(() => {
	profileService.disconnect()
	interactionService.disconnect()
	window.removeEventListener("beforeunload", reject)
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<DappStatusStrip
			:accountName="appStore.account?.name"
			:networkName="appStore.network?.name"
			:status="stripStatus"
		/>

		<Flex direction="column" :class="$style.scroll_area">
			<DappIdentityBlock
				:dapp="dapp"
				:hostname="dappHostname"
				:hostnameSuspicious="hostnameHasNonAscii"
				actionLabel="wants to connect to your wallet"
				hostnameTestId="discover-hostname"
				nameTestId="discover-dapp-name"
			/>

			<Flex direction="column" gap="8" :class="$style.body">
				<Text size="12" color="tertiary" :style="{ lineHeight: '1.5' }">
					Make sure you trust the site you're connecting to. You can revoke this connection any time from Settings → General → Sessions.
				</Text>
			</Flex>
		</Flex>

		<Flex direction="column" gap="10" :class="$style.footer">
			<Tooltip v-if="processingError" side="top" position="start" wide :disabled="!processingError.tooltip">
				<Flex align="center" wide gap="6">
					<Icon name="info" size="14" :color="processingError.type === 'warning' ? 'orange' : 'red'" />
					<Text data-testid="error-text" role="alert" size="12" weight="600" color="secondary">{{ processingError.title }}</Text>
				</Flex>

				<template #content>
					<Text size="12" color="secondary">{{ processingError.tooltip }}</Text>
				</template>
			</Tooltip>

			<Flex align="center" justify="between" gap="12">
				<Button
					data-testid="discover-deny-btn"
					@click="reject"
					wide
					variant="primary_outline"
					size="medium"
					:disabled="isLoading || !requestId"
				>
					Deny
				</Button>

				<Button
					data-testid="discover-allow-btn"
					@click="approve"
					wide
					variant="primary"
					size="medium"
					:loading="isLoading"
					:disabled="processingError?.type === 'error' || !isReady"
				>
					<Text size="13" color="inverse">Allow</Text>
				</Button>
			</Flex>
		</Flex>

		<DappCancelledOverlay v-if="isInteractionCancelled" @dismiss="closeWindow()" />
	</Flex>
</template>

<style module>
.wrapper {
	overflow: hidden;
	flex: 1;

	display: flex;
	flex-direction: column;

	background: var(--app-bg);
	border-top: 2px solid var(--nulo-accent);
}

.scroll_area {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.body {
	padding: 16px;
}

.footer {
	flex-shrink: 0;

	padding: 16px;
	border-top: 1px solid var(--nulo-border);
	background: var(--nulo-surface);
}
</style>
