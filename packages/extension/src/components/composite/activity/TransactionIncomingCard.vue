<script setup>
/**
 * Incoming-receive card for the activity feed. Renders when an
 * `IncomingTransferService` record (a decrypted note from a trusted
 * fungible-token contract) appears on the user's account.
 *
 * Wraps `TransactionCardLayout` so field positions stay byte-identical
 * with the outgoing `TransactionCard`, the in-flight `TransactionAwaiting-
 * Card`, and the `TransactionTerminalCard`. Visual difference:
 *   - Activity-row icon = `download` (down-pointing arrow, the closest
 *     "incoming" semantic in `assets/icons.json`).
 *   - Status badge = green `check-circle` (mirrors the settled card's
 *     success state in incoming-positive coloring).
 *   - Title row carries a "Received" chip to distinguish from outgoing-
 *     transfer cards that show the privacy-direction chip.
 *
 * Amount displays with a "+" prefix so the user can scan the feed and
 * tell incoming from outgoing without reading direction.
 */

import TransactionCardLayout from "./TransactionCardLayout.vue"

import { balanceFormatted } from "@/utils/amount.js"

const props = defineProps({
	/** Token symbol — the card's title row. */
	tokenSymbol: { type: String, default: "Token" },
	/** Raw u128 amount (stringified decimal) from the note's `value` field. */
	amountRaw: { type: String, required: true },
	/** Token decimals — formats the displayed amount. */
	tokenDecimals: { type: Number, default: 0 },
	/** Transaction hash that delivered the note (for hash-slice rendering). */
	txHash: { type: String, default: null },
})

const formattedAmount = computed(() => {
	if (!props.amountRaw) return null
	return balanceFormatted(props.amountRaw, props.tokenDecimals, 8).value
})

const hashSlice = computed(() => {
	if (!props.txHash) return null
	return `${props.txHash.slice(0, 4)}...${props.txHash.slice(-4)}`
})
</script>

<template>
	<TransactionCardLayout
		:title="tokenSymbol"
		icon="download"
		:amount="formattedAmount ? `+${formattedAmount}` : null"
		:amountSymbol="tokenSymbol"
		testId="tx-incoming-card"
	>
		<template #badge>
			<Icon name="check-circle" size="12" color="green" />
		</template>

		<template #title-trailing>
			<span :class="$style.title_sep">·</span>
			<span :class="$style.chip">Received</span>
		</template>

		<template #secondary>
			<span v-if="hashSlice" :class="$style.hash">{{ hashSlice }}</span>
		</template>
	</TransactionCardLayout>
</template>

<style module>
.title_sep {
	font-family: var(--font-headline);
	font-size: 13px;
	color: var(--nulo-outline);
	user-select: none;
}

.chip {
	flex-shrink: 0;
	white-space: nowrap;

	font-family: var(--font-mono);
	font-size: 8px;
	text-transform: uppercase;
	color: var(--green, var(--nulo-accent));
	background: var(--nulo-surface-low);
	border: 1px solid rgba(74, 70, 63, 0.2);
	padding: 1px 4px;
}

.hash {
	font-family: var(--font-mono);
	font-size: 9px;
	text-transform: uppercase;
	color: var(--nulo-outline);
}
</style>
