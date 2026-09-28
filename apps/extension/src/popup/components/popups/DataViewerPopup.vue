<!-- Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0. -->
<script setup>
/** Composables */
import { vSnackFooter } from "@/composables/snackInset"

/** Store */
import { usePopupStore } from "@/stores/popup.store.ts"
import { useCacheStore } from "@/stores/cache.store.ts"
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.data_viewer?.order
})

const data = computed(() => cacheStore.viewerData)

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			cacheStore.viewerData = null
		}
	},
)
</script>

<template>
	<Popup :show="show" @onClose="emit('onClose')" :displaceIdx="popupStore.popups.data_viewer?.order">
		<PopupCard :displaceIdx>
			<Flex wide align="center" direction="column" gap="24" :class="$style.wrapper">
				<JsonViewer :data="data" />

				<Button v-snack-footer @click="emit('onClose')" variant="primary_outline" size="medium" wide>Close</Button>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
</style>
