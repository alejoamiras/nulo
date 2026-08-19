<script setup>
/** Utils */
import { managers } from "@/utils/core"
import { pickFile } from "@/utils"
import { storageLocalSet } from "@/utils/storage"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({ show: Boolean })

/** Reactive state */
const fileBody = ref("")
const password = ref("")
const previewAddress = ref("")
const error = ref("")
const isBusy = ref(false)

const needsConfirm = computed(() => previewAddress.value.length > 0)

function reset() {
	fileBody.value = ""
	password.value = ""
	previewAddress.value = ""
	error.value = ""
	isBusy.value = false
}

const handlePickFile = async () => {
	const picked = await pickFile()
	if (typeof picked === "string") {
		fileBody.value = picked.trim()
		previewAddress.value = ""
		error.value = ""
	}
}

// Step 1 — decode + recompute the address (SW-side), show it for the user to confirm.
const handlePreview = async () => {
	if (!fileBody.value.trim() || isBusy.value) return
	isBusy.value = true
	error.value = ""
	try {
		previewAddress.value = await managers.account.previewImportAccount(fileBody.value.trim(), password.value)
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err)
	} finally {
		isBusy.value = false
	}
}

// Step 2 — the user confirmed the address; write the account.
const handleConfirmImport = async () => {
	if (!needsConfirm.value || isBusy.value) return
	isBusy.value = true
	error.value = ""
	try {
		const account = await managers.account.importAccount(
			appStore.profile.id,
			appStore.network.chainId,
			fileBody.value.trim(),
			previewAddress.value,
			password.value,
		)
		appStore.accounts.push(account)
		await storageLocalSet({ "nulo:ui:activeAccount": account.address })
		openToast({ label: "Account imported", icon: "check-circle" }, 2_000)
		emit("onClose")
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err)
	} finally {
		isBusy.value = false
	}
}

usePopupEntity(() => props.show, {
	submit: () => (needsConfirm.value ? handleConfirmImport() : handlePreview()),
	onHide: reset,
})
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.import_account?.order"
		title="Import account"
		:submitLabel="needsConfirm ? 'Confirm import' : 'Preview'"
		:submitDisabled="needsConfirm ? isBusy : !fileBody.trim() || isBusy"
		submitTestId="import-account-submit"
		@submit="needsConfirm ? handleConfirmImport() : handlePreview()"
	>
		<Flex direction="column" gap="12">
			<Input
				label="Account export"
				placeholder="Paste the export file contents"
				data-testid="import-account-body-input"
				v-model="fileBody"
			/>
			<Button variant="secondary" size="small" @click="handlePickFile" data-testid="import-account-pick-file">Choose file…</Button>

			<Input
				label="Password (encrypted files only)"
				type="password"
				placeholder="File password"
				data-testid="import-account-password-input"
				v-model="password"
			/>

			<Flex v-if="needsConfirm" direction="column" gap="6" data-testid="import-account-confirm">
				<Text size="12" weight="600" color="tertiary">Confirm this is the account you expect</Text>
				<Text size="13" weight="600" color="primary" data-testid="import-account-preview-address">{{ previewAddress }}</Text>
			</Flex>

			<Flex v-if="error" align="center" gap="6" data-testid="import-account-error">
				<Icon name="warning" size="12" color="red" />
				<Text size="12" weight="600" color="red">{{ error }}</Text>
			</Flex>
		</Flex>

		<template #belowSubmit>
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 0 20px">
				An imported account is NOT covered by your recovery phrase — keep its export file safe.
			</Text>
		</template>
	</FormPopup>
</template>
