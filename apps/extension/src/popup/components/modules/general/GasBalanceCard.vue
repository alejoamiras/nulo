<script setup>
/** Services */
import { ExecutionServiceClient } from "@/wallet/services/execution/client"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { TxStatus } from "@/wallet/services/transaction/spec"

/** Services (prices) */
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { formatBaseUnits } from "@/utils/amount"
import { tokenAmountToUsdMicro, formatUsdMicro } from "@/wallet/services/price/convert"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

/** Reactive state */
const publicFeeJuice = ref("0")
const privateFeeJuice = ref(null)
const isLoading = ref(true)
const hasLoaded = ref(false)
/** Data quality vs activity, deliberately separate: `isStale` dims the
 *  value and only a FRESH commit clears it (a failed refresh must not
 *  bless stale data as current); `isRefreshing` drives the activity dot
 *  and always clears when the attempt settles. */
const isStale = ref(false)
const isRefreshing = ref(false)

const FEE_JUICE_DECIMALS = 18

// Truncate (round-down) so the displayed balance is always ≤ actual — same
// contract as token-balance display.
const formatBalance = (raw) => formatBaseUnits(raw ?? "0", FEE_JUICE_DECIMALS, { maxDecimals: 4 })

const publicFormatted = computed(() => formatBalance(publicFeeJuice.value))

/** D2: fiat under non-zero balances, only with a usable AZTEC quote. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const fiatFor = (raw) => {
	const quote = prices.feeJuiceQuote.value
	if (!quote) return null
	const rawBig = BigInt(raw ?? "0")
	if (rawBig === 0n) return null
	return `≈ ${formatUsdMicro(tokenAmountToUsdMicro(rawBig, FEE_JUICE_DECIMALS, quote.usd))}`
}
const publicFiat = computed(() => fiatFor(publicFeeJuice.value))
const privateFiat = computed(() => fiatFor(privateFeeJuice.value))
// Treat null (PrivateFPC not yet discovered or query errored) as 0 so the
// column always renders. Keeps the gas-balance card stable instead of
// collapsing/expanding mid-load.
const privateFormatted = computed(() => formatBalance(privateFeeJuice.value ?? "0"))

/** Service clients */
const executionService = new ExecutionServiceClient()
const transactionService = new TransactionServiceClient()

/** Transaction subscription handlers */
function onTransactionAdded(tx) {
	if (tx.account !== appStore.account?.address) return
	if (!tx.estimatedFee) return

	if (
		tx.feePaymentMethod === AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE ||
		tx.feePaymentMethod === AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
	) {
		const next = BigInt(publicFeeJuice.value) - BigInt(tx.estimatedFee)
		publicFeeJuice.value = (next < 0n ? 0n : next).toString()
	}
	// For External (FPC): skip optimistic deduction — real refresh on completion handles it.
}

function onTransactionUpdated(tx) {
	if (tx.account !== appStore.account?.address) return
	if (tx.status !== TxStatus.Pending) {
		loadBalances(true)
	}
}

transactionService.onTransactionAdded.add(onTransactionAdded)
transactionService.onTransactionUpdated.add(onTransactionUpdated)

/** Monotonic per-call generation: identity switches and event-driven
 *  refreshes can overlap, and a late completion from a superseded call
 *  must neither overwrite newer values nor clear the newer call's
 *  markers. */
let loadGeneration = 0

