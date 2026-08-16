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
	return popupStore.len - popupStore.popups.edit_network?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const networkToEdit = computed(() => appStore.networks.find((n) => n.id === cacheStore.networkToEditIdx))

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.length) return null
			const conflicting = appStore.networks.find((n) => n.name === v && n.id !== networkToEdit.value?.id)
			if (conflicting) return "Already exists"
			return null
		},
	},
	/** Vestigial — kept for the URL input that's now read-only. Endpoint URL
	 *  editing lives in the per-`Network` detail page. */
	url: { initial: "" },
})

const nameTerm = form.fields.name.value
const urlTerm = form.fields.url.value

const isStartedEditingName = form.fields.name.isDirty
const isNameAlreadyExist = computed(() => form.fields.name.error.value === "Already exists" && isStartedEditingName.value)

const isAvailableToUpdateNetwork = computed(() => {
	if (!nameTerm.value.length) return false
	if (nameTerm.value === networkToEdit.value?.name) return false
	if (form.fields.name.error.value) return false
	return true
})

const handleFillFieldsWithDefaultValues = () => {
	const primary = networkToEdit.value?.endpoints.find((e) => e.id === networkToEdit.value.primaryEndpointId)
	// rebase() loads values + sets the dirty-baseline so `field.isDirty` drives
	// the "Already exists" warning gating (isStartedEditingName) above.
	form.rebase({ name: networkToEdit.value?.name ?? "", url: primary?.rpcUrl ?? "" })
}

const isNetworkUpdateInProgress = ref(false)
const handleUpdateNetwork = async () => {
	if (!isAvailableToUpdateNetwork.value) return

	isNetworkUpdateInProgress.value = true
	await appStore.renameNetwork(cacheStore.networkToEditIdx, nameTerm.value)
	isNetworkUpdateInProgress.value = false

	emit("onClose")

	openToast({ label: "Network is updated" })
}

usePopupEntity(() => props.show, {
	submit: handleUpdateNetwork,
	onShow: handleFillFieldsWithDefaultValues,
	onHide: handleFillFieldsWithDefaultValues,
})
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.edit_network?.order"
		title="Edit network"
		submitLabel="Update"
		:submitDisabled="!isAvailableToUpdateNetwork || !isStartedEditingName"
		:submitLoading="isNetworkUpdateInProgress"
		submitTestId="edit-network-submit"
		@submit="handleUpdateNetwork"
	>
		<ItemsContainer>
			<SettingItem
				size="large"
				:title="networkToEdit.name"
				description="Selected network for editing"
				icon="globe-edit"
				raw
			/>
		</ItemsContainer>

		<Input
			label="New name"
			placeholder="My network"
			v-model="nameTerm"
			autofocus
			sanitize
			:maxLength="25"
			data-testid="network-name-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isNameAlreadyExist" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Already exists </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template #belowSubmit>
			<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium">
				Reset changes
			</Button>
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 8px 20px 0">
				Endpoint URLs are managed in the per-network detail page.
			</Text>
		</template>
	</FormPopup>
</template>

