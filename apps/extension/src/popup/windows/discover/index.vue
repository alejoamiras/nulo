<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappStatusStrip from "@/components/composite/DappStatusStrip.vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import DappApprovalFooter from "@/components/composite/DappApprovalFooter.vue"

/** Utils */
import { getErrorData } from "@nulo/wallet-core/utils"
import { JobCancelledError } from "@nulo/extension-messaging/errors"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import { type DiscoveryPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"
import { useDappApprovalWindow } from "@/composables/useDappApprovalWindow"

const router = useRouter()

const profile = ref<ProfileInfo>()
const isLoading = ref(false)

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

// init/reject/services are referenced lazily (thunks): they are declared below
// and only invoked by start()/dispose()/the guard at runtime.
const {
	start: startWindow,
	dispose: disposeWindow,
	closeWindow,
	onActiveProfileChanged,
	stripStatus,
	processingError,
	setError,
} = useDappApprovalWindow({
	profile,
	isInteractionCancelled,
	isLoading,
	connectServices: () => {
		profileService.connect()
		interactionService.connect()
	},
	disconnectServices: () => {
		profileService.disconnect()
		interactionService.disconnect()
	},
	init: () => init(),
	reject: () => reject(),
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
		if (error instanceof JobCancelledError) {
			// A raced approve refused service-side (the dApp cancelled first):
			// the refusal IS the cancelled state — overlay, not an error banner.
			isInteractionCancelled.value = true
		} else {
			console.error(getErrorData(error))
			setError("Something went wrong")
		}
	} finally {
		isLoading.value = false
	}
}

const reject = async () => {
	if (isInteractionCancelled.value || !requestId.value) return
	rejectViaInteractionService("User rejected")
	closeWindow(true)
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(startWindow)

onUnmounted(disposeWindow)
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

		<DappApprovalFooter
			:processing-error="processingError"
			wide-tooltip
			reject-testid="discover-deny-btn"
			reject-label="Deny"
			:reject-disabled="isLoading || !requestId"
			confirm-testid="discover-allow-btn"
			confirm-label="Allow"
			:confirm-loading="isLoading"
			:confirm-disabled="processingError?.type === 'error' || !isReady"
			@reject="reject"
			@approve="approve"
		/>

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
</style>
