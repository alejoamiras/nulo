<script setup>
/** Utils */
import { isValidHex } from "@/utils/string"

/** Services */
import { ContactServiceClient } from "@/wallet/services/contact/client"

/** Composables */
import { useToast, TOAST_DURATION } from "@/composables/toast"
import { useFormState } from "@/composables/useFormState"
import { usePopupEntity } from "@/composables/usePopupEntity"
const { openToast } = useToast()

/** Store */
import { usePopupStore } from "@/stores/popup.store"
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.new_contact?.order
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
		contacts.value[idx] = contact
	} else {
		contacts.value.push(contact)
	}
}
function onContactDeleted(contact) {
	contacts.value = contacts.value.filter((c) => c.id !== contact.id)
}

const contacts = ref([])

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.replace(/\s/g, "").length) return null // empty is "not yet valid", not an error to display
			if (contacts.value.some((c) => c.name === v)) return "Already exist"
			return null
		},
	},
	address: {
		initial: "",
		validate: (v) => {
			if (!v) return null // empty: pre-input, not an error to display
			if (!isValidHex(v)) return "Invalid address"
			// Hex is case-insensitive — a mixed-case rendering of a saved
			// address is the same contact, not a new one.
			if (contacts.value.some((c) => c.address.toLowerCase() === v.toLowerCase())) return "Already exist"
			return null
		},
	},
})

// Aliases preserve the existing template bindings (v-model="nameTerm" etc.).
const nameTerm = form.fields.name.value
const contactAddressTerm = form.fields.address.value

// Existing template uses these inline-warning predicates. Map to the form's
// error messages so the visual contract is unchanged.
const isAlreadyExistName = computed(() => form.fields.name.error.value === "Already exist")
const isValidAddress = computed(() => isValidHex(contactAddressTerm.value))
const isAlreadyExistAddress = computed(() => form.fields.address.error.value === "Already exist")

const isAvailableToAddContact = computed(() => {
	// Full-lifetime submit latch: a running save closes the form on EVERY
	// route (button, Enter, future callers) — not just the pointer path.
	if (isLoading.value) return false
	if (!nameTerm.value.replace(/\s/g, "").length) return false
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

const handleAddContact = async () => {
	if (!isAvailableToAddContact.value) return

	isLoading.value = true
	try {
		// Canonicalize to lowercase on save — the wallet emits lowercase hex
		// everywhere else (PXE senders, derived addresses), and case-mixed
		// stored rows break exact-match lookups downstream.
		await contactService.addContact(nameTerm.value.trim(), contactAddressTerm.value.toLowerCase())

		emit("onClose")
		openToast({ label: "Contact is added" })
	} catch (err) {
		processingError.value = {
			show: true,
			title: "Failed to add contact.",
			tooltip: err,
		}

		openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		isLoading.value = false
	}
}

// No submitWaitsForShow here: this popup already installed its listener
// BEFORE the getContacts await (Enter-live-during-population is its pinned
// timing), and its duplicate checks tolerate the empty initial list.
usePopupEntity(() => props.show, {
	submit: handleAddContact,
	onShow: async () => {
		// Reset BEFORE awaiting getContacts. The await is non-trivial under
		// load (full chrome.storage scan + cross-context RPC); resetting
		// after it raced with user typing — the input fires v-model writes
		// before the await resolves, and the post-await `form.reset()`
		// then wiped them. The form is freshly visible (popup just opened),
		// so an immediate reset is correct UX as well.
		form.reset()
		contacts.value = await contactService.getContacts()
	},
	onHide: () => {
		contactService.disconnect()

		contacts.value = []
		form.reset()
	},
})

watch(
	() => [nameTerm.value, contactAddressTerm.value],
	() => {
		processingError.value.show = false
	},
)
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_contact?.order"
		title="New contact"
		submitLabel="Add contact"
		:submitDisabled="!isAvailableToAddContact || processingError.show"
		:submitLoading="isLoading"
		submitTestId="new-contact-submit"
		@submit="handleAddContact"
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
			sanitize
			v-model="contactAddressTerm"
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
	</FormPopup>
</template>