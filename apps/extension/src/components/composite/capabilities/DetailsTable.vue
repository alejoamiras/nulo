<script setup lang="ts">
/**
 * The Details fold: every contract the app would reach, once, with a mark per permission that
 * includes it, and on opening a row the functions it listed. Function names and unknown addresses
 * are the app's own strings: control and bidi characters are stripped before they show.
 */
import { trimAddress } from "@/utils/string"
import { sanitizeWireString, stripWireControl } from "@/wallet/services/dapp-session/capability-meta"
import RowTarget from "@/components/ui/RowTarget.vue"
import CapabilityDisclosure from "./CapabilityDisclosure.vue"

type Row = { address?: string; name?: string; simulate: readonly string[]; add: boolean; transact: readonly string[] }

const props = defineProps<{
	known: readonly Row[]
	unknown: readonly Row[]
	anyContract: Row | null
	/** "any contract", or the count of listed contracts. */
	label: string
}>()

const emit = defineEmits<{ copy: [address: string] }>()

type Entry = { kind: "sub"; key: string; text: string } | { kind: "row"; key: string; row: Row; named: boolean }

/** Keys double as id suffixes, so they hold no whitespace. */
const section = (key: "known" | "unknown", text: string, rows: readonly Row[]): Entry[] =>
	rows.length === 0
		? []
		: [{ kind: "sub", key, text }, ...rows.map((row, i): Entry => ({ kind: "row", key: `${key}-${i}`, row, named: key === "known" }))]

/** "Any contract" goes last, under no sub-header. */
const entries = computed<Entry[]>(() => [
	...section("known", "Nulo knows", props.known),
	...section("unknown", "Nulo doesn't know", props.unknown),
	...(props.anyContract ? [{ kind: "row" as const, key: "any", row: props.anyContract, named: true }] : []),
])

const opened = ref(new Set<string>())

const toggle = (key: string) => {
	const next = new Set(opened.value)
	if (!next.delete(key)) next.add(key)
	opened.value = next
}

const uid = useId()

const shownAddress = (address: string | undefined) => trimAddress(sanitizeWireString(address ?? "", 128), 6, 4, "…")

const functions = (names: readonly string[]) => names.map((name) => sanitizeWireString(name, 64)).join(" · ")

const COLUMNS = [
	["simulate", (row: Row) => row.simulate.length > 0],
	["add", (row: Row) => row.add],
	["transact", (row: Row) => row.transact.length > 0],
] as const

/** A named row's target reads "{name}: {columns}", since the head is hidden from screen readers. */
const spokenName = (row: Row) =>
	`${row.name}: ${COLUMNS.filter(([, has]) => has(row))
		.map(([column]) => column)
		.join(", ")}`
</script>

