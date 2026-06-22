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
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
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
const accountStateService = new AccountStateServiceClient()
contactService.onContactAdded.add(onContactAdded)
contactService.onContactUpdated.add(onContactUpdated)
contactService.onContactDeleted.add(onContactDeleted)
accountStateService.onSenderAdded.add(onSenderAdded)
accountStateService.onSenderDeleted.add(onSenderDeleted)

function onSenderAdded(address) {
	if (!contactToEdit.value || address !== contactToEdit.value.address) return
	// Mirror the external change into the saved-state baseline. If the user
	// hadn't edited the toggle, also align the desired state so the popup
	// reflects reality. If they had edited, leave their intent intact —
	// the dirty check (`initialIsSender !== desiredIsSender`) now uses the
	// fresh truth and the Update button reflects accordingly.
	const wasInSync = initialIsSender.value === desiredIsSender.value
	initialIsSender.value = true
	if (wasInSync) desiredIsSender.value = true
}
function onSenderDeleted(address) {
	if (!contactToEdit.value || address !== contactToEdit.value.address) return
	const wasInSync = initialIsSender.value === desiredIsSender.value
	initialIsSender.value = false
	if (wasInSync) desiredIsSender.value = false
}

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

/** Sender registration is two-state-driven so it batches with the rest of
 *  the form. `initialIsSender` is what we read from PXE on open; the toggle
 *  is bound to `desiredIsSender`. The Update button stays in charge — flips
 *  here don't hit the SW until the user confirms. Reset Changes reverts
 *  desired back to initial alongside name + address.
 *
 *  The toggle binds to the SAVED address — editing the address field
 *  doesn't change the registration target. After saving a new address the
 *  popup closes; on re-open the toggle reflects whatever's registered for
 *  the now-saved address. */
const initialIsSender = ref(false)
const desiredIsSender = ref(false)
const isLoadingSenderState = ref(false)
const isStartedEditingSender = computed(() => initialIsSender.value !== desiredIsSender.value)

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
	// Validity gates always apply (so a sender-only toggle on an invalid
	// row still requires fixing the row first).
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
	desiredIsSender.value = initialIsSender.value
}

async function loadSenderState() {
	if (!contactToEdit.value || !appStore.network) {
		initialIsSender.value = false
		desiredIsSender.value = false
		// Critical: clear the loading flag on early-return too. The show-watcher's
		// `else` branch sets `isLoadingSenderState = true` SYNCHRONOUSLY before
		// awaiting getContacts (so the submit/toggle gates are honored from the
		// moment the popup opens). If we reach this guard without entering the
		// try/finally below, the gate stays armed and the popup wedges with
		// submit permanently disabled.
		isLoadingSenderState.value = false
		return
	}
	isLoadingSenderState.value = true
	try {
		const senders = await accountStateService.getSenders(appStore.network.id)
		const registered = senders.includes(contactToEdit.value.address)
		initialIsSender.value = registered
		desiredIsSender.value = registered
	} catch (err) {
		console.warn("Failed to load sender state:", err)
		initialIsSender.value = false
		desiredIsSender.value = false
	} finally {
		isLoadingSenderState.value = false
	}
}

/** Apply the sender-state delta in concert with the contact update.
 *  Handles the address-change case explicitly: when the saved address
 *  is replaced, we may need to register the NEW address and unregister
 *  the OLD one in the same submit. Operations execute in add-then-delete
 *  order so a partial failure leaves the user with the intended new
 *  registration (continuity-first; opus's preference). On full success
 *  the caller's toast says "updated"; on failure, the caller's toast
 *  surfaces the partial state.
 *
 *  Truth table (A = addressChanged, I = initialIsSender, D = desiredIsSender):
 *    0 0 0 → no-op
 *    0 0 1 → add(new)              (turn sender on, no addr change)
 *    0 1 0 → delete(old)           (turn sender off)
 *    0 1 1 → no-op (already registered)
 *    1 0 0 → no-op
 *    1 0 1 → add(new)              (new addr registered for the first time)
 *    1 1 0 → delete(old)           (drop old; new not registered)
 *    1 1 1 → add(new), delete(old) (migrate registration old → new)
 *
 *  Failures are non-fatal: the contact update has already succeeded by
 *  the time we get here; a sender failure shouldn't roll back the rest.
 *  Returns whether the registration succeeded so the caller can shape
 *  the success toast appropriately. */
