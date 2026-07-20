<script setup>
/** Utils */
import { isValidHex } from "@/utils/string"

/** Services */
import { ContactServiceClient } from "@/wallet/services/contact/client"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.edit_contact?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const contactService = new ContactServiceClient()
contactService.onContactAdded.add(onContactAdded)
contactService.onContactUpdated.add(onContactUpdated)
contactService.onContactDeleted.add(onContactDeleted)

function onContactAdded(contact) {
	contacts.value.push(contact)
}
function onContactUpdated(contact) {
	const idx = contacts.value.findIndex((c) => c.id === contact.id)
	if (idx !== -1) {
		if (cacheStore.contactToEditIdx && contact.id === contactToEdit.id) {
			nameTerm.value = contact.name
			contactAddressTerm.value = contact.address
			return
		}
		contacts.value[idx] = contact
	} else {
		contacts.value.push(contact)
	}
}
function onContactDeleted(contact) {
	contacts.value = contacts.value.filter((c) => c.id !== contact.id)
}

const contactToEdit = ref(null)
const contacts = ref([])

/** Name + address managed by useFormState. The "already exist" check
 *  filters out the contact-being-edited so saving with the SAME name/
 *  address it already has doesn't trip the duplicate guard. */
const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.replace(/\s/g, "").length) return null
			const conflicting = contacts.value.find((c) => c.name === v && c.id !== contactToEdit.value?.id)
			if (conflicting) return "Already exist"
			return null
		},
	},
	address: {
		initial: "",
		validate: (v) => {
			if (!v) return null
			if (!isValidHex(v)) return "Invalid address"
			const conflicting = contacts.value.find((c) => c.address === v && c.id !== contactToEdit.value?.id)
			if (conflicting) return "Already exist"
			return null
		},
	},
})

const nameTerm = form.fields.name.value
const contactAddressTerm = form.fields.address.value

// Per-field dirty: name/address are "edited" if value differs from the
// loaded contact. Used to gate the Update button's "anything changed?"
// check and the "Already exist" warning's display (don't show the warning
// while the user is still on the unchanged row).
const isStartedEditingName = computed(() => Boolean(contactToEdit.value) && nameTerm.value?.trim() !== contactToEdit.value?.name)
const isStartedEditingAddress = computed(() => Boolean(contactToEdit.value) && contactAddressTerm.value !== contactToEdit.value?.address)

const isAlreadyExistName = computed(() => form.fields.name.error.value === "Already exist" && isStartedEditingName.value)
const isAlreadyExistAddress = computed(() => form.fields.address.error.value === "Already exist" && isStartedEditingAddress.value)
const isValidAddress = computed(() => isValidHex(contactAddressTerm.value))
const isAvailableToUpdateContact = computed(() => {
	if (!nameTerm.value?.replace(/\s/g, "").length) return false
	if (!isValidAddress.value) return false
	if (form.fields.name.error.value) return false
	if (form.fields.address.error.value) return false
	return true
})

const isLoading = ref(false)
const processingError = ref({
	show: false,
	title: "",
	tooltip: "",
})

function handleFillFieldsWithDefaultValues() {
	nameTerm.value = contactToEdit.value?.name ?? ""
	contactAddressTerm.value = contactToEdit.value?.address ?? ""
}

const handleUpdateContact = async () => {
	if (!isAvailableToUpdateContact.value) return

	isLoading.value = true
	try {
		if (cacheStore.importContact) {
			cacheStore.importContact = {
				...contactToEdit.value,
				name: nameTerm.value.trim(),
				address: contactAddressTerm.value,
				updated: true,
			}
			emit("onClose")
		} else {
			await contactService.updateContact(contactToEdit.value.id, nameTerm.value.trim(), contactAddressTerm.value)

			emit("onClose")
			openToast({ label: "Contact is updated" })
		}
	} catch (err) {
		processingError.value = {
			show: true,
			title: "Failed to update contact.",
			tooltip: err,
		}

		openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		isLoading.value = false
	}
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			cacheStore.contactToEditIdx = ""

			contactService.disconnect()

			contactToEdit.value = null
			contacts.value = []

			form.reset()

			document.removeEventListener("keydown", onKeydown)
		} else {
			contacts.value = await contactService.getContacts()
			contactToEdit.value = cacheStore.importContact
				? cacheStore.importContact
				: contacts.value.find((c) => c.id === cacheStore.contactToEditIdx)
			nameTerm.value = contactToEdit.value?.name ?? ""
			contactAddressTerm.value = contactToEdit.value?.address ?? ""

			document.addEventListener("keydown", onKeydown)
		}
	},
)

watch(
	() => [nameTerm.value, contactAddressTerm.value],
	() => {
		processingError.value.show = false
	},
)

const onKeydown = (e) => {
	// Only fire on input/textarea fields. Pressing Enter while focused on
	// the Update button would otherwise double-fire (button activation
	// triggers @submit on its own).
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleUpdateContact()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.edit_contact?.order"
		title="Edit contact"
		submitLabel="Update contact"
		:submitDisabled="
			!isAvailableToUpdateContact ||
			processingError.show ||
			!(isStartedEditingName || isStartedEditingAddress)
		"
		:submitLoading="isLoading"
		submitTestId="edit-contact-submit"
		@submit="handleUpdateContact"
	>
		<Input
			label="Name"
			placeholder="New contact"
			autofocus
			sanitize
			:maxLength="25"
			v-model="nameTerm"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isAlreadyExistName" align="center" gap="6">
						<Icon name="warning" size="12" color="primary" />
						<Text size="12" weight="600" color="primary"> Already exist </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<AddressInput
			label="Address"
			placeholder="0x15c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701446"
			v-model="contactAddressTerm"
			sanitize
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="!isValidAddress && contactAddressTerm" align="center" gap="6">
						<Icon name="warning" size="12" color="primary" />
						<Text size="12" weight="600" color="primary"> Invalid address </Text>
					</Flex>
					<Flex v-else-if="isAlreadyExistAddress && contactAddressTerm" align="center" gap="6">
						<Icon name="warning" size="12" color="primary" />
						<Text size="12" weight="600" color="primary"> Already exist </Text>
					</Flex>
				</Transition>
			</template>
		</AddressInput>

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
							color="primary"
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

		<template #belowSubmit>
			<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium">
				Reset changes
			</Button>
		</template>
	</FormPopup>
</template>

<style module>
.shake {
	animation: shake 0.5s ease;
}

@keyframes shake {
	0%,
	100% {
		transform: translateX(0);
	}
	25% {
		transform: translateX(-2px);
	}
	50% {
		transform: translateX(2px);
	}
	75% {
		transform: translateX(-2px);
	}
}
</style>
