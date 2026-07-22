<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Utils */
import { getChainPosition } from "@/components/ui/utils"
import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const networks = computed(() =>
	[...appStore.networks].sort((a, b) => {
		const chainPos = getChainPosition(a.chainId) - getChainPosition(b.chainId)
		return chainPos ? chainPos : stringCompare(a.name, b.name)
	}),
)
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Manage Networks" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="16" :class="$style.content">
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
					<template #right>
						<Flex
							v-if="appStore.network?.id === network.id"
							align="center"
							gap="6"
							data-testid="network-active-badge"
						>
							<div :class="$style.active_dot" />
							<Text size="12" weight="600" color="primary">Active</Text>
						</Flex>
						<MaterialIcon name="chevron_right" :size="18" color="secondary" :class="$style.chevron" />
					</template>
				</SettingItem>
			</ItemsContainer>

			<Button @click="popupStore.open('new_network')" wide variant="primary" size="large" data-testid="network-new-btn">
				Add network
			</Button>
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

.chevron {
	color: var(--nulo-secondary);
	transition: color 0.2s var(--bezier);
}

.active_dot {
	width: 7px;
	height: 7px;
	flex: none;
	border-radius: 50%;
	background: var(--nulo-accent);
}
</style>
