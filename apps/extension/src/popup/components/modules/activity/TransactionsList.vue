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
import { activityRowRoute } from "@/utils/activity-rows"
import { buildJournalTerminalCardProps } from "@/utils/journal-state"
import { buildIncomingCardProps } from "@/utils/received-display"

const props = defineProps({
	rows: { type: Array, required: true },
	/** The current profile and chain's tokens: a mint, journal transfer or received row shows an
	 *  amount only for a token in this list. */
	tokens: { type: Array, default: () => [] },
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
	return buildIncomingCardProps(inc, props.tokens, prices.tokenFiatLabel)
}

const tokensById = computed(() => new Map(props.tokens.map((t) => [t.id, t])))
function terminalCardProps(op) {
	return buildJournalTerminalCardProps(op, { tokenById: (id) => tokensById.value.get(id) })
}
</script>

<template>
	<Flex direction="column" gap="24">
		<Flex v-for="group in groupedRows" :key="group.date" direction="column" gap="10">
			<Flex align="center" gap="12" :class="$style.date_separator">
				<span :class="$style.date_label" data-testid="activity-date-label">{{ group.date }}</span>
				<div :class="$style.separator_line" />
			</Flex>

			<template v-for="row in group.rows" :key="row.key">
				<TransactionCard v-if="row.type === 'tx'" :tx="row.tx" :tokens="tokens" :to="activityRowRoute(row)" />
				<TransactionIncomingCard
					v-else-if="row.type === 'incoming'"
					v-bind="incomingCardProps(row.inc)"
					:to="activityRowRoute(row)"
					:arriving="isArriving?.(row.inc) ?? false"
				/>
				<TransactionTerminalCard
					v-else-if="row.type === 'journal' && terminalCardProps(row.op)"
					v-bind="terminalCardProps(row.op)"
					:to="activityRowRoute(row)"
				/>
			</template>
		</Flex>
	</Flex>
</template>

<style module>
.date_separator {
	padding-bottom: 2px;
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