/** Functions */
async function loadBalances(forceRefresh = false) {
	const gen = ++loadGeneration
	const isCurrent = () => gen === loadGeneration
	try {
		if (!hasLoaded.value) isLoading.value = true
		if (!appStore.account?.address || !appStore.network?.id) return
		const networkId = appStore.network.id
		const accountAddress = appStore.account.address

		if (!hasLoaded.value) {
			// Instant paint from the SW cache — stale entries included. The
			// skeleton is reserved for a true first-ever load, where there is
			// genuinely nothing to show. Peek is best-effort: its failure must
			// never block the real fetch below.
			try {
				const peeked = await executionService.peekGasBalances(networkId, accountAddress)
				if (isCurrent() && peeked) {
					publicFeeJuice.value = peeked.balances.publicFeeJuice
					privateFeeJuice.value = peeked.balances.privateFeeJuice
					hasLoaded.value = true
					isLoading.value = false
					isStale.value = peeked.stale
				}
			} catch {
				// Fall through to the real fetch; the skeleton stays meanwhile.
			}
		}
		if (!isCurrent()) return
		isRefreshing.value = hasLoaded.value && (isStale.value || forceRefresh)
		// A forced refresh means the on-screen value is known-invalidated (a
		// settled tx changed it) — mark it stale NOW so a failed refresh can't
		// leave it rendered full-opacity as if current.
		if (forceRefresh && hasLoaded.value) isStale.value = true

		const balances = await executionService.getGasBalances(networkId, accountAddress, forceRefresh)
		if (!isCurrent()) return
		publicFeeJuice.value = balances.publicFeeJuice
		privateFeeJuice.value = balances.privateFeeJuice
		hasLoaded.value = true
		isStale.value = false
	} catch {
		// Silently fail — gas balance is informational. A stale value stays
		// visibly dimmed (isStale survives) rather than being blessed fresh.
	} finally {
		if (isCurrent()) {
			isLoading.value = false
			isRefreshing.value = false
		}
	}
}

/** Watchers */
watch(
	() => [appStore.account?.address, appStore.network?.id],
	([newAccount, newNetwork], [oldAccount, oldNetwork]) => {
		if (newAccount !== oldAccount || newNetwork !== oldNetwork) {
			hasLoaded.value = false
			isStale.value = false
			loadBalances()
		}
	},
)

/** Lifecycle */
onMounted(async () => {
	transactionService.connect()
	await loadBalances()
})
onBeforeUnmount(() => {
	executionService.disconnect()
	transactionService.disconnect()
	prices.dispose()
	priceService.disconnect()
})
</script>

<template>
	<div :class="$style.wrapper">
		<span v-if="isRefreshing" :class="$style.refreshing_dot" data-testid="gas-balance-refreshing" aria-hidden="true" />
		<div :class="$style.grid">
			<div :class="$style.col">
				<span :class="$style.label">Public Juice</span>
				<span v-if="isLoading" :class="$style.skeleton" data-testid="gas-skeleton-public" />
				<span v-else :class="[$style.amount, isStale && $style.amount_stale]" data-testid="gas-balance-public"
					>{{ publicFormatted }} FJ</span
				>
				<span v-if="!isLoading && publicFiat" :class="$style.fiat" data-testid="gas-fiat-public">{{ publicFiat }}</span>
			</div>

			<div :class="[$style.col, $style.col_right]">
				<span :class="$style.label">Private Fee Juice</span>
				<span v-if="isLoading" :class="$style.skeleton" data-testid="gas-skeleton-private" />
				<span v-else :class="[$style.amount, isStale && $style.amount_stale]" data-testid="gas-balance-private"
					>{{ privateFormatted }} FJ</span
				>
				<span v-if="!isLoading && privateFiat" :class="$style.fiat" data-testid="gas-fiat-private">{{ privateFiat }}</span>
			</div>
		</div>
	</div>
</template>

<style module>
.wrapper {
	position: relative;
	width: 100%;
	max-width: 280px;
	margin: 0 auto;
	padding-top: 16px;
	border-top: 1px solid rgba(74, 70, 63, 0.2);
}

.refreshing_dot {
	position: absolute;
	top: 20px;
	right: -10px;
	width: 4px;
	height: 4px;
	border-radius: 50%;
	background: var(--nulo-secondary);
	animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% { opacity: 0.25; }
	50% { opacity: 0.9; }
}

.grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}

.col {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.col_right {
	align-items: flex-end;
}

.label {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--nulo-secondary);
}

.amount {
	font-family: var(--font-mono);
	font-size: 12px;
	font-weight: 500;
	color: var(--nulo-accent);
	transition: opacity 0.2s var(--bezier, ease);
}

.amount_stale {
	opacity: 0.55;
}

.fiat {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.skeleton {
	display: inline-block;
	width: 60px;
	height: 12px;
	background: linear-gradient(90deg, var(--nulo-surface-high) 25%, var(--nulo-surface) 50%, var(--nulo-surface-high) 75%);
	background-size: 200% 100%;
	animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
	0% { background-position: 200% 0; }
	100% { background-position: -200% 0; }
}
</style>
