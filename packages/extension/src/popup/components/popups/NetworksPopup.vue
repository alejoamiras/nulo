<script setup>
/** Services */
import { managers } from "@/utils/core"
import { getChainPosition } from "@/components/ui/utils"
import { stringCompare } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.networks?.order
})

const router = useRouter()
const networks = computed(() =>
	[...appStore.networks].sort((a, b) => {
		const chainPos = getChainPosition(a.chainId) - getChainPosition(b.chainId)

		return chainPos ? chainPos : stringCompare(a.name, b.name)
	}),
)
const handleSelectNetwork = async (target) => {
	if (appStore.network.id !== target.id) {
		await managers.network.setActiveNetwork(target.id)
		appStore.network = target
	}

	emit("onClose")
}

const handleManageNetworks = () => {
	router.push("/popup/settings/networks")
	emit("onClose")
}
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.networks?.order">
		<PopupCard :displaceIdx>
			<PopupHeader @onClose="emit('onClose')" closable>
				<template #title>
					<Text size="14" weight="600" color="primary">Switch network</Text>
				</template>
			</PopupHeader>

			<Flex wide direction="column" gap="24" :class="$style.wrapper" data-testid="networks-popup">
				<ItemsContainer>
					<SettingItem
						v-for="network in networks"
						@click="handleSelectNetwork(network)"
						:title="network.name"
						:icon="appStore.network.id === network.id ? 'check-circle' : 'circle'"
						:iconFillColor="appStore.network.id === network.id ? 'primary' : 'tertiary'"
						iconBgColor="transparent"
						data-testid="network-item"
						:data-network-name="network.name"
					>
					</SettingItem>
				</ItemsContainer>

				<ItemsContainer>
					<SettingItem
						@click="handleManageNetworks"
						title="Manage networks"
						size="small"
						icon="settings"
						iconFillColor="secondary"
						iconBgColor="transparent"
						chevron
					/>
				</ItemsContainer>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	flex: 1;

	padding: 0 20px 24px 20px;
}
</style>
