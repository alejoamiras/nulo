<script setup>
/** Composables */
import { useToast, TOAST_DURATION } from "@/composables/toast"
import { useFormState } from "@/composables/useFormState"
import { usePopupEntity } from "@/composables/usePopupEntity"
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
	// Full-lifetime submit latch: a running save closes the form on EVERY
	// route (button, Enter, future callers) — not just the pointer path.
	if (isAccountUpdateInProgress.value) return false
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

	// finally, not sequential clear: a rejected update must release the latch
	// or the folded validity source would lock the form disabled for good. The
	// catch is part of the same repair — the rejection previously escaped as an
	// unhandled promise (both submit routes fire-and-forget) with zero user
	// feedback; the family's standard error toast handles it.
	isAccountUpdateInProgress.value = true
	try {
		await appStore.updateAccount(cacheStore.accountToEditIdx, nameTerm.value)
	} catch {
		openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG)
		return
	} finally {
		isAccountUpdateInProgress.value = false
	}

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

