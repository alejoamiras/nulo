<script setup>
/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"

/** Utils */
import { isValidHex } from "@/utils/string"

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
const props = defineProps({
	show: Boolean,
})

let fpcService = null
const fpcs = ref([])
const fpcToEdit = ref(null)

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v?.length) return null
			const conflicting = fpcs.value.find((f) => f.name === v && f.id !== fpcToEdit.value?.id)
			if (conflicting) return "Already exist"
			return null
		},
	},
	address: {
		initial: "",
		validate: (v) => {
			if (!v) return null
			if (!isValidHex(v)) return "Invalid address"
			return null
		},
	},
})

const nameTerm = form.fields.name.value
const addressTerm = form.fields.address.value

const isProtocol = computed(() => !!fpcToEdit.value?.isProtocol)
/** PrivateFPC validation can't tolerate arbitrary addresses (custom-salt
 * instances aren't publicly deployed and the wallet bundles a single
 * artifact version). Locking address-edit on PrivateFPC is honest UX,
 * and the manage-page also hides the edit affordance — this is the
 * defensive backstop in case the dialog ever opens for one. */
const isPrivateFpc = computed(() => fpcToEdit.value?.type === FpcType.PrivateFpc)

/** Reuses the per-type description from the manage-FPCs list so the
 * Edit dialog stays semantically consistent with the row the user
 * clicked. The disabled name input on protocol rows is the lock signal,
 * no extra copy needed. */
const typeDescription = computed(() => {
	if (fpcToEdit.value?.type === FpcType.PrivateFpc) return "Pays fees from your private Fee Juice"
	if (fpcToEdit.value?.type === FpcType.DefaultSponsoredFpc) return "Fees covered by sponsor"
	return ""
})

const nameChanged = computed(() => Boolean(fpcToEdit.value) && nameTerm.value !== (fpcToEdit.value?.name ?? ""))
const addressChanged = computed(() => Boolean(fpcToEdit.value) && addressTerm.value !== (fpcToEdit.value?.address ?? ""))
const hasChanges = computed(() => nameChanged.value || addressChanged.value)

const isAlreadyExist = computed(() => form.fields.name.error.value === "Already exist" && nameChanged.value)
const isAddressValid = computed(() => isValidHex(addressTerm.value))
const isAvailableToUpdateFpc = computed(() => {
	if (!hasChanges.value) return false
	// Name is locked on protocol rows; if it differs, that's an invalid edit.
	if (isProtocol.value && nameChanged.value) return false
	// Address is locked on PrivateFPC, period.
	if (isPrivateFpc.value && addressChanged.value) return false
	if (nameChanged.value) {
		if (!nameTerm.value?.length) return false
		if (form.fields.name.error.value) return false
	}
	if (addressChanged.value) {
		if (!isAddressValid.value) return false
	}
	return true
})

const handleFillFieldsWithDefaultValues = () => {
	nameTerm.value = fpcToEdit.value?.name ?? ""
	addressTerm.value = fpcToEdit.value?.address ?? ""
	processingError.value.show = false
}

const isFpcUpdateInProgress = ref(false)
const processingError = ref({ show: false, title: "", tooltip: "" })

