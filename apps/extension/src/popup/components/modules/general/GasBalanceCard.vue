<script setup>
/** Services */
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"

/** Services (prices) */
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { FEE_JUICE_DECIMALS, formatGasBalance } from "@/utils/fee-estimation"
import { tokenAmountToUsdMicro, formatUsdMicro } from "@/wallet/services/price/convert"

/** Stores */
import { useAppStore } from "@/stores/app.store"
import { useBalancesStore } from "@/stores/balances.store"
const appStore = useAppStore()
const balancesStore = useBalancesStore()

/** This card's capabilities: gas only, live-rendering (peek + tx-settle
 *  refresh), no backoff retry — exactly its pre-store traffic. */
const CARD_CAPS = { legs: ["gas"], retry: false, txRefresh: true, peek: true }

const scope = computed(() =>
	appStore.profile?.id && appStore.network?.id && appStore.account?.address
		? {
				profileId: appStore.profile.id,
				networkId: appStore.network.id,
				chainId: appStore.network.chainId,
				accountAddress: appStore.account.address,
			}
		: null,
)
const entry = computed(() => (scope.value ? balancesStore.entry(scope.value) : undefined))
const gas = computed(() => entry.value?.gas)

/** Optimistic deduction: a CARD-LOCAL display overlay — never mutates the
 *  shared entry (a deducted figure must not leak into fee gating). Reset
 *  ONLY by a successful forced (tx-settle) commit, signalled by
 *  forcedVersion; never by generic refreshes. */
const deduction = ref(0n)
watch(
	() => gas.value?.forcedVersion,
	(next, prev) => {
		if (prev !== undefined && next !== undefined && next !== prev) deduction.value = 0n
	},
)

const displayedPublic = computed(() => {
	const raw = gas.value?.display?.publicFeeJuice
	if (raw === undefined) return undefined
	if (raw === null) return null
	const next = BigInt(raw) - deduction.value
	return (next < 0n ? 0n : next).toString()
})
const displayedPrivate = computed(() => gas.value?.display?.privateFeeJuice ?? null)

/** Display state, derived from the shared entry:
 *  - skeleton only when there is genuinely nothing to show (first-ever);
 *  - dim while the shown value is stale (peeked-stale, degraded, or a
 *    known-invalidated forced refresh) — only a fresh commit clears it;
 *  - the activity dot only while a fetch is live over a stale value. */
const hasLoaded = computed(() => gas.value?.display !== undefined)
const isLoading = computed(() => !hasLoaded.value)
const isStale = computed(() => (entry.value?.stale ?? false) || gas.value?.status === "degraded")
const isRefreshing = computed(() => gas.value?.status === "fetching" && hasLoaded.value && isStale.value)

// Null = the read failed (unknown) — an em dash, never a confident zero.
const publicFormatted = computed(() => (displayedPublic.value === null ? "—" : formatGasBalance(displayedPublic.value)))

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
const publicFiat = computed(() => fiatFor(displayedPublic.value))
const privateFiat = computed(() => fiatFor(displayedPrivate.value))
// Treat null (PrivateFPC not yet discovered or query errored) as 0 so the
// column always renders. Keeps the gas-balance card stable instead of
// collapsing/expanding mid-load.
const privateFormatted = computed(() => formatGasBalance(displayedPrivate.value ?? "0"))

/** Service clients — tx client is retained for the ADDED event only (the
 *  optimistic overlay); the settle→refresh trigger is owned by the store. */
const transactionService = new TransactionServiceClient()

function onTransactionAdded(tx) {
	if (tx.account !== appStore.account?.address) return
	if (!tx.estimatedFee) return

	if (
		tx.feePaymentMethod === AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE ||
		tx.feePaymentMethod === AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
	) {
		// Unknown balance stays unknown — there is nothing to deduct FROM.
		if (displayedPublic.value === null || displayedPublic.value === undefined) return
		deduction.value += BigInt(tx.estimatedFee)
	}
	// For External (FPC): skip optimistic deduction — real refresh on completion handles it.
}

transactionService.onTransactionAdded.add(onTransactionAdded)

/** Subscription lifecycle: release-before-subscribe on every identity
 *  change (the store's fence rules require the old key's lease to die
 *  before the new one fetches), overlay reset with it. */
let subscription = null
function resubscribe() {
	subscription?.release()
	subscription = null
	deduction.value = 0n
	if (!scope.value) return
	subscription = balancesStore.subscribe(scope.value, CARD_CAPS)
	// Every mount/switch issues one real read (served from the SW TTL cache
	// when warm — today's per-mount pattern). EnsureSuperseded = identity
	// moved on mid-flight; the new subscription's ensure covers it.
	void balancesStore.ensure(scope.value, { legs: ["gas"] }).catch(() => {})
}

/** Watchers */
watch(scope, (next, prev) => {
	if (next?.profileId !== prev?.profileId || next?.networkId !== prev?.networkId || next?.accountAddress !== prev?.accountAddress) {
		resubscribe()
	}
})

/** Lifecycle */
onMounted(() => {
	transactionService.connect()
	resubscribe()
})
onBeforeUnmount(() => {
	subscription?.release()
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
