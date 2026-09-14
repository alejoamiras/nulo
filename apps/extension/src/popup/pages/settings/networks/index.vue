<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Services */
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Utils */
import { getChainPosition } from "@/components/ui/utils"
import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

// Custom chains are a developer surface: "Add network" is offered only under Developer Mode.
// Endpoints on the built-in networks, and rows that already exist, stay manageable for everyone.
const isDeveloperModeEnabled = ref(false)
const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)
function onSettingUpdate(setting) {
	if (setting.key === "developerMode") isDeveloperModeEnabled.value = setting.value === true
}

const networks = computed(() =>
	[...appStore.networks].sort((a, b) => {
		const chainPos = getChainPosition(a.chainId) - getChainPosition(b.chainId)
		return chainPos ? chainPos : stringCompare(a.name, b.name)
	}),
)

onBeforeMount(async () => {
	isDeveloperModeEnabled.value = (await configService.getValue("developerMode")) === true
})

onBeforeUnmount(() => {
	configService.disconnect()
})
</script>

<template>
	<SettingsPageShell title="Manage Networks" :backTo="'/popup/settings'" gap="16">
		<SectionLabel label="Networks" :count="networks.length" />

		<ItemsContainer>
			<SettingItem
				v-for="network in networks"
				:key="network.id"
				:to="`/popup/settings/networks/${network.id}`"
				:title="network.name"
				data-testid="network-row"
				:data-network-id="network.id"
				:data-network-name="network.name"
			>
				<template #dot>
					<div v-if="appStore.network?.id === network.id" :class="$style.active_dot" data-testid="network-active-dot" />
				</template>
				<template #right>
					<Flex align="center" gap="8">
						<Badge v-if="appStore.network?.id === network.id" variant="info" data-testid="network-active-badge">Active</Badge>
						<MaterialIcon name="chevron_right" :size="18" color="secondary" :class="$style.chevron" />
					</Flex>
				</template>
			</SettingItem>
		</ItemsContainer>

		<Button
			v-if="isDeveloperModeEnabled"
			@click="popupStore.open('new_network')"
			wide
			variant="primary"
			size="large"
			data-testid="network-new-btn"
		>
			Add network
		</Button>
	</SettingsPageShell>
</template>

<style module>
.icon_btn {
	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}

.chevron {
	color: var(--nulo-secondary);
	transition: color 0.2s var(--bezier);
}

.active_dot {
	/* --green is Nulo's "active/live" status color (mirrors DappStatusStrip's ready dot). */
	width: 7px;
	height: 7px;
	flex: none;
	border-radius: 50%;
	background: var(--green);
}
</style>
