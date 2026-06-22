<script setup>
/**
 * Recipient address input + autocomplete suggestion popover used by
 * `pages/send.vue`. The parent owns the contact + account lists and
 * passes them as `candidates`; this component handles the substring
 * filter, the focus / blur lifecycle (so the popover closes after a
 * short delay to allow the click), and the per-state right-icon.
 *
 * v-models:
 * - `searchTerm` — what the user typed (the address-like text in the
 *   field)
 * - `selectedContact` — the candidate object once they pick one
 */
import { trimAddress } from "@/utils/string"
import { isValidHex } from "@/utils/string"
import { useToast } from "@/composables/toast"

const props = defineProps({
	candidates: { type: Array, default: () => [] },
})

const searchTerm = defineModel("searchTerm", { type: String, default: "" })
const selectedContact = defineModel("selectedContact", { default: null })

const isSearchInputFocused = ref(false)
const justCleared = ref(false)

const { openToast } = useToast()

const filteredContacts = computed(() => {
	if (!searchTerm.value) return []
	const lowTerm = searchTerm.value?.toLowerCase() || ""
	return [...props.candidates].filter(
		(c) => c.name?.toLowerCase().includes(lowTerm) || c.address === searchTerm.value || c.abbr?.toLowerCase() === lowTerm,
	)
})

const showSuggestions = computed(() => filteredContacts.value?.length && isSearchInputFocused.value)
const isValidAddress = computed(() => isValidHex(searchTerm.value))

const handleSelectContact = (contact) => {
	selectedContact.value = contact
	searchTerm.value = contact.address
}

const handleChange = () => {
	selectedContact.value = null
	searchTerm.value = ""
	justCleared.value = true
	isSearchInputFocused.value = true
}

const onCopied = () => openToast({ label: "Address copied", icon: "copy" }, 2_000)

const handleSearchBlur = () => {
	if (searchTerm.value !== selectedContact.value?.address) {
		const contact = props.candidates.find((c) => c.address === searchTerm.value)
		if (contact) handleSelectContact(contact)
	}
	setTimeout(() => {
		isSearchInputFocused.value = false
	}, 250)
}

watch(
	() => searchTerm.value,
	(val) => {
		if (selectedContact.value && val !== selectedContact.value.address) {
			selectedContact.value = null
		}
	},
)

const onKeydown = (e) => {
	if (e.key === "Enter" && showSuggestions.value) {
		handleSelectContact(filteredContacts.value[0])
		document.activeElement?.blur()
	}
}

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
})
</script>

<template>
	<div :class="$style.recipient_section">
		<span :class="$style.section_label">Recipient Address</span>
		<div data-testid="send-destination-field" :class="$style.recipient_wrap">
			<RecipientCard
				v-if="selectedContact"
				:name="selectedContact.name"
				:address="selectedContact.address"
				@change="handleChange"
				@copied="onCopied"
			/>

			<template v-else>
				<AddressInput
					v-model="searchTerm"
					:autofocus="justCleared"
					@focus="isSearchInputFocused = true"
					@blur="handleSearchBlur()"
					placeholder="0x... or contact name"
				>
					<template #suffix>
						<Flex
							v-if="!isSearchInputFocused && !isValidAddress && searchTerm.length > 0"
							align="center"
							gap="6"
							:class="$style.input_right"
						>
							<Icon name="warning" size="12" color="primary" />
						</Flex>
						<Flex
							v-else-if="!isSearchInputFocused && isValidAddress"
							align="center"
							:class="$style.input_right"
						>
							<Icon name="check-circle" size="14" color="primary" />
						</Flex>
					</template>
				</AddressInput>

				<Transition name="fade">
					<Flex v-if="showSuggestions" align="center" direction="column" wide :class="$style.contacts_wrapper">
						<Flex
							v-for="c in filteredContacts"
							@click="handleSelectContact(c)"
							align="center"
							gap="10"
							:class="$style.contact"
							wide
						>
							<AccountAvatar :name="c.name" :address="c.address" :size="28" />

							<Flex direction="column" gap="4" wide>
								<Text size="14" weight="600" color="primary" :class="$style.title">{{ c.name }}</Text>
								<Text size="12" weight="500" color="tertiary" :class="$style.description">
									{{ trimAddress(c.address) }}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Transition>
			</template>
		</div>
	</div>
</template>

<style module>
.recipient_section {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-top: 8px;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.recipient_wrap {
	position: relative;
}

/* Restore the recipient field's monospace 14px style — Phase 5b's
 * migration to <Input> shifted it to body-font 15px; user-flagged. */
.recipient_wrap :global(input) {
	font-family: var(--font-mono);
	font-size: 14px;
}

.recipient_wrap :global(input::placeholder) {
	color: #363433;
}

.input_right {
	max-width: 50%;
	& span {
		max-width: 90%;
		min-width: 90%;

		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
}

.contacts_wrapper {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	z-index: 999;

	border: 2px solid var(--nulo-outline);
	background: var(--app-bg);

	max-height: 160px;

	overflow-y: auto;

	.contact {
		cursor: pointer;

		padding: 10px 14px;
		transition: all 0.2s var(--bezier);

		&:hover {
			background: var(--nulo-surface-low);
		}

		&:active {
			background: var(--nulo-surface-high);
		}

		.title {
			min-width: 100%;
			width: 0;

			line-height: 16px !important;

			text-overflow: ellipsis;
			overflow: hidden;
			white-space: nowrap;
		}

		.description {
			min-width: 100%;
			width: 0;

			line-height: 14px !important;

			text-overflow: ellipsis;
			overflow: hidden;
			white-space: nowrap;
		}
	}
}
</style>
