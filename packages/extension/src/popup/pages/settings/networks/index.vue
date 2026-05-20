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

/** Router */
const router = useRouter()

const networks = computed(() =>
	[...appStore.networks].sort((a, b) => {
		const chainPos = getChainPosition(a.chainId) - getChainPosition(b.chainId)
		return chainPos ? chainPos : stringCompare(a.name, b.name)
	}),
)

/**
 * Tapping a row drills into the per-`Network` detail page where rename,
 * endpoints, set-as-active, and delete-chain live. The radio icon on each
 * row reflects whether the row is the active chain — it is informational;
 * activation happens on the detail page.
 */
const handleOpenDetail = (target) => {
	router.push(`/popup/settings/networks/${target.id}`)
}
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Manage Networks" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="16" :class="$style.content">
			<SectionLabel label="Networks" :count="networks.length" />

			<ItemsContainer>
				<SettingItem
					v-for="network in networks"
					@click="handleOpenDetail(network)"
					:title="network.name"
					:icon="appStore.network?.id === network.id ? 'check-circle' : 'circle'"
					:iconFillColor="appStore.network?.id === network.id ? 'primary' : 'tertiary'"
					iconBgColor="transparent"
					data-testid="network-row"
					:data-network-id="network.id"
					:data-network-name="network.name"
				>
					<template #right>
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
</style>
