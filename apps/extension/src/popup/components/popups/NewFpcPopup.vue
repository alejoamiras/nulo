<script setup>
/** Utils */
import { isValidHex } from "@/utils/string"

/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"

/** Composables */
import { useToast, TOAST_DURATION } from "@/composables/toast"
import { useFormState } from "@/composables/useFormState"
import { isPopupSubmitKey } from "@/composables/usePopupEntity"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

let fpcService = null
const fpcs = ref([])

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.replace(/\s/g, "").length) return null
			if (fpcs.value.some((f) => f.name === v)) return "Already exist"
			return null
		},
	},
	address: {
		initial: "",
		validate: (v) => {
			if (!v) return null
			if (!isValidHex(v)) return "Invalid FPC address"
			return null
		},
	},
})

const nameTerm = form.fields.name.value
const fpcAddressTerm = form.fields.address.value

const isAlreadyExist = computed(() => form.fields.name.error.value === "Already exist")
const isValidAddress = computed(() => isValidHex(fpcAddressTerm.value))
const isAvailableToAddFpc = computed(() => {
	// Full-lifetime submit latch: a running save closes the form on EVERY
	// route (button, Enter, future callers) — not just the pointer path.
	if (isLoading.value) return false
	if (!nameTerm.value.replace(/\s/g, "").length) return false
	if (!isValidAddress.value) return false
	if (form.fields.name.error.value) return false
	return true
})

const isLoading = ref(false)
const processingError = ref({
	show: false,
	title: "",
	tooltip: "",
})

const handleAddFpc = async () => {
	if (!isAvailableToAddFpc.value) return

	isLoading.value = true
	try {
		await fpcService.addFpc(appStore.network.id, FpcType.DefaultSponsoredFpc, fpcAddressTerm.value, nameTerm.value)
		emit("onClose")
		openToast({ label: "FPC is added" })
	} catch (err) {
		processingError.value = {
			show: true,
			title: "Failed to add FPC.",
			tooltip: err,
		}
		openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		isLoading.value = false
	}
}
const onFpcAdded = (fpc) => {
	fpcs.value.push(fpc)
}
const onFpcUpdated = (fpc) => {
	const idx = fpcs.value.findIndex((f) => f.id === fpc.id)
	if (idx === -1) return
	fpcs.value[idx] = fpc
}
const onFpcDeleted = (fpc) => {
	fpcs.value = fpcs.value.filter((f) => f.id !== fpc.id)
}
watch(
	() => props.show,
	async () => {
		if (!props.show) {
			fpcService.disconnect()
			fpcService = null
			fpcs.value = []
			form.reset()

			document.removeEventListener("keydown", onKeydown)
		} else {
			fpcService = new FpcServiceClient()
			fpcService.onFpcAdded.add(onFpcAdded)
			fpcService.onFpcDeleted.add(onFpcDeleted)
			fpcService.onFpcUpdated.add(onFpcUpdated)
			fpcs.value = await fpcService.getFpcs(appStore.network.chainId)

			document.addEventListener("keydown", onKeydown)
		}
	},
)
watch(
	() => fpcAddressTerm.value,
	() => {
		processingError.value.show = false
	},
)
const onKeydown = (e) => {
	if (isPopupSubmitKey(e)) handleAddFpc()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_fpc?.order"
		title="New Sponsored FPC"
		submitLabel="Add FPC"
		:submitDisabled="!isAvailableToAddFpc || processingError.show"
		:submitLoading="isLoading"
		submitTestId="new-fpc-submit"
		@submit="handleAddFpc"
	>
		<Input
			label="Name"
			placeholder="My fpc"
			autofocus
			sanitize
			:maxLength="25"
			v-model="nameTerm"
			data-testid="fpc-name-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isAlreadyExist" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Already exist </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<Input
			label="Address"
			placeholder="0x15c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701446"
			sanitize
			v-model="fpcAddressTerm"
			data-testid="fpc-address-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="!isValidAddress && fpcAddressTerm" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Invalid FPC address </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template #aboveSubmit>
			<Transition name="fade">
				<Tooltip
					v-if="processingError.show"
					side="top"
					position="start"
					wide
					:disabled="!processingError.tooltip"
					:style="{ marginTop: '-12px' }"
				>
					<Flex align="center" wide>
						<Icon
							name="info"
							size="14"
							:color="processingError.type === 'warning' ? 'orange' : 'red'"
						/>

						<Text size="12" weight="600" color="secondary" :style="{ paddingLeft: '4px' }">
							{{ processingError.title }}
						</Text>
					</Flex>

					<template #content>
						<Text size="12" color="secondary">
							{{ processingError.tooltip }}
						</Text>
					</template>
				</Tooltip>
			</Transition>
		</template>
	</FormPopup>
</template>
