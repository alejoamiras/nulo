<script setup>
/**
 * The Send token picker. Lists the active account's tokens on the active chain in the same order
 * as Home and Holdings (pinned, then by value), with a search box once the list outgrows Home's
 * budget. Clients connect on show and are torn down on hide — the popup stays mounted.
 */

/** Components */
import ListStatusMessage from "@/components/composite/ListStatusMessage.vue"

/** Services */
import { PriceServiceClient } from "@/wallet/services/price/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"

/** Utils */
import { parseRawBalance, safeFiatOf } from "@/utils/token-amount"
import { HOME_TOKEN_ROWS, forChain, orderTokenRows } from "@/utils/token-order"
import { matchesQuery } from "@/utils/token-search"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const emit = defineEmits(["onSelectToken", "onClose"])
const props = defineProps({
	show: Boolean,
})

const router = useRouter()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.select_token?.order
})

const rows = ref([])
const query = ref("")

/** One price client per open; the composable is disposed BEFORE its client disconnects. */
const priceService = new PriceServiceClient()
const prices = shallowRef(null)
const fiatOf = safeFiatOf((tb) => prices.value?.tokenFiatMicro(tb.token, parseRawBalance(tb)))
/** Pins land in a later arc; the empty set keeps the order value-first until then. */
const pinnedContracts = new Set()

const searchable = computed(() => rows.value.length > HOME_TOKEN_ROWS)
const listed = computed(() => {
	const matching = rows.value.filter((tb) => matchesQuery(tb.token, query.value))
	return orderTokenRows(matching, { pinnedContracts, fiatOf })
})
const noResults = computed(() => rows.value.length > 0 && listed.value.length === 0)

const onActiveScope = (tb) => tb.account === appStore.account?.address && tb.token.chainId === appStore.network?.chainId

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
tokenBalanceService.onTokenBalanceDeleted.add(onBalanceDeleted)
function onBalanceAdded(tb) {
	if (!props.show || !onActiveScope(tb)) return
	if (!rows.value.some((r) => r.id === tb.id)) rows.value.push(tb)
}
function onBalanceUpdated(tb) {
	const idx = rows.value.findIndex((r) => r.id === tb.id)
	if (idx !== -1) rows.value[idx] = tb
}
function onBalanceDeleted(tb) {
	const idx = rows.value.findIndex((r) => r.id === tb.id)
	if (idx !== -1) rows.value.splice(idx, 1)
}

const handleSelectToken = (id) => {
	cacheStore.activeTokenIdx = id
	emit("onClose")
}

const handleManageTokens = () => {
	router.push("/popup/settings/tokens")
	popupStore.closeAll()
}

const open = async () => {
	prices.value = usePrices(priceService)
	const all = await tokenBalanceService.getTokenBalances(undefined, appStore.account?.address)
	// The popup may have closed while the fetch was in flight.
	if (!props.show) return
	rows.value = forChain(all, appStore.network?.chainId)
}

const close = () => {
	rows.value = []
	query.value = ""
	prices.value?.dispose()
	prices.value = null
	priceService.disconnect()
	tokenBalanceService.disconnect()
}

watch(
	() => props.show,
	() => (props.show ? open() : close()),
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.select_token?.order">
		<PopupCard :displaceIdx>
			<PopupHeader @onClose="emit('onClose')" closable>
				<template #title>
					<Text size="14" weight="600" color="primary">Select token</Text>
				</template>
			</PopupHeader>

			<Flex wide direction="column" gap="24" :class="$style.wrapper">
				<label v-if="searchable" :class="$style.search">
					<MaterialIcon name="search" :size="16" color="secondary" />
					<input
						v-model="query"
						type="text"
						placeholder="Search tokens"
						maxlength="80"
						autocomplete="off"
						spellcheck="false"
						data-testid="select-token-search"
						:class="$style.search_input"
					/>
				</label>

				<ItemsContainer>
					<ListStatusMessage v-if="noResults" variant="no-results" testid="select-token-no-results" />
					<SettingItem
						v-for="tb in listed"
						:key="tb.id"
						@click="handleSelectToken(tb.token.id)"
						:title="tb.token.symbol"
						:icon="tb.token.id === cacheStore.activeTokenIdx ? 'check-circle' : 'circle'"
						:iconFillColor="tb.token.id === cacheStore.activeTokenIdx ? 'primary' : 'tertiary'"
						iconBgColor="transparent"
						data-testid="select-token-row"
						:data-symbol="tb.token.symbol"
						:data-selected="tb.token.id === cacheStore.activeTokenIdx ? 'true' : 'false'"
					/>
				</ItemsContainer>

				<ItemsContainer>
					<SettingItem
						@click="handleManageTokens"
						size="small"
						title="Manage tokens"
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
	padding: 0 20px 24px 20px;
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;

	height: 36px;
	padding: 0 10px;
	border: 1px solid var(--nulo-outline);
	background: var(--nulo-surface);
	cursor: text;
}

.search_input {
	flex: 1;
	min-width: 0;

	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);
	background: transparent;
	border: none;
	outline: none;

	&::placeholder {
		color: var(--nulo-outline);
	}
}
</style>
