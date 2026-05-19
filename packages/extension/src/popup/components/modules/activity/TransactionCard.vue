<script setup>
/**
 * Settled phase of an activity card. Wraps `TransactionCardLayout` so its
 * field positions match the in-flight phase (`TransactionAwaitingCard`) —
 * title row stays put across the lifecycle; only badge + secondary-row
 * content swap from spinner+status-text to status-icon+hash-and-chips.
 */
/** Vendor */

/** Components */
import TransactionCardLayout from "@/components/composite/activity/TransactionCardLayout.vue"

/** Services */
import { OriginType, TxStatus, TxExecutionResult } from "@/wallet/services/transaction/client"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { getTransactionExplorerUrl } from "@/wallet/constants/explorers"
import { getTxCategory, getTxTitle, getOriginLabel, getPrimaryCall, formatTransferType } from "@/utils/tx-enrichment"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const props = defineProps({
	tx: {
		type: Object,
	},
})

const call = computed(() => getPrimaryCall(props.tx.calls))
const type = computed(() => getTxCategory(props.tx.calls))
const transfer = computed(() => (call.value?.transfers ? call.value.transfers[0] : null))
const token = computed(() => transfer.value?.token)
const transferAmount = computed(() => {
	if (transfer.value) {
		return balanceFormatted(transfer.value.amount || 0, token.value?.decimals || 0, 8).value
	}

	return 0
})

const mintAmount = computed(() => {
	if (type.value !== "mint") return 0

	const decimals = props.tx?.origin?.type === OriginType.UI ? 8 : 0
	// Sum raw base units in bigint domain; format once at the end.
	let amount = 0n
	for (const c of props.tx.calls) {
		const last = c.args?.at(-1)
		if (last !== undefined && last !== null) amount += BigInt(last)
	}

	return balanceFormatted(amount, decimals, 8).value
})

const icon = computed(() => {
	if (type.value === "transfer") return "arrow-narrow-up-right"
	if (type.value === "mint") return "faucet"
	return "zap"
})

const isMined = computed(() => {
	const s = props.tx.status
	return s === TxStatus.Proposed || s === TxStatus.Checkpointed || s === TxStatus.Proven || s === TxStatus.Finalized
})
const isPending = computed(() => props.tx.status === TxStatus.Pending)
const isDropped = computed(() => props.tx.status === TxStatus.Dropped)
const isReverted = computed(() => isMined.value && !!props.tx.executionResult && props.tx.executionResult !== TxExecutionResult.Success)
const isSuccess = computed(() => isMined.value && !isReverted.value)

const statusIcon = computed(() => {
	if (isReverted.value || isDropped.value) return "close-circle"
	if (isSuccess.value) return "check-circle"
	return "clock-circle"
})

const statusColor = computed(() => {
	if (isReverted.value || isDropped.value) return "red"
	if (isSuccess.value) return "green"
	return "gray"
})

/**
 * User-visible status string mirroring the status-icon state machine.
 * Bound as `data-tx-status` on the card root so e2e tests synchronize on
 * the same fact the user sees (the green/red/clock icon). "confirmed"
 * here means first-mined (Proposed | Checkpointed | Proven | Finalized),
 * which matches when the green check appears — NOT on-chain finality.
 * Explicit "unknown" fallthrough because Vue omits attribute bindings
 * whose value is undefined, which would make a missing attribute
 * indistinguishable from a real state in test selectors.
 */
const txStatusAttr = computed(() => {
	if (isPending.value) return "pending"
	if (isSuccess.value) return "confirmed"
	if (isReverted.value || isDropped.value) return "failed"
	return "unknown"
})

const title = computed(() => {
	// For transfers, show token symbol instead of generic "Transfer"
	if (type.value === "transfer" && token.value?.symbol) return token.value.symbol
	return getTxTitle(props.tx.calls)
})

const transferTypeLabel = computed(() => {
	if (type.value === "transfer" && transfer.value) return formatTransferType(transfer.value.type)
	return null
})

const originLabel = computed(() => getOriginLabel(props.tx.origin))
const hashSlice = computed(() => {
	if (!props.tx.hash) return null
	return `${props.tx.hash.slice(0, 4)}...${props.tx.hash.slice(-4)}`
})

