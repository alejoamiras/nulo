<script setup>
/**
 * Date-grouped activity list (Archives page). Rows are a discriminated union the parent merges:
 * `{ type: "tx", tx }`, `{ type: "journal", op }` and `{ type: "incoming", inc }`, each with a
 * `key` and a millisecond `sortKey` for ordering and date grouping.
 */
import { DateTime } from "luxon"
import TransactionCard from "./TransactionCard.vue"
import TransactionTerminalCard from "@/components/composite/activity/TransactionTerminalCard.vue"
import TransactionIncomingCard from "@/components/composite/activity/TransactionIncomingCard.vue"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { usePrices } from "@/composables/usePrices"
import { buildJournalTerminalCardProps } from "@/utils/journal-state"
import { buildIncomingCardProps } from "@/utils/received-display"

const props = defineProps({
	rows: { type: Array, required: true },
	/** Token lookup map (id → Token) used by terminal transfer rows to
	 *  format amounts. Optional — when absent, transfer cards render
	 *  without amount info (graceful degradation). */
	tokensById: { type: Object, default: () => ({}) },
	/** Whether an incoming row's receipt is arriving now; judged when the row renders. */
	isArriving: { type: Function, default: undefined },
})

const groupedRows = computed(() => {
	if (!props.rows?.length) return []
	const groups = new Map()
	for (const row of props.rows) {
		const dateKey = DateTime.fromMillis(row.sortKey).toFormat("MMM d, yyyy").toUpperCase()
		if (!groups.has(dateKey)) {
			groups.set(dateKey, [])
		}
		groups.get(dateKey).push(row)
	}
	return Array.from(groups, ([date, rows]) => ({ date, rows }))
})

const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
onBeforeUnmount(() => {
	prices.dispose()
	priceService.disconnect()
})
function incomingCardProps(inc) {
	const token = props.tokensById[inc.tokenId]
	return buildIncomingCardProps(inc, token, token ? (prices.tokenFiatLabel(token, BigInt(inc.amountRaw || 0)) ?? null) : null)
}

/** Map a journal record row → TransactionTerminalCard props via the shared
 *  helper. Previously this file inlined a byte-identical duplicate of
 *  RecentActivityView's resolver; the shared helper closes the drift surface. */
function terminalCardProps(op) {
	return buildJournalTerminalCardProps(op, { tokenById: (id) => props.tokensById[id] })
}
</script>

<template>
	<Flex direction="column" gap="24">
		<Flex v-for="group in groupedRows" :key="group.date" direction="column" gap="4">
			<!-- Date separator -->
			<Flex align="center" gap="12" :class="$style.date_separator">
				<span :class="$style.date_label">{{ group.date }}</span>
				<div :class="$style.separator_line" />
			</Flex>

			<!-- Rows for this date — branch on type. -->
			<template v-for="row in group.rows" :key="row.key">
				<TransactionCard v-if="row.type === 'tx'" :tx="row.tx" :to="`/popup/tx/${row.tx.hash}`" />
				<TransactionIncomingCard
					v-else-if="row.type === 'incoming'"
					v-bind="incomingCardProps(row.inc)"
					:to="`/popup/received/${row.inc.id}`"
					:arriving="isArriving?.(row.inc) ?? false"
				/>
				<TransactionTerminalCard
					v-else-if="row.type === 'journal' && terminalCardProps(row.op)"
					v-bind="terminalCardProps(row.op)"
					:to="`/popup/journal/${row.op.id}`"
				/>
			</template>
		</Flex>
	</Flex>
</template>

<style module>
.date_separator {
	padding-bottom: 8px;
}

.date_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.15em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	flex-shrink: 0;
}

.separator_line {
	flex: 1;
	height: 1px;
	background: var(--nulo-border);
}
</style>
