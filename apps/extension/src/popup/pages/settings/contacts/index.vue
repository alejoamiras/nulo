<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
import { Dropdown } from "@/components/ui/Dropdown"
import ContactRow from "@/popup/components/modules/settings/contacts/ContactRow.vue"

/** Services */
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
import { ContactServiceClient } from "@/wallet/services/contact/client"

/** Utils */
import { stringCompare } from "@/utils"

/** Composables */
import { useToast } from "@/composables/toast"
import { useEntityCrud } from "@/composables/useEntityCrud"
import { useContactImportExport } from "@/popup/components/modules/settings/contacts/useContactImportExport"

const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const router = useRouter()

const contactService = new ContactServiceClient()
const accountStateService = new AccountStateServiceClient()

// Resync mode: any contact event triggers a full re-fetch with a seq guard.
// Guarantees the UI stays consistent with storage (e.g. when imports mutate
// many rows at once).
const { entities: contacts } = useEntityCrud({
	fetch: () => contactService.getContacts(),
	added: contactService.onContactAdded,
	updated: contactService.onContactUpdated,
	deleted: contactService.onContactDeleted,
	mode: "resync",
})

const sortedContacts = computed(() =>
	[...contacts.value].sort((a, b) => {
		const abbrPos = stringCompare(a.abbr, b.abbr)
		return abbrPos ? abbrPos : stringCompare(a.name, b.name)
	}),
)

/** Senders for the active network. The contacts list shows a small chip
 *  on each row that's been registered as a private-transfer sender so the
 *  user can scan registration status at a glance without opening Edit.
 *  Network-scoped: switching networks reloads the set. */
const senderAddresses = ref(new Set())
function isContactSender(address) {
	return senderAddresses.value.has(address)
}
async function syncSenders() {
	if (!appStore.network) {
		senderAddresses.value = new Set()
		return
	}
	try {
		const list = await accountStateService.getSenders(appStore.network.id)
		senderAddresses.value = new Set(list)
	} catch (err) {
		console.warn("Failed to load senders for contacts list:", err)
		senderAddresses.value = new Set()
	}
}
function onSenderAdded(address) {
	const next = new Set(senderAddresses.value)
	next.add(address)
	senderAddresses.value = next
}
function onSenderDeleted(address) {
	const next = new Set(senderAddresses.value)
	next.delete(address)
	senderAddresses.value = next
}
accountStateService.onSenderAdded.add(onSenderAdded)
accountStateService.onSenderDeleted.add(onSenderDeleted)
watch(() => appStore.network?.id, syncSenders)

const { exportContacts, importContacts } = useContactImportExport({
	contacts,
	contactService,
	accountStateService,
})

function handleClickContact(contact) {
	cacheStore.preselectedContactToSend = contact
	router.push("/popup/send")
}
const handleCopyContactAddress = (contact) => {
	window.navigator.clipboard.writeText(contact.address)
	openToast({ label: "Address is copied", icon: "copy" })
}
function handleEditContact(contact) {
	cacheStore.contactToEditIdx = contact.id
	popupStore.open("edit_contact")
}
function handleDeleteContact(contact) {
	// Deleting a contact never touches sender registration — sender rows are
	// independent PXE state, managed only in Settings → Advanced → Senders.
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, delete contact"
	cacheStore.confirm.description = `Delete contact "${contact.name}"?`
	cacheStore.confirm.callback = async () => {
		await contactService.deleteContact(contact.id)
		openToast({ label: "Contact deleted" })
	}
	popupStore.open("confirm")
}

onMounted(async () => {
	await syncSenders()
})

onBeforeUnmount(() => {
	contactService.disconnect()
	accountStateService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Contacts" :backTo="'/popup/settings'">
			<template #trailing>
				<Dropdown>
					<button type="button" :class="$style.icon_btn" aria-label="Contact actions">
						<MaterialIcon name="more_vert" :size="18" color="secondary" />
					</button>

					<template #popup>
						<DropdownItem @click="importContacts">
							<Flex align="center" gap="8">
								<Icon name="upload-outline" size="14" color="secondary" />
								Import contacts
							</Flex>
						</DropdownItem>
						<DropdownItem @click="exportContacts" :disabled="!contacts.length">
							<Flex align="center" gap="8">
								<Icon name="download-outline" size="14" color="secondary" />
								Export contacts
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</template>
		</SubPageHeader>

		<Flex direction="column" gap="12" :class="$style.content">
			<SectionLabel label="Contacts" :count="sortedContacts.length" />

			<ItemsContainer v-if="sortedContacts.length">
				<ContactRow
					v-for="c in sortedContacts"
					:key="c.id"
					:contact="c"
					:isSender="isContactSender(c.address)"
					@select="handleClickContact"
					@copy="handleCopyContactAddress"
					@edit="handleEditContact"
					@delete="handleDeleteContact"
				/>
			</ItemsContainer>

			<div v-else :class="$style.empty" data-testid="contacts-empty">
				<span :class="$style.empty_headline">NO CONTACTS YET</span>
				<span :class="$style.empty_sub">Save the people you send to or receive from often.</span>
			</div>

			<Button
				@click="popupStore.open('new_contact')"
				wide
				variant="primary"
				size="large"
				data-testid="contacts-new-btn"
			>
				Add contact
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
}

.icon_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 32px;
	height: 32px;

	background: transparent;
	border: none;
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-accent) 8%, transparent);
	}
}
</style>
