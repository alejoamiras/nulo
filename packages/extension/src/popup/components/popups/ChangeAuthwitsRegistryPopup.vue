<script setup>
/** Components */
import FeeSettingsCard from "@/popup/components/modules/send/FeeSettingsCard.vue"

/** Utils */
import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
import { classifyCancellableRejection } from "@/popup/utils/cancellable-rejection"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.change_authwits_registry?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const authwitsService = new AuthRegistryServiceClient()
authwitsService.onRegistryEnabled.add(onRegistryEnabled)
authwitsService.onRegistryDisabled.add(onRegistryDisabled)
function onRegistryEnabled(account) {
	if (appStore.account?.address === account) {
		isRegistryEnabled.value = true
	}
}
function onRegistryDisabled(account) {
	if (appStore.account?.address === account) {
		isRegistryEnabled.value = false
	}
}

const isRegistryEnabled = ref(undefined)
const feeSettings = ref()
const isLoading = ref(false)
const error = ref()
const isErrorOccurred = computed(() => !!error.value)

async function fetchRegistryStatus() {
	isLoading.value = true

	try {
		isRegistryEnabled.value = await authwitsService.getRegistryEnabled(appStore.account.address)
	} catch (err) {
		error.value = err
	} finally {
		isLoading.value = false
	}
}

const isAllowedToExecute = computed(() => {
	if (!feeSettings.value) return

	return true
})

async function handleChangeRegistry() {
	// `isAllowedToExecute` is a computed ref (always truthy as a ref object) —
	// must dereference `.value` for the guard to actually work. Pre-fix this
	// guard was a no-op, letting Enter / programmatic clicks fire the handler
	// before `feeSettings.value` was set. Codex audit-codex-rootcause-8 #3.
	if (!isAllowedToExecute.value) return

	try {
		isLoading.value = true

		await authwitsService.setRegistryEnabled(appStore.network.id, appStore.account.address, !isRegistryEnabled.value, feeSettings.value)

		openToast({ label: "Account authwit registry is changed" })
	} catch (err) {
		// User-initiated cancel: terminal card in RecentActivityView says
		// "Cancelled" — suppress the failure toast + error.value.
		if (classifyCancellableRejection(err) !== "silent") {
			error.value = err
			openToast({ label: "Failed to change registry status", icon: "warning" }, TOAST_DURATION.LONG)
		}
	} finally {
		emit("onClose")
	}
}

watch(
	() => props.show,
	async () => {
		if (props.show) {
			await fetchRegistryStatus()

			document.addEventListener("keydown", onKeydown)
		} else {
			isRegistryEnabled.value = undefined
			isLoading.value = false
			error.value = null

			authwitsService.disconnect()

			document.removeEventListener("keydown", onKeydown)
		}
	},
)

const onKeydown = (e) => {
	// Mirror the full button :disabled gate (template uses
	// `!isAllowedToExecute || isLoading`). Without the isLoading check,
	// rapid Enter could re-enter the handler while a request is in flight.
	if (e.key === "Enter" && isAllowedToExecute.value && !isLoading.value) handleChangeRegistry()
}
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.change_authwits_registry?.order">
		<PopupCard :displaceIdx>
			<PopupHeader @onClose="emit('onClose')" closable>
				<template #title>
					<Text size="14" weight="600" color="primary">Change account authwits registry</Text>
				</template>
			</PopupHeader>

			<Flex wide direction="column" gap="20" :class="$style.wrapper">
				<Banner v-if="isRegistryEnabled" direction="vertical">
					<template #title>Disable Authwits Registry</template>
					<template #description>
						Disabling prevents contracts from consuming authwits for current account. 
						All previously issued authwits will be suspended and cannot be executed until you re-enable the registry.
					</template>
				</Banner>
				<Banner v-else-if="!isRegistryEnabled && isRegistryEnabled !== undefined" direction="vertical">
					<template #title>Enable Authwits Registry</template>
					<template #description>
						Enabling allows contracts to consume authwits for current account. 
						Any previously issued authwits will become executable again.
					</template>
				</Banner>

				<FeeSettingsCard
					:profile="appStore.profile"
					:network="appStore.network"
					:account="appStore.account"
					v-model="feeSettings"
				/>

				<Flex align="center" direction="column" gap="12">
					<Button
						@click="handleChangeRegistry"
						variant="primary"
						size="medium"
						wide
						:loading="isLoading"
						:disabled="!isAllowedToExecute || isLoading"
					>
						Send
					</Button>

					<Tooltip v-if="isErrorOccurred" side="top">
						<Flex align="center" gap="6">
							<Icon name="info" size="12" color="red" />
							<Text size="12" weight="500" color="secondary">
								An error occurred while executing the transaction
							</Text>
						</Flex>

						<template #content> {{ error }} </template>
					</Tooltip>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
</style>
