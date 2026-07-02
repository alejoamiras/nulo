<script setup>
/** Utils */
import { isValidHex } from "@/utils/string"

/** Services */
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.new_contact?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const contactService = new ContactServiceClient()
const accountStateService = new AccountStateServiceClient()
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

/** Default-on for `registerAsSender` per plan-v4: a freshly-added
 *  individual contact is the intentional opt-in moment. User can untick
 *  to skip sender registration. */
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
			if (contacts.value.some((c) => c.address === v)) return "Already exist"
			return null
		},
	},
	registerAsSender: { initial: true },
})

// Aliases preserve the existing template bindings (v-model="nameTerm" etc.).
const nameTerm = form.fields.name.value
const contactAddressTerm = form.fields.address.value
const registerAsSender = form.fields.registerAsSender.value

// Existing template uses these inline-warning predicates. Map to the form's
// error messages so the visual contract is unchanged.
const isAlreadyExistName = computed(() => form.fields.name.error.value === "Already exist")
const isValidAddress = computed(() => isValidHex(contactAddressTerm.value))
const isAlreadyExistAddress = computed(() => form.fields.address.error.value === "Already exist")

const isAvailableToAddContact = computed(() => {
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
		const address = contactAddressTerm.value
		await contactService.addContact(nameTerm.value.trim(), address)

		// Sender registration is non-fatal: contact saves successfully even
		// if PXE is down. The toast distinguishes the two outcomes so the
		// user knows whether to retry from Settings → Senders. Privacy
		// rationale: registering a sender broadens the dApp-observable
		// graph via `aztec_getPrivateEvents`, so this is opt-in, not
		// silent.
		//
		// Only attempt sender registration when both network AND account are
		// loaded (network watcher's auto-create can be in-flight on freshly
		// switched chains; addSender then writes against an unintended PXE
		// scope and the chip never renders).
		let senderRegistered = false
		if (registerAsSender.value && appStore.network && appStore.account?.address) {
			try {
				await accountStateService.addSender(appStore.network.id, address)
				senderRegistered = true
			} catch (err) {
				console.warn("Sender registration failed after contact add:", err)
			}
		}

		emit("onClose")
		if (registerAsSender.value && !senderRegistered) {
			openToast({ label: "Contact saved · sender registration failed", icon: "warning" }, TOAST_DURATION.LONG)
		} else {
			openToast({ label: "Contact is added" })
		}
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

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			contactService.disconnect()
			accountStateService.disconnect()

			contacts.value = []
			form.reset()

			document.removeEventListener("keydown", onKeydown)
		} else {
			// Reset BEFORE awaiting getContacts. The await is non-trivial under
			// load (full chrome.storage scan + cross-context RPC); resetting
			// after it raced with user typing — the input fires v-model writes
			// before the await resolves, and the post-await `form.reset()`
			// then wiped them. The form is freshly visible (popup just opened),
			// so an immediate reset is correct UX as well.
			form.reset()
			document.addEventListener("keydown", onKeydown)
			contacts.value = await contactService.getContacts()
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
	// Only fire on input/textarea fields. Without this guard, pressing
	// Enter while focused on the Add button would double-fire: the button's
	// native Enter→click activation already calls handleAddContact via
	// FormPopup's @submit; the keydown listener would call it a second time.
	// (The same shape pre-migration without FormPopup; the guard is correct
	// either way.)
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleAddContact()
}
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

		<Flex
			align="center"
			justify="between"
			gap="12"
			:class="$style.sender_row"
		>
			<Flex direction="column" gap="2" :class="$style.sender_text">
				<Text size="13" weight="600" color="primary">Register as sender</Text>
				<Text size="11" weight="500" color="tertiary" height="140">
					Lets your wallet detect incoming private transfers from this address.
				</Text>
			</Flex>
			<Toggle
				v-model="registerAsSender"
				data-testid="new-contact-register-sender"
			/>
		</Flex>

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

<style module>
.sender_row {
	margin-top: -12px;
	padding: 12px 0;
}

.sender_text {
	min-width: 0;
	flex: 1;
}
</style>
