<script setup>
/** Services */
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { isValidDecimals, parseRawBalance } from "@/utils/token-amount"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const props = defineProps({
	tokenBalance: {
		type: Object,
		required: false,
	},
	newToken: {
		type: Object,
		required: false,
	},
})

const token = computed(() => props.tokenBalance.token)
// Row numbers come from storage rows that contracts fed: a side that is not a non-negative
// integer literal, or a `decimals` outside 0..77, makes the row "unknown" — rendered as a dash,
// never parsed into BigInt or an exponent.
const isMalformed = computed(
	() => !props.tokenBalance || parseRawBalance(props.tokenBalance) === undefined || !isValidDecimals(token.value?.decimals),
)
const decimals = computed(() => (isMalformed.value ? 0 : token.value.decimals))
const publicRaw = computed(() => (isMalformed.value ? 0n : BigInt(props.tokenBalance.publicBalance || 0)))
const privateRaw = computed(() => (isMalformed.value ? 0n : BigInt(props.tokenBalance.privateBalance || 0)))
const totalBalance = computed(() =>
	isMalformed.value ? "—" : balanceFormatted(privateRaw.value + publicRaw.value, decimals.value, 10).value,
)

/** Holding fiat value between amount and split — absent when unpriced.
 *  The client lifecycle lives here (row-level) because TokenCard is mounted
 *  per-row from the tokens list; the shared cache keeps this cheap. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
const fiatLabel = computed(() => (isMalformed.value ? undefined : prices.tokenFiatLabel(token.value, privateRaw.value + publicRaw.value)))
onBeforeUnmount(() => {
	prices.dispose()
	priceService.disconnect()
})
const privateFormatted = computed(() => balanceFormatted(privateRaw.value, decimals.value, 6).value)
const publicFormatted = computed(() => balanceFormatted(publicRaw.value, decimals.value, 6).value)
// Treat updatedAt===0 as "balance has never synced" — the projector hasn't run yet
// so the "0" placeholder in the row would be misleading. Render a skeleton instead.
const isInitialSync = computed(() => !!props.tokenBalance && props.tokenBalance.updatedAt === 0)

// Routine refreshes are deliberately SILENT per row — batch refreshes would animate every row at
// once; TokensView's section-header dot is the ONE activity signal. Only exceptions speak here:
// the failed dim below + the first-load skeleton.
// The row's last projection FAILED (persisted `syncFailure`, cleared by the
// next success): dim the last-known amount + say so. Gated on !isUpdating so a
// retry in flight shows its honest in-flight state instead (the loading block
// during an initial sync; silence after). Deliberately NOT gated on
// isInitialSync: a never-synced row whose FIRST projection failed must show
// the failure, not an infinite skeleton.
const syncFailed = computed(() => !!props.tokenBalance?.syncFailure && !props.tokenBalance?.isUpdating)
</script>

<template>
	<RouterLink v-if="tokenBalance" :to="`/popup/tokens/${token?.id}`" data-testid="tokens-card" :class="$style.row">
		<Flex direction="column" gap="2">
			<span :class="$style.symbol" data-testid="token-symbol" :data-symbol="token.symbol">
				{{ token.symbol }}
			</span>
			<span v-if="fiatLabel" data-testid="token-fiat" :class="$style.fiat">{{ fiatLabel }}</span>
			<span v-else :class="$style.fiat">{{ token?.name || "unknown" }}</span>
		</Flex>

		<Flex
			v-if="isInitialSync && !syncFailed && !isMalformed"
			direction="column"
			align="end"
			justify="center"
			gap="5"
			data-testid="token-balance-loading"
			aria-busy="true"
			:class="$style.loading_block"
		>
			<Skeleton :width="64" :height="13" />
			<Skeleton :width="92" :height="9" />
		</Flex>
		<Flex v-else direction="column" align="end" gap="2">
			<span :class="[$style.amount, syncFailed && $style.amount_stale]" :data-malformed="isMalformed || undefined">{{ totalBalance || 0 }}</span>
			<span v-if="!isMalformed" :class="$style.detail">
				<span :class="$style.icon_private"><Icon name="lock" size="9" /></span>
				{{ privateFormatted }}
				<span :class="$style.pub_group">
					<span :class="$style.icon_public"><Icon name="globe" size="9" /></span>
					{{ publicFormatted }}
				</span>
			</span>
			<span v-if="syncFailed" :class="$style.failed_text" data-testid="token-balance-failed">
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

/* Symbol and subtitle are contract-supplied: clipped so a hostile string cannot push the
   balance off the row. */
.symbol {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.02em;
	color: var(--txt-primary);

	max-width: 160px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
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

	max-width: 160px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
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
</style>
