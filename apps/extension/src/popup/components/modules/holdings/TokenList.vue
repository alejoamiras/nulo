<script setup lang="ts">
/**
 * The full token list: search, value/name sort, pinned rows above a rule, the rest in order, and
 * one fold that hides empty and under-dust rows. Presentational — the page owns the clients and
 * hands in rows, prices, the dust threshold and the pinned set. Local state resets on every mount.
 */
import type { PropType } from "vue"
import { computed, ref } from "vue"
import ListStatusMessage from "@/components/composite/ListStatusMessage.vue"
import TokenCard from "@/popup/components/modules/general/TokenCard.vue"
import { usdThresholdToMicro } from "@/utils/incoming-dust"
import { stringCompare } from "@/utils/string"
import { foldLabel, isHiddenHolding } from "@/utils/token-fold"
import { type OrderCtx, type OrderableRow, classifyRow, orderTokenRows } from "@/utils/token-order"
import { matchesQuery } from "@/utils/token-search"

/** What the list needs from a row; the page passes full `TokenBalanceInfo` rows. */
type Row = OrderableRow & { id: number | string }
// Callbacks receive the caller's own row type, so a `FiatOf<TokenBalanceInfo>` fits without a cast.
// biome-ignore lint/suspicious/noExplicitAny: variance escape hatch at the prop boundary; the template only reads OrderableRow fields.
type RowFn<R> = (tb: any) => R

const props = defineProps({
	rows: { type: Array as PropType<Row[]>, required: true },
	pinnedContracts: { type: Object as PropType<ReadonlySet<string>>, default: () => new Set<string>() },
	fiatOf: { type: Function as PropType<RowFn<bigint | undefined>>, required: true },
	/** Fresh USD rate per row for the dust fold; absent → the fold hides empties only. */
	usdRateOf: { type: Function as PropType<RowFn<number | undefined>>, default: () => () => undefined },
	dustThresholdUsd: { type: Number, default: 0 },
	/** Per-row catching-up flag from the page, when it tracks sync state. */
	backfilling: { type: Function as PropType<RowFn<boolean>>, default: () => () => false },
})

const query = ref("")
const sort = ref<"value" | "name">("value")
const showHidden = ref(false)

const ctx = computed<OrderCtx<Row>>(() => ({ pinnedContracts: props.pinnedContracts, fiatOf: props.fiatOf }))
const thresholdMicro = computed(() => usdThresholdToMicro(props.dustThresholdUsd))

const matching = computed(() => props.rows.filter((tb) => matchesQuery(tb.token, query.value)))

/** Value order comes from the shared comparator; name order is plain, with pins still first. */
const ordered = computed(() => {
	if (sort.value === "value") return orderTokenRows(matching.value, ctx.value)
	return [...matching.value].sort((a, b) => {
		const pa = classifyRow(a, ctx.value) === "pinned"
		const pb = classifyRow(b, ctx.value) === "pinned"
		if (pa !== pb) return pa ? -1 : 1
		return stringCompare(a.token.name, b.token.name)
	})
})

const partition = computed(() => {
	const pinned: Row[] = []
	const rest: Row[] = []
	const hidden: Row[] = []
	let empty = 0
	for (const tb of ordered.value) {
		if (classifyRow(tb, ctx.value) === "pinned") {
			pinned.push(tb)
		} else if (isHiddenHolding(tb, { ctx: ctx.value, usdRate: props.usdRateOf(tb), thresholdMicro: thresholdMicro.value })) {
			hidden.push(tb)
			if (classifyRow(tb, ctx.value) === "empty") empty += 1
		} else {
			rest.push(tb)
		}
	}
	return { pinned, rest, hidden, empty }
})

const label = computed(() =>
	foldLabel({
		hidden: partition.value.hidden.length,
		empty: partition.value.empty,
		dust: partition.value.hidden.length - partition.value.empty,
		thresholdUsd: props.dustThresholdUsd,
	}),
)
const showDivider = computed(() => partition.value.pinned.length > 0 && partition.value.rest.length > 0)
const noResults = computed(() => query.value.trim() !== "" && matching.value.length === 0)
const visibleCount = computed(() => matching.value.length)

const toggleSort = () => {
	sort.value = sort.value === "value" ? "name" : "value"
}
</script>

<template>
	<Flex direction="column" gap="12" :class="$style.wrapper">
		<div :class="$style.sticky">
			<label :class="$style.search">
				<MaterialIcon name="search" :size="16" color="secondary" />
				<input
					v-model="query"
					type="text"
					placeholder="Search tokens"
					maxlength="80"
					autocomplete="off"
					spellcheck="false"
					data-testid="holdings-search"
					:class="$style.search_input"
				/>
			</label>
		</div>

		<Flex align="end" justify="between">
			<span :class="$style.header_title">
				ALL HOLDINGS
				<span :class="$style.header_count" data-testid="holdings-count">{{ visibleCount }}</span>
			</span>
			<button type="button" @click="toggleSort" data-testid="holdings-sort" :data-sort="sort" :class="$style.sort">
				{{ sort === "value" ? "BY VALUE" : "A–Z" }}
			</button>
		</Flex>

		<Flex direction="column" :class="$style.list">
			<ListStatusMessage v-if="noResults" variant="no-results" testid="holdings-no-results" />
			<template v-else>
				<TokenCard v-for="tb in partition.pinned" :key="tb.id" :tokenBalance="tb" :backfilling="backfilling(tb)" />
				<div v-if="showDivider" :class="$style.divider" data-testid="token-list-divider" />
				<TokenCard v-for="tb in partition.rest" :key="tb.id" :tokenBalance="tb" :backfilling="backfilling(tb)" />
				<button
					v-if="label"
					type="button"
					@click="showHidden = !showHidden"
					data-testid="holdings-fold"
					:data-open="showHidden || undefined"
					:class="$style.fold"
				>
					<span>{{ label }}</span>
					<span :class="$style.fold_action">{{ showHidden ? "hide" : "show" }}</span>
				</button>
				<template v-if="showHidden">
					<TokenCard v-for="tb in partition.hidden" :key="tb.id" :tokenBalance="tb" :backfilling="backfilling(tb)" />
				</template>
			</template>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	/* no extra styling needed */
}

.sticky {
	position: sticky;
	top: 0;
	z-index: 2;

	padding: 4px 0 6px;
	background: var(--app-bg);
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;

	height: 36px;
	padding: 0 10px;
	border: 1px solid var(--nulo-outline);
	background: var(--nulo-surface);
	cursor: text;
}

.search_input {
	flex: 1;
	min-width: 0;

	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);

	&::placeholder {
		color: var(--nulo-outline);
	}
}

.header_title {
	display: inline-flex;
	align-items: baseline;
	gap: 8px;

	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.header_count {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 400;
	letter-spacing: 0;
	color: var(--nulo-outline);
}

.sort {
	height: 20px;
	padding: 0 8px;
	background: var(--nulo-surface-high);

	font-family: var(--font-mono);
	font-size: 10px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--txt-primary);
	cursor: pointer;
}

.list {
	gap: 1px;
}

.divider {
	border-top: 1px dashed var(--nulo-border);
	margin: 4px 0;
}

.fold {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;

	padding: 10px 0;
	border-top: 1px dashed var(--nulo-border);
	background: transparent;
	cursor: pointer;
	text-align: left;

	font-family: var(--font-mono);
	font-size: 10px;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
	}
}

.fold_action {
	color: var(--nulo-outline);
}
</style>
