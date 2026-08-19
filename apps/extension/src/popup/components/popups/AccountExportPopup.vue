<script setup>
/** Utils */
import { managers } from "@/utils/core"
import { copyToClipboard } from "@/utils/clipboard"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const emit = defineEmits(["onClose"])
const props = defineProps({ show: Boolean })

/** Reactive state */
const password = ref("")
const encrypt = ref(true)
const result = ref("")
const error = ref("")
const isBusy = ref(false)

const address = computed(() => cacheStore.accountToExportIdx ?? "")

function reset() {
	password.value = ""
	encrypt.value = true
	result.value = ""
	error.value = ""
	isBusy.value = false
}

const handleExport = async () => {
	if (!password.value || isBusy.value) return
	isBusy.value = true
	error.value = ""
	try {
		result.value = await managers.account.exportAccount(
			appStore.profile.id,
			appStore.network.chainId,
			address.value,
			password.value,
			encrypt.value,
		)
	} catch (err) {
		error.value = err instanceof Error ? err.message : "Wrong password"
	} finally {
		isBusy.value = false
	}
}

const handleCopy = () => {
	void copyToClipboard(result.value, openToast, {
		success: { label: "Export copied" },
		failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
	})
}

usePopupEntity(() => props.show, { submit: handleExport, onHide: reset })
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.export_account?.order"
		title="Export account"
		:submitLabel="result ? 'Done' : 'Reveal'"
		:submitDisabled="!result && (!password || isBusy)"
		submitTestId="export-account-submit"
		@submit="result ? emit('onClose') : handleExport()"
	>
		<Flex direction="column" gap="12">
			<template v-if="!result">
				<Toggle v-model="encrypt" label="Password-protect the file (recommended)" data-testid="export-account-encrypt-toggle" />
				<Input
					label="Profile password"
					type="password"
					placeholder="Your profile password"
					data-testid="export-account-password-input"
					v-model="password"
				/>
			</template>

			<template v-else>
				<Text size="12" weight="600" color="tertiary">Account export ({{ encrypt ? "encrypted" : "plaintext" }})</Text>
				<SecretRevealCard :value="result" label="Account export" testId="export-account-reveal" @copy="handleCopy" />
			</template>

			<Flex v-if="error" align="center" gap="6" data-testid="export-account-error">
				<Icon name="warning" size="12" color="red" />
				<Text size="12" weight="600" color="red">{{ error }}</Text>
			</Flex>
		</Flex>

		<template #belowSubmit>
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 0 20px">
				This file grants full control of ONE account. The plaintext variant is unencrypted — store it as carefully as your recovery phrase.
			</Text>
		</template>
	</FormPopup>
</template>
