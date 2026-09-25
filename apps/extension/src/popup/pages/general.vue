<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup>
/** Services */
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Components */
import BalanceView from "../components/modules/general/BalanceView.vue"
import RecentActivityView from "../components/modules/general/RecentActivityView.vue"
import RecoveryModeBanner from "../components/modules/general/RecoveryModeBanner.vue"
import TokensView from "../components/modules/general/TokensView.vue"

/** Composables */
import { ARRIVALS_KEY } from "@/composables/useArrivals"
import { useSeedStatus } from "@/composables/useSeedStatus"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const arrivals = inject(ARRIVALS_KEY, undefined)

/** One client and one seeding kick for the page: the hero and the list read the same snapshot. */
const tokenService = new TokenServiceClient()
const seed = useSeedStatus({
	client: tokenService,
	getScope: () => {
		const profileId = appStore.profile?.id
		const chainId = appStore.network?.chainId
		return profileId !== undefined && chainId !== undefined ? { profileId, chainId } : undefined
	},
})

watch(
	() => [appStore.profile?.id, appStore.network?.chainId],
	() => void seed.refresh(),
)
onMounted(() => void seed.refresh())
onBeforeUnmount(() => {
	tokenService.disconnect()
	seed.dispose()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<BalanceView :seedEntries="seed.entries.value" :seedReady="seed.ready.value" :arrival="arrivals?.latest.value ?? null" />

		<Flex direction="column" gap="16" :class="$style.content">
			<RecoveryModeBanner />
			<TokensView :seedEntries="seed.entries.value" :seedReady="seed.ready.value" @retry-seed="seed.retry" />
			<RecentActivityView />
		</Flex>

	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;

	overflow: auto;

	background: var(--app-bg);
}

.content {
	padding: 0 24px var(--nav-clearance) 24px;
}
</style>
