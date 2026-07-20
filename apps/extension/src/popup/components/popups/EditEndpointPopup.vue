<script setup>
/** Utils */
import { managers } from "@/utils/core"

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

const displaceIdx = computed(() => popupStore.len - popupStore.popups.edit_endpoint?.order)

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const network = computed(() => appStore.networks.find((n) => n.id === cacheStore.endpointEditNetworkId))
const endpoint = computed(() => network.value?.endpoints.find((e) => e.id === cacheStore.endpointEditId))

const form = useFormState({
	label: { initial: "" },
	url: { initial: "" },
})

const labelTerm = form.fields.label.value
const urlTerm = form.fields.url.value
const errorText = ref("")
const isSubmitting = ref(false)

const fillFromEndpoint = () => {
	// rebase() loads the values AND sets the dirty-baseline, so `form.isDirty`
	// below replaces the hand-rolled per-field comparison.
	form.rebase({ label: endpoint.value?.label ?? "", url: endpoint.value?.rpcUrl ?? "" })
	errorText.value = ""
}

const isDirty = form.isDirty

const isAvailableToSave = computed(() => {
	if (!endpoint.value || !network.value) return false
	if (urlTerm.value.length < 5) return false
	if (errorText.value) return false
	if (!isDirty.value) return false
	return true
})

const handleSave = async () => {
	if (!isAvailableToSave.value || !network.value || !endpoint.value) return
	try {
		isSubmitting.value = true
		errorText.value = ""
		await managers.network.updateEndpoint(network.value.id, endpoint.value.id, labelTerm.value || undefined, urlTerm.value)
		appStore.networks = await managers.network.getNetworks()
		emit("onClose")
		openToast({ label: "Endpoint updated" })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes("ENDPOINT_CHAIN_MISMATCH")) {
			errorText.value = `Wrong chain — this network is chain ${network.value.chainId}.`
		} else if (msg.includes("DUPLICATE_ENDPOINT")) {
			errorText.value = "Another endpoint of this network uses that URL."
		} else if (msg === "Failed to fetch node info") {
			errorText.value = "RPC didn't respond. Check the URL."
		} else {
			errorText.value = "Something went wrong."
		}
	} finally {
		isSubmitting.value = false
	}
}

usePopupEntity(() => props.show, {
	submit: handleSave,
	onShow: fillFromEndpoint,
})
</script>

<template>
	<FormPopup
		v-if="endpoint"
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.edit_endpoint?.order"
		submitLabel="Save"
		:submitDisabled="!isAvailableToSave"
		:submitLoading="isSubmitting"
		submitTestId="edit-endpoint-submit"
		@submit="handleSave"
	>
		<template #title>
			<Text size="14" weight="600" color="primary">
				Edit endpoint
				<Text v-if="network" size="14" weight="600" color="tertiary"> · {{ network.name }}</Text>
			</Text>
		</template>

		<Input
			label="Label"
			placeholder="Primary"
			autofocus
			sanitize
			:maxLength="25"
			v-model="labelTerm"
			data-testid="endpoint-label-input"
		/>

		<Input
			label="RPC URL"
			placeholder="https://rpc.example.com"
			v-model="urlTerm"
			@input="errorText = ''"
			data-testid="endpoint-rpc-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="errorText" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary">{{ errorText }}</Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template #belowSubmit>
			<Button @click="fillFromEndpoint" wide variant="primary_outline" size="medium" :disabled="!isDirty">
				Reset changes
			</Button>
		</template>
	</FormPopup>
</template>
