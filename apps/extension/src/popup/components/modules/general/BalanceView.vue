<script setup>
/** Components */
import ActionButtonsView from "./ActionButtonsView.vue"
import GasBalanceCard from "./GasBalanceCard.vue"

/** Services */
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { copyToClipboard } from "@/utils/clipboard"
import { isValidDecimals, parseRawBalance, safeFiatOf } from "@/utils/token-amount"
import { aggregateFiat } from "@/utils/token-aggregate"
import { forChain } from "@/utils/token-order"

/** Composables */
import { usePrices } from "@/composables/usePrices"
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

/** Home shows the account aggregate; the token page passes its own balance for a per-token hero. */
const props = defineProps({
	tokenBalance: {
		type: Object,
		required: false,
		default: null,
	},
})

const tokenBalances = ref([])

const tokenToDisplay = computed(() => props.tokenBalance?.token)
const showFullBalance = ref(false)
/** The token hero reads a stored row: a malformed side or invalid decimals renders a dash, never throws. */
const heroSides = computed(() => {
	const tb = props.tokenBalance
	if (!tb || !isValidDecimals(tb.token?.decimals)) return undefined
	const publicRaw = parseRawBalance({ publicBalance: tb.publicBalance })
	const privateRaw = parseRawBalance({ privateBalance: tb.privateBalance })
	if (publicRaw === undefined || privateRaw === undefined) return undefined
	return { publicRaw, privateRaw, decimals: tb.token.decimals }
})
const totalTokenBalance = computed(() => {
	if (!props.tokenBalance) return { value: 0 }
	const sides = heroSides.value
	if (!sides) return { value: "—" }
	return balanceFormatted(sides.publicRaw + sides.privateRaw, sides.decimals, showFullBalance.value ? undefined : 20)
})

const privateBalanceFormatted = computed(() => {
	const sides = heroSides.value
	return sides ? balanceFormatted(sides.privateRaw, sides.decimals, 10).value : "—"
})
const publicBalanceFormatted = computed(() => {
	const sides = heroSides.value
	return sides ? balanceFormatted(sides.publicRaw, sides.decimals, 10).value : "—"
})

/** Live prices. Parent owns the client lifecycle; the composable owns
 *  freshness. Every fiat element below renders ONLY with a usable quote —
 *  no price means no dollar figure, never a fake $0.00. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)

/** Fiat kill-switch state — with it OFF the aggregate slot is HIDDEN entirely
 *  (the space is reclaimed), not rendered as a dash. */
const showFiatValues = ref(true)
const configService = new ConfigServiceClient()
configService.onUpdate.add(onConfigUpdate)
function onConfigUpdate(prop) {
	if (prop.key === "showFiatValues") showFiatValues.value = prop.value !== false
}
configService.getValue("showFiatValues").then((v) => {
	showFiatValues.value = v !== false
})

/** Secondary line for the token hero: `≈ $x.xx`, or undefined (hidden, also for a malformed row). */
const displayedTokenFiat = computed(() => {
	const sides = heroSides.value
	if (!tokenToDisplay.value || !sides) return undefined
	return prices.tokenFiatLabel(tokenToDisplay.value, sides.publicRaw + sides.privateRaw)
})

const fiatOf = safeFiatOf((tb) => prices.tokenFiatMicro(tb.token, parseRawBalance(tb)))
const aggregate = computed(() => aggregateFiat(tokenBalances.value, fiatOf))

/** Always a dollar figure — holdings that lack a price count as $0.00 and
 *  the "priced assets only" caption owns the honesty, never an em-dash. */
const aggregateFiatDisplay = computed(() => prices.formatUsdMicro(aggregate.value.micro))
const isAggregatePartial = computed(() => aggregate.value.partial)

const handleCopy = (value, label) => {
	void copyToClipboard(value, openToast, {
		success: { label: `${label} is copied` },
		failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
	})
}
const handleTokenBalanceClick = async () => {
	let balance = totalTokenBalance.value?.value
	if (totalTokenBalance.value?.slashed || showFullBalance.value) {
		showFullBalance.value = !showFullBalance.value
		await nextTick()
		balance = totalTokenBalance.value?.value
	}

	handleCopy(balance, "Balance")
}

// The balance service returns a shared address's rows from every chain of the profile; the
// aggregate is over the active chain only.
const inActiveScope = (tb) => tb.account === appStore.account?.address && tb.token?.chainId === appStore.network?.chainId

