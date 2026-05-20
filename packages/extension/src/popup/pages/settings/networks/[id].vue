<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Utils */
import { managers } from "@/utils/core"

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

/** Router */
const route = useRoute()
const router = useRouter()

const networkId = computed(() => route.params.id)
const network = computed(() => appStore.networks.find((n) => n.id === networkId.value))
const isActive = computed(() => appStore.network?.id === networkId.value)
const canDelete = computed(() => !isActive.value && appStore.networks.length > 1)

async function refreshNetworks() {
	appStore.networks = await managers.network.getNetworks()
	if (isActive.value) {
		const n = appStore.networks.find((x) => x.id === networkId.value)
		if (n) appStore.network = n
	}
}

const handleEditNetworkName = () => {
	cacheStore.networkToEditIdx = networkId.value
	popupStore.open("edit_network")
}

const handleSetActive = async () => {
	if (!network.value) return
	if (isActive.value) return
	try {
		await managers.network.setActiveNetwork(network.value.id)
		appStore.network = network.value
		openToast({ label: "Active network updated", icon: "check-circle" })
	} catch {
		openToast({ label: "Failed to switch network", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
	}
}

const handleAddEndpoint = () => {
	cacheStore.endpointEditNetworkId = networkId.value
	cacheStore.endpointEditId = null
	popupStore.open("new_endpoint")
}

const handleEditEndpoint = (endpoint) => {
	cacheStore.endpointEditNetworkId = networkId.value
	cacheStore.endpointEditId = endpoint.id
	popupStore.open("edit_endpoint")
}

const handleSetPrimary = async (endpoint) => {
	if (!network.value) return
	if (network.value.primaryEndpointId === endpoint.id) return
	try {
		await managers.network.setPrimaryEndpoint(network.value.id, endpoint.id)
		await refreshNetworks()
		openToast({ label: "Primary endpoint updated" })
	} catch {
		openToast({ label: "Failed to update primary endpoint", icon: "warning" }, TOAST_DURATION.LONG)
	}
}

const handleDeleteEndpoint = (endpoint) => {
	if (!network.value) return
	if (network.value.primaryEndpointId === endpoint.id) return
	if (network.value.endpoints.length === 1) return

	cacheStore.confirm.confirm_text = "Yes, delete endpoint"
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.title = "Delete this endpoint?"
	cacheStore.confirm.description = `This RPC URL will be removed from ${network.value.name}. The chain itself stays.`
	cacheStore.confirm.callback = async () => {
		try {
			await managers.network.deleteEndpoint(network.value.id, endpoint.id)
			await refreshNetworks()
			openToast({ label: "Endpoint deleted" })
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			if (msg.includes("PRIMARY_ENDPOINT")) {
				openToast({ label: "Make another endpoint primary first.", icon: "warning" }, TOAST_DURATION.LONG)
			} else if (msg.includes("LAST_ENDPOINT")) {
				openToast({ label: "Last endpoint — delete the chain instead.", icon: "warning" }, TOAST_DURATION.LONG)
			} else {
				openToast({ label: "Failed to delete endpoint", icon: "warning" }, TOAST_DURATION.LONG)
			}
		}
	}
	popupStore.open("confirm")
}

const handleDeleteNetwork = () => {
	if (!network.value) return
	if (!canDelete.value) return
	cacheStore.confirm.confirm_text = "Yes, delete chain"
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.title = `Delete ${network.value.name}?`
	cacheStore.confirm.description = "This wipes accounts, balances, tokens, and PXE state on this chain. This cannot be undone."
	cacheStore.confirm.callback = async () => {
		const target = network.value
		try {
			await appStore.removeNetwork(target)
			openToast({ label: "Chain deleted" })
			router.replace("/popup/settings/networks")
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			if (msg.startsWith("ACTIVE_NETWORK")) {
				openToast({ label: "Switch to another chain before deleting this one.", icon: "warning" }, TOAST_DURATION.LONG)
			} else {
				openToast({ label: "Failed to delete chain", icon: "warning" }, TOAST_DURATION.LONG)
			}
		}
	}
	popupStore.open("confirm")
}

// If the network row disappears (deleted from elsewhere), redirect back to the list.
watch(network, (n) => {
	if (!n) router.replace("/popup/settings/networks")
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper" v-if="network">
		<SubPageHeader :title="network.name" :backTo="'/popup/settings/networks'" />

		<Flex direction="column" gap="24" :class="$style.content">
			<!-- Network info -->
			<Flex direction="column" gap="12">
				<SectionLabel label="Chain" />
				<ItemsContainer>
					<SettingItem
						size="small"
						:title="isActive ? 'Active network' : 'Set as active network'"
						:description="isActive ? 'Currently in use' : 'Switch the wallet to this chain'"
						:icon="isActive ? 'check-circle' : 'circle'"
						:iconFillColor="isActive ? 'primary' : 'tertiary'"
						iconBgColor="transparent"
						:disabled="isActive"
						@click="handleSetActive"
						data-testid="network-set-active"
					/>
					<SettingItem
						size="small"
						title="Name"
						:description="network.name"
						icon="edit"
						iconFillColor="tertiary"
						iconBgColor="transparent"
						@click="handleEditNetworkName"
						data-testid="network-detail-rename"
					/>
					<SettingItem
						size="small"
						title="Chain ID"
						:description="String(network.chainId)"
						icon="info"
						iconFillColor="tertiary"
						iconBgColor="transparent"
						raw
					/>
				</ItemsContainer>
			</Flex>

			<!-- Endpoints -->
			<Flex direction="column" gap="12">
				<SectionLabel label="Endpoints" :count="network.endpoints.length" />
				<ItemsContainer>
					<SettingItem
						v-for="endpoint in network.endpoints"
						:key="endpoint.id"
						:title="endpoint.label || endpoint.rpcUrl"
						:description="endpoint.label ? endpoint.rpcUrl : undefined"
						:icon="network.primaryEndpointId === endpoint.id ? 'check-circle' : 'circle'"
						:iconFillColor="network.primaryEndpointId === endpoint.id ? 'primary' : 'tertiary'"
						iconBgColor="transparent"
						@click="handleSetPrimary(endpoint)"
						data-testid="endpoint-row"
						:data-endpoint-id="endpoint.id"
					>
						<template #right>
							<Flex align="center" gap="8">
								<Tooltip position="end" delay="350">
									<Icon
										@click.stop="handleEditEndpoint(endpoint)"
										name="edit"
										size="14"
										color="tertiary"
										:class="$style.icon_btn"
										data-testid="endpoint-edit-btn"
									/>
									<template #content>Edit endpoint</template>
								</Tooltip>
								<Tooltip
									position="end"
									delay="350"
									v-if="network.primaryEndpointId !== endpoint.id && network.endpoints.length > 1"
								>
									<Icon
										@click.stop="handleDeleteEndpoint(endpoint)"
										name="close-circle"
										size="14"
										color="tertiary"
										:class="$style.icon_btn"
										data-testid="endpoint-delete-btn"
									/>
									<template #content>Delete endpoint</template>
								</Tooltip>
							</Flex>
						</template>
					</SettingItem>
				</ItemsContainer>

				<Button
					@click="handleAddEndpoint"
					wide
					variant="primary_outline"
					size="medium"
					data-testid="endpoint-add-btn"
				>
					Add endpoint
				</Button>
			</Flex>

			<!-- Danger zone -->
			<Flex direction="column" gap="12" v-if="canDelete">
				<SectionLabel label="Danger zone" />
				<Button
					@click="handleDeleteNetwork"
					wide
					variant="primary_outline"
					size="medium"
					data-testid="network-delete-chain-btn"
				>
					Delete chain
				</Button>
				<Text size="11" weight="500" color="tertiary" height="140">
					Deleting wipes all accounts, balances, tokens and PXE state for this chain.
				</Text>
			</Flex>
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
	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}
</style>
