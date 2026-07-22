<script setup>
/**
 * Date-grouped activity list (Archives page).
 *
 * Accepts a discriminated row model from the parent so on-chain
 * transactions and journal terminal records share one date-sorted
 * timeline. Phase 2 follow-up split this from the prior "transactions
 * array only" prop after codex caught that journal terminal records
 * have no `hash` to navigate to and would break a "lightly extended"
 * implementation.
 *
 *   type ActivityRow =
 *     | { type: "tx";      key: string; sortKey: number; tx:  Transaction; navigable: true  }
 *     | { type: "journal"; key: string; sortKey: number; op:  OperationRecord; navigable: false }
 *
 * The parent (`activity.vue`) computes the rows + merges sources;
 * this component just groups by date and renders the right card per
 * type. Only "tx" rows are clickable (they have a /popup/tx/:hash
 * detail page); journal terminal rows are display-only here.
 */
import { DateTime } from "luxon"
import TransactionCard from "./TransactionCard.vue"
import TransactionTerminalCard from "@/components/composite/activity/TransactionTerminalCard.vue"
import TransactionIncomingCard from "@/components/composite/activity/TransactionIncomingCard.vue"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { usePrices } from "@/composables/usePrices"
import { buildJournalTerminalCardProps } from "@/utils/journal-state"

const router = useRouter()

const props = defineProps({
	/** Mixed row list — discriminated by `type`. Parent owns the merge.
	 *  `sortKey` is the millisecond timestamp used for ordering + date grouping. */
	rows: { type: Array, required: true },
	/** Token lookup map (id → Token) used by terminal transfer rows to
	 *  format amounts. Optional — when absent, transfer cards render
	 *  without amount info (graceful degradation). Phase 2 follow-up v4. */
	tokensById: { type: Object, default: () => ({}) },
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

const handleSelectRow = (row) => {
	// Three detail surfaces:
	//   tx/:hash      — rows backed by an on-chain tx
	//   journal/:id   — terminal journal records (no chain tx exists)
	//   tokens/:id    — incoming-receive rows route to the token-detail
	//                   page rather than a per-receive detail (cleaner UX
	//                   given there's no fee / block-explorer / per-row
	//                   debug info to surface).
	if (row.type === "tx") {
		router.push(`/popup/tx/${row.tx.hash}`)
		return
	}
	if (row.type === "journal") {
		router.push(`/popup/journal/${row.op.id}`)
		return
	}
	if (row.type === "incoming" && row.inc.tokenId !== undefined) {
		router.push(`/popup/tokens/${row.inc.tokenId}`)
	}
}

const priceService = new PriceServiceClient()
const prices = usePrices(priceService)
onBeforeUnmount(() => {
	prices.dispose()
	priceService.disconnect()
})
function incomingCardProps(inc) {
	const token = props.tokensById[inc.tokenId]
	return {
		tokenSymbol: token?.symbol || "Token",
		amountRaw: inc.amountRaw,
		tokenDecimals: token?.decimals || 0,
		txHash: inc.txHash,
		amountFiat: token ? (prices.tokenFiatLabel(token, BigInt(inc.amountRaw || 0)) ?? null) : null,
	}
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
				<TransactionCard v-if="row.type === 'tx'" :tx="row.tx" @click="handleSelectRow(row)" />
				<TransactionIncomingCard
					v-else-if="row.type === 'incoming'"
					v-bind="incomingCardProps(row.inc)"
					@click="handleSelectRow(row)"
				/>
				<TransactionTerminalCard
					v-else-if="row.type === 'journal' && terminalCardProps(row.op)"
					v-bind="terminalCardProps(row.op)"
					@click="handleSelectRow(row)"
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