const explorerUrl = computed(() => {
	if (!appStore.network?.chainId) return null

	return getTransactionExplorerUrl(appStore.network.chainId, appStore.defaultExplorer, props.tx.hash)
})

/** The amount column shows transfer amount or mint amount; nothing for other tx types. */
const displayAmount = computed(() => {
	if (type.value === "transfer" && token.value) return transferAmount.value
	if (type.value === "mint") return mintAmount.value
	return null
})
const displayAmountSymbol = computed(() => {
	if (type.value === "transfer" && token.value?.symbol) return token.value.symbol
	return null
})

const amountStr = computed(() => (displayAmount.value !== null ? String(displayAmount.value) : null))
</script>

<template>
	<div :class="$style.row">
		<TransactionCardLayout
			:title="title"
			:icon="icon"
			:amount="amountStr"
			:amountSymbol="displayAmountSymbol"
			testId="tx-card"
			:txAmountDisplay="amountStr"
			:txTransferTypeLabel="transferTypeLabel"
			:txStatus="txStatusAttr"
			:txHash="props.tx.hash"
		>
			<template #badge>
				<Icon :name="statusIcon" size="12" :color="statusColor" :class="$style.status_icon" />
			</template>

			<template v-if="transferTypeLabel || originLabel" #title-trailing>
				<!-- Chip stays in the title row across the lifecycle so it
				     doesn't visually jump when the tx confirms. The dot is a
				     subtle visual separator so "USDC" and "Private → Public"
				     don't read as one continuous string.
				     For the settled card the two labels are INDEPENDENT (not
				     mutually exclusive like on the journal-driven awaiting /
				     terminal cards): `transferTypeLabel` is derived from the
				     call shape and `originLabel` from `tx.origin`. A
				     dApp-initiated transfer sets both — render both so the
				     dApp identity isn't silently dropped. -->
				<span :class="$style.title_sep">·</span>
				<span v-if="transferTypeLabel" :class="$style.chip">{{ transferTypeLabel }}</span>
				<span v-if="originLabel" :class="$style.chip">{{ originLabel }}</span>
			</template>

			<template #secondary>
				<span v-if="hashSlice && explorerUrl" :class="$style.hash_group">
					<span :class="$style.hash">{{ hashSlice }}</span>
					<a
						:href="explorerUrl"
						target="_blank"
						rel="noopener noreferrer"
						@click.stop
						:class="$style.explorer_link"
						aria-label="Open in block explorer"
					>
						<Icon name="external-link" size="10" color="tertiary" />
					</a>
				</span>
				<span v-else-if="hashSlice" :class="$style.hash">{{ hashSlice }}</span>
			</template>
		</TransactionCardLayout>
	</div>
</template>

<style module>
.row {
	cursor: pointer;
	transition: background 0.2s var(--bezier);

	&:hover {
		background: rgba(29, 27, 26, 0.5);
	}
}

.status_icon {
	/* Inherits the absolute-positioned badge wrapper from TransactionCardLayout */
}

/* Inline group so the explorer link rides immediately after the hash slice,
 * not as a separate flex item. Gap is tighter than the secondary row's so
 * the icon visually attaches to the hash. */
.hash_group {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.hash {
	font-family: var(--font-mono);
	font-size: 9px;
	text-transform: uppercase;
	color: var(--nulo-outline);
}

/* Subtle separator between the title and the title-trailing chip.
 * Matches the body/headline rhythm without competing with the title text. */
.title_sep {
	font-family: var(--font-headline);
	font-size: 13px;
	color: var(--nulo-outline);
	user-select: none;
}

.chip {
	font-family: var(--font-mono);
	font-size: 8px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	background: var(--nulo-surface-low);
	border: 1px solid rgba(74, 70, 63, 0.2);
	padding: 1px 4px;
}

.explorer_link {
	display: flex;
	align-items: center;
	text-decoration: none;

	transition: opacity 0.2s var(--bezier);

	&:hover {
		opacity: 0.7;
	}
}
</style>
