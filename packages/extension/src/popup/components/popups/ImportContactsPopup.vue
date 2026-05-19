<script setup>
/** Utils */
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { isValidHex } from "@/utils/string"

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

const emit = defineEmits(["onClose"])

const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.import_contacts?.order
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
const importContacts = ref([])
const contactsByName = ref(null)
const contactsByAddress = ref(null)

/** True when at least one selected staged contact came in with
 *  `isSender: true`. Drives the active-network banner — we only
 *  surface it when the user's choice would actually trigger
 *  registerSender calls. */
const hasIncomingSenders = computed(() => importContacts.value.some((c) => c?.isSender && c?.selected))

function handleSelectContact(contact) {
	if (contact.isInvalidAddress) {
		openToast({ label: "To select, correct the address first", icon: "info" })

		return
	}

	contact.selected = !contact.selected
}
function handleEditContact(contact) {
	cacheStore.importContact = contact

	popupStore.open("edit_contact")
}
function handleResolve() {
	cacheStore.importPromise?.resolve(importContacts.value.filter((c) => c.selected))
	emit("onClose")
}
function handleReject() {
	cacheStore.importPromise?.reject(false)
	emit("onClose")
}

watch(
	() => cacheStore.importContact,
	() => {
		if (cacheStore.importContact?.idx && cacheStore.importContact?.updated) {
			importContacts.value[cacheStore.importContact.idx] = {
				...cacheStore.importContact,
				duplicateName: !!contactsByName.value.get(cacheStore.importContact.name),
				duplicateAddress: !!contactsByAddress.value.get(cacheStore.importContact.address),
				isInvalidAddress: false,
				selected: true,
			}
		}
	},
)
watch(
	() => props.show,
	async () => {
		if (props.show) {
			contacts.value = await contactService.getContacts()
			contactsByName.value = new Map()
			contactsByAddress.value = new Map()

			importContacts.value = cacheStore.importContacts

			for (const _c of contacts.value) {
				contactsByName.value.set(_c.name, _c)
				contactsByAddress.value.set(_c.address, _c)
			}

			for (const idx in importContacts.value) {
				const _c = importContacts.value[idx]
				const _cbn = contactsByName.value.get(_c.name)
				const _cba = contactsByAddress.value.get(_c.address)

				importContacts.value[idx] = {
					..._c,
					idx,
					duplicateName: !!_cbn,
					duplicateAddress: !!_cba,
					isInvalidAddress: !isValidHex(_c.address),
					selected: isValidHex(_c.address) && !(!!_cbn && !!_cba),
					isImporting: true,
				}
			}
		} else {
			cacheStore.importPromise?.reject(false)
			cacheStore.importContact = null
			cacheStore.importContacts = []

			contactService.disconnect()

			contactsByName.value = null
			contactsByAddress.value = null
		}
	},
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx=popupStore.popups.import_contacts?.order>
		<PopupCard :displaceIdx>
			<Flex
				direction="column"
				wide
				:class="$style.wrapper"
			>
				<Flex align="center" direction="column" gap="12" wide :class="$style.section_wrapper">
					<Flex align="center" direction="column" gap="12">
						<Flex direction="column" align="center" gap="12">
							<Text size="16" weight="600" color="primary">
								Import contacts
							</Text>
						</Flex>

						<Text size="14" weight="500" color="body" height="140" align="center">
							Contacts with already
							<Text color="primary" weight="700">existing</Text>
							names or addresses will be replaced, contacts with
							<Text color="primary" weight="700">invalid</Text>
							addresses will not be imported.
						</Text>

						<!-- Active-network banner. Only shown when at least one
						     selected import will trigger registerSender on confirm. -->
						<Text v-if="hasIncomingSenders" size="12" weight="600" color="secondary" align="center">
							Senders will be registered on
							<Text color="primary" weight="700">{{ appStore.network?.name ?? "no active network" }}</Text>.
						</Text>
					</Flex>

					<Flex direction="column" gap="6" wide :class="$style.contacts_section">
						<Flex
							v-for="c in importContacts"
							@click="handleSelectContact(c)"
							align="center"
							justify="between"
							:class="[$style.contact, c.isInvalidAddress && $style.contact_invalid]"
							wide
						>
							<Flex align="center" gap="10" wide>
								<Icon
									:name="
										c.selected
											? 'check-circle'
											: 'circle'
									"
									size="16"
									:color="c.selected ? 'primary' : 'tertiary'"
								/>

								<Flex direction="column" gap="4" wide>
									<Flex align="center" gap="6" wide>
										<Text size="14" weight="600" color="primary" :class="$style.title">
											{{ c.name }}
										</Text>
										<Text v-if="c.duplicateName" size="10" weight="600" color="tertiary" :class="$style.tag">existing</Text>
									</Flex>

									<Flex align="center" gap="6">
										<Text size="13" weight="600" color="tertiary">{{ trimAddress(c.address) }}</Text>
										<Text v-if="c.isInvalidAddress" size="10" weight="600" color="tertiary" :class="$style.tag">invalid</Text>
										<Text v-else-if="c.duplicateAddress" size="10" weight="600" color="tertiary" :class="$style.tag">existing</Text>
										<Text v-if="c.isSender" size="10" weight="600" color="tertiary" :class="$style.tag">sender</Text>
									</Flex>
								</Flex>
							</Flex>

							<Flex align="center">
								<Icon
									@click.stop="handleEditContact(c)"
									name="edit"
									size="14"
									color="tertiary"
									:class="$style.icon_btn"
								/>
							</Flex>
						</Flex>
					</Flex>

					<Flex align="center" justify="between" gap="12" wide>
						<Button
							@click="handleReject"
							variant="primary_outline"
							size="medium"
							wide
						>
							Cancel
						</Button>

						<Button
							@click="handleResolve"
							variant="primary"
							size="medium"
							wide
						>
							Import selected
						</Button>
					</Flex>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	flex: 1;

	min-height: 0;

	padding: 0 20px 24px 20px;
}

.section_wrapper {
	flex: 1;

	min-height: 0;
}

.contacts_section {
	flex: 1;

	min-height: 0;

	overflow: auto;
}

.contact {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border: 1px solid var(--nulo-outline);
		& .icons {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.contact_invalid {
	opacity: 0.5;
}

.tag {
	font-family: var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	padding: 1px 4px;
	border: 1px solid var(--nulo-border);
}

.title {
	min-width: 100%;
	width: 0;

	line-height: 16px !important;

	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
}

.icon_btn {
	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}
</style>