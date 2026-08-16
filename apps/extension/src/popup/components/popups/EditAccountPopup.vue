<script setup>
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

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.edit_account?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const accountToEdit = computed(() => appStore.accounts.find((n) => n.address === cacheStore.accountToEditIdx))

const form = useFormState({
	name: { initial: "" },
	address: { initial: "" },
})

const nameTerm = form.fields.name.value
const addressTerm = form.fields.address.value

const isStartedEditing = computed(() => Boolean(accountToEdit.value) && nameTerm.value !== accountToEdit.value?.name)

const isAvailableToUpdateAccount = computed(() => {
	if (!nameTerm.value.length) return false
	if (!addressTerm.value.length) return false
	return true
})

const handleFillFieldsWithDefaultValues = () => {
	nameTerm.value = accountToEdit.value?.name ?? ""
	addressTerm.value = accountToEdit.value?.address ?? ""
}

const isAccountUpdateInProgress = ref(false)
const handleUpdateAccount = async () => {
	if (!isAvailableToUpdateAccount.value) return

	isAccountUpdateInProgress.value = true
	await appStore.updateAccount(cacheStore.accountToEditIdx, nameTerm.value)
	isAccountUpdateInProgress.value = false

	emit("onClose")

	openToast({ label: "Account is updated" })
}

usePopupEntity(() => props.show, {
	submit: handleUpdateAccount,
	onShow: handleFillFieldsWithDefaultValues,
	onHide: handleFillFieldsWithDefaultValues,
})
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.edit_account?.order"
		title="Edit account"
		submitLabel="Update account"
		:submitDisabled="!isAvailableToUpdateAccount"
		:submitLoading="isAccountUpdateInProgress"
		submitTestId="edit-account-submit"
		@submit="handleUpdateAccount"
	>
		<Input
			label="Name"
			placeholder="My Vault"
			v-model="nameTerm"
			autofocus
			sanitize
			:maxLength="25"
			data-testid="account-name-input"
		/>

		<template #belowSubmit>
			<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium">
				Reset changes
			</Button>
		</template>
	</FormPopup>
</template>

