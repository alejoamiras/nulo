<script setup>
/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const emit = defineEmits(["onRefreshBalance"])
const props = defineProps({
	tokenBalance: {
		type: Object,
		required: false,
	},
	newToken: {
		type: Object,
		required: false,
	},
	/** §3: this token's incoming public-transfer history is cold-start backfilling — drives the
	 *  "Catching up…" affordance. Grafted by TokensView from IncomingTransferService's sync state. */
	backfilling: {
		type: Boolean,
		default: false,
	},
})

const token = computed(() => props.tokenBalance.token)
const decimals = computed(() => token.value?.decimals || 0)
const publicRaw = computed(() => BigInt(props.tokenBalance?.publicBalance || 0))
const privateRaw = computed(() => BigInt(props.tokenBalance?.privateBalance || 0))
const totalBalance = computed(() => balanceFormatted(privateRaw.value + publicRaw.value, decimals.value, 10).value)

/** B1: holding fiat value between amount and split — absent when unpriced.
 *  The client lifecycle lives here (row-level) because TokenCard is mounted
 *  per-row from the tokens list; the shared cache keeps this cheap. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const fiatLabel = computed(() => prices.tokenFiatLabel(token.value, privateRaw.value + publicRaw.value))
onBeforeUnmount(() => {
	prices.dispose()
	priceService.disconnect()
})
const privateFormatted = computed(() => balanceFormatted(privateRaw.value, decimals.value, 6).value)
const publicFormatted = computed(() => balanceFormatted(publicRaw.value, decimals.value, 6).value)
const hasPrivate = computed(() => privateRaw.value !== 0n)
const hasPublic = computed(() => publicRaw.value !== 0n)
// Treat updatedAt===0 as "balance has never synced" — the projector hasn't run yet
// so the "0" placeholder in the row would be misleading. Render a spinner instead.
const isInitialSync = computed(() => !!props.tokenBalance && props.tokenBalance.updatedAt === 0)
// §3: the balance is known but incoming history is still hydrating → a subtle caption beside the balance.
const catchingUp = computed(() => props.backfilling && !isInitialSync.value)
// §3: balance ALSO unknown (fresh add) → escalate the loading block from a plain spinner to a shimmer.
const catchingUpUnresolved = computed(() => props.backfilling && isInitialSync.value)
const description = computed(() => {
	if (props.tokenBalance?.isMinting) return "Minting more tokens..."
	if (catchingUpUnresolved.value) return "Catching up…"
	if (isInitialSync.value) return "Loading balance…"
	if (props.newToken) return "Minting in progress..."

	return token.value?.name || "unknown"
})

// A refresh in flight AFTER the first sync keeps the amount visible and shows
// a pulsing dot beside it (the GasBalanceCard vocabulary) — the loading block
// is reserved for the never-synced state.
const isRefreshing = computed(() => !!props.tokenBalance?.isUpdating && !isInitialSync.value)
// The row's last projection FAILED (persisted `syncFailure`, cleared by the
// next success): dim the last-known amount + say so. Gated on !isUpdating so a
// retry in flight shows its honest in-flight state instead (the dot after the
// first sync, the loading block during it). Deliberately NOT gated on
// isInitialSync: a never-synced row whose FIRST projection failed must show
// the failure, not an infinite "Loading balance…" spinner.
const syncFailed = computed(() => !!props.tokenBalance?.syncFailure && !props.tokenBalance?.isUpdating)

const isHovered = ref(false)

const handleRefreshBalance = async () => {
	if (!props.tokenBalance) return

	emit("onRefreshBalance")
}
</script>

<template>
	<RouterLink
		v-if="tokenBalance"
		:to="`/popup/tokens/${token?.id}`"
		data-testid="tokens-card"
		:class="$style.row"
		@pointerenter="isHovered = true"
		@pointerleave="isHovered = false"
	>
		<Flex direction="column" gap="2">
			<Flex align="center" gap="6">
				<!-- §3 catching-up: an ambient dot, not a caption — it renders only when the scan is
				     genuinely behind (TokensView's threshold gate) and explains itself via tooltip.
				     Focusable so the tooltip is keyboard-reachable. -->
				<Tooltip v-if="catchingUp" side="top" position="start">
					<span
						:class="$style.pulse_dot_wrap"
						data-testid="token-catching-up"
						tabindex="0"
						role="img"
						aria-label="Catching up on incoming transfers"
					>
						<span :class="$style.pulse_dot" />
					</span>
					<template #content>Catching up on incoming transfers</template>
				</Tooltip>
				<span :class="$style.symbol" data-testid="token-symbol" :data-symbol="token.symbol">
					{{ token.symbol }}
				</span>
			</Flex>
			<span v-if="fiatLabel" data-testid="token-fiat" :class="$style.fiat">{{ fiatLabel }}</span>
			<span v-else :class="$style.fiat">{{ token?.name || "unknown" }}</span>
		</Flex>

		<Flex
			v-if="isInitialSync && !syncFailed"
			align="center"
			gap="6"
			data-testid="token-balance-loading"
			:class="$style.loading_block"
		>
			<span v-if="catchingUpUnresolved" :class="$style.balance_shimmer" data-testid="token-balance-shimmer" />
			<Spinner v-else size="12" color="--txt-tertiary" />
			<span :class="$style.loading_text">{{ description }}</span>
		</Flex>
		<Flex v-else direction="column" align="end" gap="2">
			<Flex align="center" gap="6">
				<span v-if="isRefreshing" :class="$style.pulse_dot" data-testid="token-balance-refreshing" />
				<span :class="[$style.amount, syncFailed && $style.amount_stale]">{{ totalBalance || 0 }}</span>
			</Flex>
			<span :class="$style.detail">
				<span :class="$style.icon_private"><Icon name="lock" size="9" /></span>
				{{ privateFormatted }}
				<span :class="$style.pub_group">
					<span :class="$style.icon_public"><Icon name="globe" size="9" /></span>
					{{ publicFormatted }}
				</span>
			</span>
			<span v-if="syncFailed && !isRefreshing" :class="$style.failed_text" data-testid="token-balance-failed">
				Couldn't refresh
			</span>
		</Flex>
	</RouterLink>

	<Flex v-if="newToken" align="center" justify="between" :class="[$style.row, $style.minting]">
		<Flex direction="column" gap="2">
			<span :class="$style.symbol">{{ newToken.symbol }}</span>
			<span :class="$style.type_label">MINTING...</span>
		</Flex>
		<Spinner size="14" color="--txt-tertiary" />
	</Flex>
</template>

<style module>
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;

	padding: 8px 0;
	cursor: pointer;
	text-decoration: none;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-surface-low) 50%, transparent);
	}
}

.minting {
	opacity: 0.5;
	pointer-events: none;
}

.symbol {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

.type_label {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.amount {
	font-family: var(--font-mono);
	font-size: 14px;
	font-weight: 500;
	color: var(--txt-primary);
}

.fiat {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.detail {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);

	display: inline-flex;
	align-items: center;
	gap: 3px;
}

/* Same private/public vocabulary as BalanceView's breakdown: bone lock = private,
   grey globe = public. Icons inherit via currentColor. */