const handleUpdateFpc = async () => {
	if (!isAvailableToUpdateFpc.value) return

	isFpcUpdateInProgress.value = true
	processingError.value.show = false
	try {
		// Address change first. It goes to PXE for validation; if it
		// rejects, we abort before persisting any name change.
		if (addressChanged.value) {
			await fpcService.updateFpcAddress(cacheStore.fpcToEditIdx, addressTerm.value)
		}
		if (nameChanged.value) {
			await fpcService.updateFpc(cacheStore.fpcToEditIdx, nameTerm.value)
		}
		emit("onClose")
		openToast({ label: "FPC is updated" })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		processingError.value = {
			show: true,
			title: msg,
			tooltip: "",
		}
	} finally {
		isFpcUpdateInProgress.value = false
	}
}
const onFpcAdded = (fpc) => {
	fpcs.value.push(fpc)
}
const onFpcUpdated = (fpc) => {
	const idx = fpcs.value.findIndex((f) => f.id === fpc.id)
	if (idx !== -1) fpcs.value[idx] = fpc
	if (fpcToEdit.value?.id === fpc.id) {
		fpcToEdit.value = fpc
	}
}
const onFpcDeleted = (fpc) => {
	if (fpc.id === fpcToEdit.value?.id) {
		emit("onClose")
		openToast({ label: "FPC was deleted" })
		return
	}
	fpcs.value = fpcs.value.filter((f) => f.id !== fpc.id)
}
const handleCopyAddress = () => {
	window.navigator.clipboard.writeText(fpcToEdit.value.address)
	openToast({ label: "FPC's address is copied", icon: "copy" })
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			document.removeEventListener("keydown", onKeydown)

			fpcService.disconnect()
			fpcService = null
			fpcToEdit.value = null
			fpcs.value = []
			form.reset()
			processingError.value = { show: false, title: "", tooltip: "" }
		} else {
			fpcService = new FpcServiceClient()
			fpcService.onFpcAdded.add(onFpcAdded)
			fpcService.onFpcDeleted.add(onFpcDeleted)
			fpcService.onFpcUpdated.add(onFpcUpdated)
			fpcToEdit.value = await fpcService.getFpc(cacheStore.fpcToEditIdx)
			if (!fpcToEdit.value) {
				emit("onClose")
				return
			}
			nameTerm.value = fpcToEdit.value.name ?? ""
			addressTerm.value = fpcToEdit.value.address ?? ""
			fpcs.value = await fpcService.getFpcs(appStore.network.chainId)

			document.addEventListener("keydown", onKeydown)
		}
	},
)

watch(
	() => addressTerm.value,
	() => {
		processingError.value.show = false
	},
)

const onKeydown = (e) => {
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleUpdateFpc()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.edit_fpc?.order"
		title="Edit FPC"
		submitLabel="Update"
		:submitDisabled="!isAvailableToUpdateFpc || processingError.show"
		:submitLoading="isFpcUpdateInProgress"
		submitTestId="edit-fpc-submit"
		@submit="handleUpdateFpc"
	>
		<ItemsContainer>
			<SettingItem
				size="large"
				:title="fpcToEdit?.name || fpcToEdit?.address"
				:description="typeDescription"
				icon="fpc"
				raw
			>
				<template #right>
					<Flex align="center" gap="8">
						<Tooltip position="end" delay="350">
							<Icon
								@click.stop="handleCopyAddress"
								name="copy"
								size="14"
								color="tertiary"
								hoverColor="primary"
								:class="$style.icon_btn"
							/>

							<template #content>Copy FPC's address</template>
						</Tooltip>
					</Flex>
				</template>
			</SettingItem>
		</ItemsContainer>

		<Input
			label="Name"
			placeholder="My FPC"
			v-model="nameTerm"
			autofocus
			sanitize
			:maxLength="25"
			:disabled="isProtocol"
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
			placeholder="0x..."
			v-model="addressTerm"
			sanitize
			:disabled="isPrivateFpc"
			data-testid="edit-fpc-address-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="!isAddressValid && addressTerm" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Invalid address </Text>
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
						<Icon name="info" size="14" color="red" />
						<Text size="12" weight="600" color="secondary" :style="{ paddingLeft: '4px' }">
							{{ processingError.title }}
						</Text>
					</Flex>
					<template #content>
						<Text size="12" color="secondary">{{ processingError.tooltip }}</Text>
					</template>
				</Tooltip>
			</Transition>
		</template>

		<template #belowSubmit>
			<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium">
				Reset changes
			</Button>
		</template>
	</FormPopup>
</template>

<style module>
.icon_btn {
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}

	&.disabled {
		pointer-events: none;
		opacity: 0.3;
	}
}
</style>
