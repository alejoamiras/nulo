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

watch(
	() => props.show,
	() => {
		if (!props.show) {
			document.removeEventListener("keydown", onKeydown)

			handleFillFieldsWithDefaultValues()
		} else {
			document.addEventListener("keydown", onKeydown)

			handleFillFieldsWithDefaultValues()
		}
	},
)

const onKeydown = (e) => {
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleUpdateAccount()
}
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

<style module>
.network {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);

		& .icons {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.icons {
	opacity: 0;

	transition: all 0.2s var(--bezier);
}

.item {
	height: 30px;

	border-radius: 8px;
	border: 2px solid var(--nulo-border);
	cursor: pointer;

	padding: 0 16px;

	transition: all 0.2s var(--bezier);

	&:hover {
		border: 2px solid var(--nulo-outline);
	}

	&:active {
		background: var(--nulo-surface-high);
	}

	&.selected {
		background: var(--green);
	}

	&.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
}
</style>