.icon_private {
	display: inline-flex;
	color: var(--nulo-accent);
}

.icon_public {
	display: inline-flex;
	color: var(--nulo-secondary);
}

.pub_group {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	margin-left: 6px;
}

.loading_block {
	min-height: 32px;
}

.loading_text {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
}

.pulse_dot {
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--nulo-accent);

	animation: token_pulse 2s linear infinite;
}

/* §3 catching-up dot: sits LEFT of the symbol, glows softly (it must be findable without a
   caption), explains itself via the wrapping Tooltip — hover or keyboard focus. */
.pulse_dot_wrap {
	display: inline-flex;
	align-items: center;
	cursor: help;
	outline: none;
}

.pulse_dot_wrap .pulse_dot {
	/* Glow follows the accent so it works in BOTH themes (bone halo in dark, warm in light). */
	box-shadow: 0 0 4px 1px color-mix(in srgb, var(--nulo-accent) 35%, transparent);
}

.pulse_dot_wrap:focus-visible {
	outline: 1px solid var(--nulo-accent);
	outline-offset: 2px;
}

@keyframes token_pulse {
	0% {
		opacity: 1;
	}
	50% {
		opacity: 0.25;
	}
	100% {
		opacity: 1;
	}
}

/* Last projection failed: keep the last-known amount visible, dimmed (the
   GasBalanceCard stale vocabulary), with the reason underneath. */
.amount_stale {
	opacity: 0.55;
}

.failed_text {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--red);
}

/* Escalated loading affordance (balance ALSO unresolved): a shimmer where the amount would be. */
.balance_shimmer {
	width: 72px;
	height: 12px;

	background: linear-gradient(
		90deg,
		var(--nulo-surface-low) 25%,
		var(--nulo-surface-high) 50%,
		var(--nulo-surface-low) 75%
	);
	background-size: 200% 100%;

	animation: token_balance_shimmer 1.4s var(--bezier) infinite;
}

@keyframes token_balance_shimmer {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.pulse_dot,
	.balance_shimmer {
		animation: none;
	}
}
</style>
