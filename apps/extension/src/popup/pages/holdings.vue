<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup lang="ts">
/** Components */
import TokenList from "../components/modules/holdings/TokenList.vue"

/** Services */
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import type { TokenBalanceInfo } from "@/wallet/services/token-balance/spec"

/** Utils */
import { parseRawBalance, safeFiatOf } from "@/utils/token-amount"
import { aggregateFiat } from "@/utils/token-aggregate"
import { forChain } from "@/utils/token-order"

/** Composables */
import { useEntityCrud } from "@/composables/useEntityCrud"
import { pinScopeOf, usePinnedTokens } from "@/composables/usePinnedTokens"
import { usePrices } from "@/composables/usePrices"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const activeChainId = () => appStore.network?.chainId
const activeAccount = () => appStore.account?.address

// The balance service returns a shared address's rows from every chain of the profile; this page
// keeps the active chain's rows only, both on fetch and on every live event.
const tokenBalanceService = new TokenBalanceServiceClient()
const {
	entities: rows,
	isLoading,
	error,
	refresh,
	dispose: disposeCrud,
} = useEntityCrud<TokenBalanceInfo>({
	fetch: async () => {
		const account = activeAccount()
		if (!account) return []
		return forChain(await tokenBalanceService.getTokenBalances(undefined, account), activeChainId())
	},
	added: tokenBalanceService.onTokenBalanceAdded,
	updated: tokenBalanceService.onTokenBalanceUpdated,
	deleted: tokenBalanceService.onTokenBalanceDeleted,
	accept: (tb) => tb.account === activeAccount() && tb.token.chainId === activeChainId(),
})
// A port reconnect can drop events fired while disconnected; resnapshot.
tokenBalanceService.onConnected.add(onReconnected)
function onReconnected() {
	void refresh()
}

const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const fiatOf = safeFiatOf((tb: TokenBalanceInfo) => prices.tokenFiatMicro(tb.token, parseRawBalance(tb) ?? 0n))
const usdRateOf = (tb: TokenBalanceInfo) => prices.quoteFor(tb.token.chainId, tb.token.contract)?.usd

const showFiatValues = ref(true)
const dustThresholdUsd = ref(0)
const configService = new ConfigServiceClient()
configService.onUpdate.add(onConfigUpdate)
function onConfigUpdate(prop: { key: string; value: unknown }) {
	if (prop.key === "showFiatValues") showFiatValues.value = prop.value !== false
	if (prop.key === "incomingDustUsdThreshold") dustThresholdUsd.value = Number(prop.value) || 0
}
// Leaving the page rejects any read still in flight; the defaults stand in that case. A reconnect
// may have dropped an update, so the values are read again on every connect.
function readConfig() {
	configService
		.getValue("showFiatValues")
		.then((v) => {
			showFiatValues.value = v !== false
		})
		.catch(() => undefined)
	configService
		.getValue("incomingDustUsdThreshold")
		.then((v) => {
			dustThresholdUsd.value = Number(v) || 0
		})
		.catch(() => undefined)
}
readConfig()
configService.onConnected.add(readConfig)

const pins = usePinnedTokens({
	getScope: () => pinScopeOf(appStore.profile?.id, activeChainId()),
	knownContracts: () => new Set(rows.value.map((tb) => tb.token.contract)),
})
void pins.refresh()

const aggregate = computed(() => aggregateFiat(rows.value, fiatOf))
const aggregateDisplay = computed(() => prices.formatUsdMicro(aggregate.value.micro))

watch(
	() => [appStore.profile?.id, appStore.account?.address, appStore.network?.chainId],
	() => {
		void refresh({ clear: true })
		void pins.refresh()
	},
)

onBeforeUnmount(() => {
	tokenBalanceService.onConnected.remove(onReconnected)
	disposeCrud()
	tokenBalanceService.disconnect()
	prices.dispose()
	priceService.disconnect()
	configService.onConnected.remove(readConfig)
	configService.disconnect()
	pins.dispose()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper" data-testid="holdings-page">
		<Flex direction="column" gap="16" :class="$style.content">
			<Flex align="end" justify="between" :class="$style.summary" data-testid="holdings-summary">
				<span v-if="showFiatValues" :class="$style.summary_amount">{{ aggregateDisplay }}</span>
				<span :class="$style.summary_meta">
					{{ rows.length }} tokens<template v-if="showFiatValues && aggregate.partial"> · priced assets only</template>
				</span>
			</Flex>

			<LoadingState v-if="isLoading" label="LOADING HOLDINGS" />
			<span v-else-if="error" :class="$style.error" data-testid="holdings-error">Couldn't load holdings</span>
			<TokenList
				v-else
				:rows="rows"
				:pinnedContracts="pins.pinnedContracts.value"
				:fiatOf="fiatOf"
				:usdRateOf="usdRateOf"
				:dustThresholdUsd="dustThresholdUsd"
			/>
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

.summary {
	padding-bottom: 4px;
}

.summary_amount {
	font-family: var(--font-headline);
	font-size: 26px;
	font-weight: 700;
	letter-spacing: -0.04em;
	color: var(--txt-primary);
}

.summary_meta {
	font-family: var(--font-mono);
	font-size: 10px;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.error {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--red);
}
</style>