async function applySenderDelta(oldAddress, newAddress) {
	if (!appStore.network) return true

	const addressChanged = oldAddress !== newAddress
	if (!addressChanged && !isStartedEditingSender.value) return true

	const networkId = appStore.network.id
	const shouldAddNew = desiredIsSender.value && (addressChanged || !initialIsSender.value)
	const shouldDeleteOld = initialIsSender.value && (addressChanged || !desiredIsSender.value)

	try {
		// Add-first-then-delete: on partial failure (add ok, delete fail) the
		// user has BOTH addresses registered (privacy leak surface, but the
		// intended new registration is preserved). The opposite order would
		// land in "neither registered" — silently lossy. Continuity wins.
		if (shouldAddNew) {
			await accountStateService.addSender(networkId, newAddress)
		}
		if (shouldDeleteOld) {
			await accountStateService.deleteSender(networkId, oldAddress)
		}
		return true
	} catch (err) {
		console.warn("Sender update failed:", err)
		// Revert the desired ref so the toggle reflects what the user
		// requested on the next render. Note: in the partial-failure case
		// (add ok, delete fail), the toggle revert lies about PXE state —
		// the caller's toast surfaces the partial state explicitly.
		desiredIsSender.value = initialIsSender.value
		return false
	}
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
			const contactDirty = isStartedEditingName.value || isStartedEditingAddress.value
			if (contactDirty) {
				await contactService.updateContact(contactToEdit.value.id, nameTerm.value.trim(), contactAddressTerm.value)
			}

			// Apply sender state for both the old AND new address. When the
			// address has changed, this migrates the registration (add new,
			// delete old) so we don't orphan the old address as a sender.
			const oldAddress = contactToEdit.value.address
			const newAddress = contactAddressTerm.value
			const senderApplied = await applySenderDelta(oldAddress, newAddress)
			const networkName = appStore.network?.name ?? "this network"

			emit("onClose")
			if (senderApplied) {
				openToast({ label: contactDirty ? "Contact is updated" : "Sender updated" })
			} else if (oldAddress !== newAddress) {
				openToast(
					{ label: `Contact updated · sender migration incomplete on ${networkName}`, icon: "warning" },
					TOAST_DURATION.LONG,
				)
			} else {
				openToast({ label: "Contact saved · sender update failed", icon: "warning" }, TOAST_DURATION.LONG)
			}
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
			accountStateService.disconnect()

			contactToEdit.value = null
			contacts.value = []

			form.reset()
			initialIsSender.value = false
			desiredIsSender.value = false

			document.removeEventListener("keydown", onKeydown)
		} else {
			// Mark the form as loading SYNCHRONOUSLY before any await. The
			// Toggle's @click handler short-circuits when `disabled` is true,
			// and the submit-gate respects `isLoadingSenderState`. Without an
			// up-front set, there is a window between popup mount and the
			// async loadSenderState() entry during which the toggle is
			// interactable AND `desiredIsSender` is at its default (false).
			// A click then flips the user-visible state, but loadSenderState's
			// `desiredIsSender = registered` later OVERWRITES that flip — so
			// applySenderDelta reads stale toggle state and runs the wrong
			// branch (e.g. the "drop-both" test 4 ended up with shouldAddNew=
			// true because desiredIsSender was reset back to true).
			isLoadingSenderState.value = true
			contacts.value = await contactService.getContacts()
			contactToEdit.value = cacheStore.importContact
				? cacheStore.importContact
				: contacts.value.find((c) => c.id === cacheStore.contactToEditIdx)
			nameTerm.value = contactToEdit.value?.name ?? ""
			contactAddressTerm.value = contactToEdit.value?.address ?? ""

			// Imports flow through this popup with `cacheStore.importContact`
			// set; sender-registration is irrelevant there because the contact
			// hasn't been saved yet. Skip the sender row in that case.
			if (!cacheStore.importContact) {
				await loadSenderState()
			} else {
				isLoadingSenderState.value = false
			}

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
			isLoadingSenderState ||
			!(isStartedEditingName || isStartedEditingAddress || isStartedEditingSender)
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

		<Flex
			v-if="!cacheStore.importContact"
			align="center"
			justify="between"
			gap="12"
			:class="$style.sender_row"
		>
			<Flex direction="column" gap="2" :class="$style.sender_text">
				<Text size="13" weight="600" color="primary">Register as sender</Text>
				<Text size="11" weight="500" color="tertiary" height="140">
					Lets your wallet check for incoming private transfers from this address.
				</Text>
			</Flex>
			<Toggle
				v-model="desiredIsSender"
				:disabled="isLoadingSenderState"
				data-testid="edit-contact-sender-toggle"
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

		<template #belowSubmit>
			<Button @click="handleFillFieldsWithDefaultValues" wide variant="primary_outline" size="medium">
				Reset changes
			</Button>
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
