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
import AuthwitCard from "@/popup/components/modules/settings/authwits/AuthwitCard.vue"

/** Services */
import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"

/** Composables */
import { useToast } from "@/composables/toast.js"
import { useEntityCrud } from "@/composables/useEntityCrud"

/** Helpers */
import { authwitMatchesSearch, decorateAuthwit, sortAuthwits } from "@/popup/components/modules/settings/authwits/authwit-helpers"

const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const isRegistryEnabled = ref(true)
const isFetchingRegistryStatus = ref(false)
const searchTerm = ref("")

const authwitsService = new AuthRegistryServiceClient()

const {
	entities: authwits,
	isLoading: isFetchingAuthwits,
	error,
	refresh: refreshAuthwits,
} = useEntityCrud({
	fetch: async () => {
		const list = await authwitsService.getAuthwits(appStore.account.address)
		return list?.map(decorateAuthwit) ?? []
	},
	added: authwitsService.onAuthwitAdded,
	deleted: authwitsService.onAuthwitDeleted,
	identity: (aw) => aw.id,
})

const filteredAuthwits = computed(() => {
	const sorted = sortAuthwits(authwits.value)
	const term = searchTerm.value.trim()
	if (!term) return sorted
	return sorted.filter((aw) => authwitMatchesSearch(aw, term))
})

const isErrorOccurred = computed(() => !!error.value)

function onRegistryEnabled(account) {
	if (appStore.account?.address === account) isRegistryEnabled.value = true
}
function onRegistryDisabled(account) {
	if (appStore.account?.address === account) isRegistryEnabled.value = false
}
authwitsService.onRegistryEnabled.add(onRegistryEnabled)
authwitsService.onRegistryDisabled.add(onRegistryDisabled)

async function fetchRegistryStatus() {
	isFetchingRegistryStatus.value = true
	try {
		isRegistryEnabled.value = await authwitsService.getRegistryEnabled(appStore.account.address)
	} catch {
		// surfaced via the entity-crud error ref already
	} finally {
		isFetchingRegistryStatus.value = false
	}
}

function handleRefetch() {
	openToast({ label: "Fetching authwits again", icon: "zap" })
	refreshAuthwits()
}

function changeAuthwitsRegistry() {
	popupStore.open("change_authwits_registry")
}

function revokeAuthwits(aw) {
	cacheStore.preselectedAuthwits = aw ? [aw] : authwits.value
	popupStore.open("revoke_authwits")
}

const handleOpenAuthwit = (aw) => {
	cacheStore.viewerData = aw.content
	popupStore.open("data_viewer")
}

watch(
	() => appStore.account,
	() => {
		refreshAuthwits()
		fetchRegistryStatus()
	},
)

onMounted(async () => {
	if (appStore.account && appStore.isLogined) {
		await fetchRegistryStatus()
	}
})

onBeforeUnmount(() => {
	authwitsService.onRegistryEnabled.remove(onRegistryEnabled)
	authwitsService.onRegistryDisabled.remove(onRegistryDisabled)
	authwitsService.disconnect()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<SubPageHeader title="Authwits" :backTo="'/popup/settings/advanced/account-state'">
			<template #trailing>
				<Dropdown>
					<button type="button" data-testid="authwits-actions-btn" :class="$style.icon_btn" aria-label="Authwit actions">
						<MaterialIcon name="settings" :size="18" color="secondary" />
					</button>

					<template #popup>
						<DropdownItem data-testid="authwits-toggle-registry" @click="changeAuthwitsRegistry">
							<Flex align="center" gap="8">
								<Icon name="lock" size="14" color="secondary" />
								{{ `${isRegistryEnabled ? "Disable" : "Enable"} authwits registry` }}
							</Flex>
						</DropdownItem>
						<DropdownItem data-testid="authwits-revoke-all" @click="revokeAuthwits()" :disabled="!authwits.length">
							<Flex align="center" gap="8">
								<Icon name="close-circle" size="14" color="secondary" />
								Revoke all authwits
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</template>
		</SubPageHeader>

		<Flex direction="column" gap="16" wide :class="$style.content">
			<Flex v-if="!isRegistryEnabled" align="center" justify="center" gap="6" wide :class="$style.warning">
				<Icon name="warning" color="orange" size="14" />
				<Text size="13" color="secondary">
					Account authwits registry
					<Text size="13" color="orange"> disabled</Text>
				</Text>
			</Flex>
			<Input
				v-if="authwits.length"
				v-model="searchTerm"
				icon="search"
				placeholder="Search by kind, address or function"
				clearable
				@clear="searchTerm = ''"
			/>

			<LoadingState v-if="isFetchingAuthwits" label="FETCHING AUTHWITS" />

			<Tooltip v-else-if="isErrorOccurred" wide>
				<Banner :action="{ name: 'Try again', callback: handleRefetch }" variant="error" wide>
					Something went wrong
				</Banner>
				<template #content>{{ error }}</template>
			</Tooltip>

			<Flex v-else-if="filteredAuthwits.length" direction="column" gap="8">
				<AuthwitCard
					v-for="aw in filteredAuthwits"
					:key="aw.id"
					:authwit="aw"
					@open="handleOpenAuthwit"
					@revoke="revokeAuthwits"
				/>
			</Flex>

			<div v-else-if="filteredAuthwits.length === 0 && searchTerm" :class="$style.no_results">
				NO MATCHES · TRY A DIFFERENT TERM
			</div>

			<div v-else :class="$style.empty">
				<span :class="$style.empty_headline">NO AUTHWITS YET</span>
				<span :class="$style.empty_sub">Approved authorizations you grant will appear here.</span>
			</div>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
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
		background: rgba(248, 241, 231, 0.08);
	}
}

.warning {
	padding: 4px;
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
	width: 100%;

	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
	overflow-wrap: break-word;
}

.no_results {
	padding: 24px 16px;
	text-align: center;

	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--nulo-outline);
}
</style>
