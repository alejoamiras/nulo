<script setup>
/** Store */
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const router = useRouter()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.forgot_password?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const handleReset = () => {
	popupStore.closeAll()
	router.push("/popup/settings/security/reset")
}
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.forgot_password?.order">
		<PopupCard :displaceIdx>
			<Flex wide direction="column" gap="32" :class="$style.wrapper">
				<Flex align="center" direction="column" gap="12">
					<Flex align="center" gap="6">
						<Icon name="help" size="18" color="primary" />
						<Text size="16" weight="600" color="primary"> Lost your password? </Text>
					</Flex>

					<Text size="14" weight="500" color="body" height="140" align="center" style="padding: 0 12px">
						Password recovery is not possible. Delete this profile, then re-import it with its recovery phrase.
					</Text>
				</Flex>

				<ItemsContainer title="Recovery">
					<SettingItem
						@click="handleReset"
						title="Delete profile"
						icon="trash"
						iconBgColor="red"
						chevron
						data-testid="forgot-reset-btn"
					/>
				</ItemsContainer>

				<ItemsContainer>
					<!-- TODO: Update URL when Nulo domain is ready -->
					<SettingItem
						title="Report issue with authorization"
						to="https://nulo.sh/forms/report-issue"
						icon="help"
						external
						data-testid="forgot-report-btn"
					/>
				</ItemsContainer>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}
</style>