/** False while the active scope's snapshot is in flight: the figure is hidden, not shown as $0.00. */
const isLoaded = ref(false)
// A snapshot in flight is older than any event that lands meanwhile; the event marks it stale.
let fetchDirty = false
const markDirty = () => {
	if (!isLoaded.value) fetchDirty = true
}

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
tokenBalanceService.onTokenBalanceDeleted.add(onBalanceDeleted)
function onBalanceAdded(tb) {
	if (!inActiveScope(tb)) return
	tokenBalances.value.push(tb)
	markDirty()
}
function onBalanceUpdated(tb) {
	if (inActiveScope(tb)) markDirty()
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value[idx] = tb
	}
}
function onBalanceDeleted(tb) {
	tokenBalances.value = tokenBalances.value.filter((_tb) => _tb.id !== tb.id)
	if (inActiveScope(tb)) markDirty()
}
// The first connect is the one the mount's fetch opened. Any later connect is a port drop and
// reconnect: events may have been missed and the request in flight was rejected, so resnapshot —
// the new generation fences that rejection out.
let connectsSeen = 0
tokenBalanceService.onConnected.add(onReconnected)
function onReconnected() {
	connectsSeen++
	if (connectsSeen > 1) void fetchTokenBalances()
}

// A fetch for one scope may resolve after the user moved on; only the latest request may land,
// and a snapshot overtaken by a live event is refetched rather than applied.
let fetchGeneration = 0
async function fetchTokenBalances() {
	const generation = ++fetchGeneration
	const address = appStore.account?.address
	const chainId = appStore.network?.chainId
	tokenBalances.value = []
	isLoaded.value = false
	fetchDirty = false
	if (!address) {
		isLoaded.value = true
		return
	}
	let rows
	try {
		rows = await tokenBalanceService.getTokenBalances(undefined, address)
	} catch {
		return
	}
	if (generation !== fetchGeneration) return
	if (fetchDirty) return fetchTokenBalances()
	tokenBalances.value = forChain(rows, chainId)
	isLoaded.value = true
}

watch(
	() => [appStore.account?.address, appStore.network?.chainId],
	async () => {
		await fetchTokenBalances()
	},
)
onMounted(async () => {
	await fetchTokenBalances()
})
onBeforeUnmount(() => {
	tokenBalanceService.onConnected.remove(onReconnected)
	tokenBalanceService.disconnect()
	prices.dispose()
	priceService.disconnect()
	configService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<!-- Balance section -->
		<section :class="$style.balance_section">
			<div
				v-if="tokenToDisplay || showFiatValues"
				@click="handleTokenBalanceClick"
				data-testid="balance-amount"
				:class="$style.balance_amount"
			>
				<template v-if="tokenToDisplay">
					{{ totalTokenBalance.value }}
					<span :class="$style.balance_symbol">{{ tokenToDisplay?.symbol }}</span>
				</template>
				<template v-else-if="isLoaded">{{ aggregateFiatDisplay }}</template>
			</div>

			<div v-if="tokenToDisplay && displayedTokenFiat" data-testid="balance-fiat" :class="$style.fiat_line">
				{{ displayedTokenFiat }}
			</div>
			<div v-if="!tokenToDisplay && isLoaded && isAggregatePartial" data-testid="balance-fiat-partial" :class="$style.fiat_partial">
				priced assets only
			</div>

			<!-- Glyphs-only: the lock/globe pair IS the vocabulary (same as the token rows) — no
			     PRIVATE/PUBLIC words doubling it (owner call, post-approval). -->
			<Flex v-if="tokenToDisplay" align="center" justify="center" gap="12" :class="$style.breakdown">
				<span :class="$style.breakdown_item" aria-label="Private balance">
					<span :class="$style.breakdown_private"><Icon name="lock" size="12" /></span>
					<span data-testid="private-balance-value">{{ privateBalanceFormatted }}</span>
				</span>
				<span :class="$style.breakdown_divider">|</span>
				<span :class="$style.breakdown_item" aria-label="Public balance">
					<span :class="$style.breakdown_public"><Icon name="globe" size="12" /></span>
					<span data-testid="public-balance-value">{{ publicBalanceFormatted }}</span>
				</span>
			</Flex>
		</section>

		<!-- Gas juice (home page only, not token detail) -->
		<GasBalanceCard v-if="!tokenBalance" />

		<!-- Action buttons -->
		<Flex :class="$style.actions">
			<ActionButtonsView :token="tokenBalance?.token" />
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	padding: 0 24px 24px 24px;
}

.balance_section {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;

	margin-top: 22px;
	margin-bottom: 10px;
}

.balance_amount {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	color: var(--txt-primary);
	cursor: pointer;

	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 100%;
}

.balance_symbol {
	font-size: 24px;
	color: var(--txt-tertiary);
}

.fiat_line {
	font-family: var(--font-mono);
	font-size: 13px;
	color: var(--nulo-secondary);
	margin-top: 4px;
}

.fiat_partial {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--nulo-outline);
	margin-top: 4px;
}

.breakdown {
	margin-top: 8px;
}

.breakdown_item {
	display: flex;
	align-items: center;
	gap: 6px;

	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.02em;
	color: var(--nulo-secondary);
}

/* Same private/public vocabulary as TokenCard's split: bone lock = private, grey globe = public. */
.breakdown_private {
	display: inline-flex;
	color: var(--nulo-accent);
}

.breakdown_public {
	display: inline-flex;
	color: var(--nulo-secondary);
}

.breakdown_divider {
	color: var(--nulo-outline);
}

.actions {
	width: 100%;
	margin-top: 12px;
}
</style>
