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
import { parseRawBalance, safeFiatOf } from "@/utils/token-amount"
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
const totalTokenBalance = computed(() => {
	if (!props.tokenBalance) return { value: 0 }

	// Sum raw base units in bigint domain — no float pivot, no precision loss
	// even at 18 decimals.
	const decimals = props.tokenBalance.token?.decimals || 0
	const publicRaw = BigInt(props.tokenBalance.publicBalance || 0)
	const privateRaw = BigInt(props.tokenBalance.privateBalance || 0)

	return balanceFormatted(publicRaw + privateRaw, decimals, showFullBalance.value ? undefined : 20)
})

const privateBalanceFormatted = computed(() => {
	if (!props.tokenBalance) return "0"
	return balanceFormatted(props.tokenBalance.privateBalance || 0, props.tokenBalance.token?.decimals || 0, 10).value
})
const publicBalanceFormatted = computed(() => {
	if (!props.tokenBalance) return "0"
	return balanceFormatted(props.tokenBalance.publicBalance || 0, props.tokenBalance.token?.decimals || 0, 10).value
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

const displayedRawTotal = computed(() => {
	if (!props.tokenBalance) return 0n
	return BigInt(props.tokenBalance.publicBalance || 0) + BigInt(props.tokenBalance.privateBalance || 0)
})

/** Secondary line for the token hero: `≈ $x.xx`, or undefined (hidden). */
const displayedTokenFiat = computed(() => {
	if (!tokenToDisplay.value) return undefined
	return prices.tokenFiatLabel(tokenToDisplay.value, displayedRawTotal.value)
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
const onActiveChain = (tb) => tb.token?.chainId === appStore.network?.chainId

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
tokenBalanceService.onTokenBalanceDeleted.add(onBalanceDeleted)
function onBalanceAdded(tb) {
	if (tb.account !== appStore.account?.address || !onActiveChain(tb)) return

	tokenBalances.value.push(tb)
}
function onBalanceUpdated(tb) {
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value[idx] = tb
	}
}
function onBalanceDeleted(tb) {
	tokenBalances.value = tokenBalances.value.filter((_tb) => _tb.id !== tb.id)
}

async function fetchTokenBalances() {
	const rows = await tokenBalanceService.getTokenBalances(undefined, appStore.account?.address)
	tokenBalances.value = forChain(rows, appStore.network?.chainId)
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
				<template v-else>{{ aggregateFiatDisplay }}</template>
			</div>

			<div v-if="tokenToDisplay && displayedTokenFiat" data-testid="balance-fiat" :class="$style.fiat_line">
				{{ displayedTokenFiat }}
			</div>
			<div v-if="!tokenToDisplay && isAggregatePartial" data-testid="balance-fiat-partial" :class="$style.fiat_partial">
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