<template>
	<CapabilityDisclosure label="Details" :tag="label" testid="cap-detail-toggle">
		<div :class="$style.table">
			<div :class="[$style.grid, $style.head]" aria-hidden="true">
				<span>Contract</span>
				<span>Simulate</span>
				<span>Add</span>
				<span>Transact</span>
				<span />
			</div>

			<template v-for="entry in entries" :key="entry.key">
				<div v-if="entry.kind === 'sub'" :class="$style.sub">{{ entry.text }}</div>

				<template v-else>
					<div :class="[$style.grid, $style.row, opened.has(entry.key) && $style.open]" @click="toggle(entry.key)">
						<RowTarget
							:labelledby="`${uid}-${entry.key}`"
							:aria-expanded="opened.has(entry.key)"
							data-testid="cap-details-row"
							:data-details-key="entry.key"
						/>

						<template v-if="entry.named">
							<span :id="`${uid}-${entry.key}`" hidden>{{ spokenName(entry.row) }}</span>
							<span :class="$style.name">{{ entry.row.name }}</span>
						</template>
						<span v-else :class="$style.address">
							<span :id="`${uid}-${entry.key}`">{{ shownAddress(entry.row.address) }}</span>
							<RowAction
								label="Copy address"
								tabindex="-1"
								data-testid="cap-details-copy"
								:data-details-key="entry.key"
								:class="$style.copy"
								@click="emit('copy', stripWireControl(entry.row.address ?? ''))"
							>
								<MaterialIcon name="content_copy" :size="12" :class="$style.copy_glyph" aria-hidden="true" />
							</RowAction>
						</span>

						<template v-for="[column, has] in COLUMNS" :key="column">
							<MaterialIcon v-if="has(entry.row)" name="check" :size="15" :class="$style.yes" aria-hidden="true" />
							<span v-else :class="$style.no" aria-hidden="true" />
						</template>

						<MaterialIcon name="chevron_right" :size="14" :class="$style.chevron" aria-hidden="true" />
					</div>

					<div v-if="opened.has(entry.key)" data-testid="cap-details-fns" :class="$style.fns">
						<div v-if="entry.row.simulate.length" :class="$style.fn">
							<span :class="$style.fn_label">Simulate</span>
							<span :class="$style.fn_names">{{ functions(entry.row.simulate) }}</span>
						</div>
						<div v-if="entry.row.transact.length" :class="$style.fn">
							<span :class="$style.fn_label">Transact</span>
							<span :class="$style.fn_names">{{ functions(entry.row.transact) }}</span>
						</div>
					</div>
				</template>
			</template>

			<div :class="$style.foot">
				Function names come from the app. Anything it didn't list is refused instantly; you won't be asked.
			</div>
		</div>
	</CapabilityDisclosure>
</template>

<style module>
.table {
	--hairline-soft: rgba(74, 70, 63, 0.2);

	display: flex;
	flex-direction: column;
}

:global([theme="light"]) .table {
	--hairline-soft: rgba(124, 116, 104, 0.2);
}

.grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 54px 34px 54px 14px;
	align-items: center;
	column-gap: 4px;
}

.head {
	padding-bottom: 6px;

	font-family: var(--font-mono);
	font-size: 8.5px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--nulo-outline);
}

.head > span + span {
	text-align: center;
}

.sub {
	padding: 10px 0 5px;
	border-bottom: 1px solid var(--hairline-soft);

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.row {
	position: relative;
	min-height: 30px;
	border-bottom: 1px solid var(--hairline-soft);
	cursor: pointer;
}

.row:hover {
	background: var(--nulo-surface-low);
}

.row:has(> [data-row-target]:focus-visible) {
	outline: 1px solid var(--txt-primary);
	outline-offset: -1px;
}

.name {
	overflow: hidden;

	font-size: 12px;
	font-weight: 600;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--txt-primary);
}

.address {
	display: inline-flex;
	align-items: center;
	gap: 6px;

	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--txt-primary);
}

/* The 24px box centres a 12px glyph: pulled in by the difference, the glyph sits 6px from the text. */
.address .copy {
	margin: -6px;
}

/* Two classes, so the icon's own color utility never decides. */
.address .copy_glyph {
	color: var(--nulo-outline);
}

.row .yes {
	justify-self: center;
	color: var(--nulo-secondary);
}

.no {
	justify-self: center;
	width: 8px;
	height: 1px;
	background: var(--nulo-outline);
}

.row .chevron {
	color: var(--nulo-outline);
	transition: transform 0.2s var(--bezier);
}

.row.open .chevron {
	transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
	.row .chevron {
		transition: none;
	}
}

.fns {
	display: flex;
	flex-direction: column;
	gap: 5px;

	padding: 7px 0 10px;
	border-bottom: 1px solid var(--hairline-soft);
}

.fn {
	display: grid;
	grid-template-columns: 58px minmax(0, 1fr);
	gap: 8px;

	font-family: var(--font-mono);
	font-size: 10px;
	line-height: 1.5;
}

.fn_label {
	padding-top: 1px;

	font-size: 8.5px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--nulo-outline);
}

.fn_names {
	overflow-wrap: anywhere;
	color: var(--txt-tertiary);
}

.foot {
	margin-top: 10px;

	font-size: 11px;
	line-height: 1.45;
	color: var(--txt-tertiary);
}
</style>
