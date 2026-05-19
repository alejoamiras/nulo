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

const displaceIdx = computed(() => popupStore.len - popupStore.popups.new_endpoint?.order)

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const network = computed(() => appStore.networks.find((n) => n.id === cacheStore.endpointEditNetworkId))

const labelTerm = ref("")
const urlTerm = ref("")
const errorText = ref("")
const isSubmitting = ref(false)

const isAvailableToCreate = computed(() => {
	if (urlTerm.value.length < 5) return false
	if (errorText.value) return false
	if (!network.value) return false
	return true
})

const handleCreate = async () => {
	if (!isAvailableToCreate.value || !network.value) return
	try {
		isSubmitting.value = true
		errorText.value = ""
		await managers.network.addEndpoint(network.value.id, labelTerm.value || undefined, urlTerm.value)
		appStore.networks = await managers.network.getNetworks()
		emit("onClose")
		openToast({ label: "Endpoint added" })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes("ENDPOINT_CHAIN_MISMATCH")) {
			errorText.value = `Wrong chain — this network is chain ${network.value?.chainId}.`
		} else if (msg.includes("DUPLICATE_ENDPOINT")) {
			errorText.value = "This URL is already an endpoint of this network."
		} else if (msg === "Failed to fetch node info") {
			errorText.value = "RPC didn't respond. Check the URL."
		} else {
			errorText.value = "Something went wrong."
		}
	} finally {
		isSubmitting.value = false
	}
}

watch(
	() => props.show,
	() => {
		if (props.show) {
			labelTerm.value = ""
			urlTerm.value = ""
			errorText.value = ""
			document.addEventListener("keydown", onKeydown)
		} else {
			document.removeEventListener("keydown", onKeydown)
		}
	},
)

const onKeydown = (e) => {
	if (e.key === "Enter") handleCreate()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_endpoint?.order"
		submitLabel="Add endpoint"
		:submitDisabled="!isAvailableToCreate"
		:submitLoading="isSubmitting"
		submitTestId="add-endpoint-submit"
		@submit="handleCreate"
	>
		<template #title>
			<Text size="14" weight="600" color="primary">
				Add endpoint
				<Text v-if="network" size="14" weight="600" color="tertiary"> · {{ network.name }}</Text>
			</Text>
		</template>

		<Input
			label="Label (optional)"
			placeholder="Backup"
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
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 0 20px">
				We'll probe the RPC and confirm it matches this chain before saving.
			</Text>
		</template>
	</FormPopup>
</template>
