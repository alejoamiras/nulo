<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import type { LookupState } from "@/composables/useAddressLookup"
import { formatBigInt, trimAddress } from "@/lib/format"
import type { Direction, ResolvedToken, SelectableToken, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import { checksumAddress, safeDisplay } from "@/lib/token-display"

/** Components */
import TokenList from "./TokenList.vue"
import { monogramBackground } from "./token-sprite"

const props = defineProps<{
	direction: Direction
	tokens: SelectableToken[]
	search: string
	loading: boolean
	catalogError: string | null
	/** What the search resolved to while it holds an address the list does not have. */
	lookup: LookupState | null
	/** What the catalog said when a looked-up address was added (a duplicate, the zero address, …). */
	addError: string | null
	selected: SelectableToken | null
	resolved: ResolvedToken | null
	resolving: boolean
	selectionError: string | null
	balances: TokenBalances
	/** Ethereum balances behind the rows, keyed by `logoKey`. */
	rowBalances?: Record<string, bigint>
}>()
const emit = defineEmits<{
	"update:search": [value: string]
	select: [token: SelectableToken]
	add: [address: string]
	next: []
}>()

const isExit = computed(() => props.direction === "l2-to-l1")

const symbol = computed(() => safeDisplay(props.resolved?.symbol ?? props.selected?.symbol ?? ""))

const decimals = computed(() => props.resolved?.decimals ?? props.selected?.decimals ?? -1)

function balanceText(value: bigint | undefined): string {
	if (value === undefined || decimals.value < 0) return "—"
	return `${formatBigInt(value, decimals.value)} ${symbol.value}`.trim()
}

// The looked-up strings are whatever the contract answered: clamped and stripped before they render,
// and never shown without the address they belong to.
const found = computed(() => {
	const state = props.lookup
	if (!state || state.status !== "found") return null
	return { symbol: safeDisplay(state.identity.symbol), name: safeDisplay(state.identity.name), decimals: state.identity.decimals }
})

const lookupAddress = computed(() => (props.lookup ? checksumAddress(props.lookup.address) : ""))
const lookupShort = computed(() => (props.lookup ? trimAddress(lookupAddress.value, 8, 6) : ""))
const lookupInitials = computed(() => found.value?.symbol.slice(0, 2).toUpperCase() || "??")
const lookupMark = computed(() => ({ background: props.lookup ? monogramBackground(props.lookup.logoKey) : undefined }))

const canContinue = computed(() => props.resolved !== null && !props.resolving)
</script>

<template>
	<section class="step" :data-testid="TESTIDS.sendStepToken" :data-direction="direction">
		<label class="search">
			<svg class="glass" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="7" cy="7" r="4.5" />
				<path d="M10.5 10.5 14 14" />
			</svg>
			<input
				class="field"
				type="search"
				aria-label="Search tokens"
				autocomplete="off"
				spellcheck="false"
				placeholder="Search a token, or paste its Ethereum address"
				:value="search"
				:data-testid="TESTIDS.sendTokenSearch"
				@input="emit('update:search', ($event.target as HTMLInputElement).value)"
			/>
		</label>

		<p v-if="catalogError" class="err" aria-live="polite" :data-testid="TESTIDS.sendCatalogError">{{ catalogError }}</p>

		<div v-if="lookup" class="lookup" aria-live="polite" :data-testid="TESTIDS.sendTokenLookup" :data-status="lookup.status">
			<template v-if="found">
				<span class="mark" aria-hidden="true" :style="lookupMark">{{ lookupInitials }}</span>
				<span class="ident">
					<span class="symbol">
						{{ found.symbol }}
						<span class="meta">· {{ found.name }} · {{ found.decimals }} decimals</span>
					</span>
					<span class="address" :title="lookupAddress">{{ lookupShort }}</span>
				</span>
				<button type="button" class="add" :data-testid="TESTIDS.sendLookupAdd" @click="emit('add', lookup.address)">ADD</button>
			</template>
			<span v-else-if="lookup.status === 'reading'" class="note">Reading {{ lookupShort }}…</span>
			<span v-else-if="lookup.status === 'error'" class="err">{{ lookup.message }}</span>
		</div>
		<p v-if="found" class="note">Not in your list yet. Add it and it stays here, with its address, for next time.</p>
		<p v-if="addError" class="err" aria-live="polite" :data-testid="TESTIDS.sendLookupError">{{ addError }}</p>

		<TokenList
			v-if="!lookup"
			:tokens="tokens"
			:selected="selected"
			:loading="loading"
			:balances="rowBalances"
			:empty="tokens.length === 0"
			@select="emit('select', $event)"
		/>

		<p v-if="selectionError" class="err" aria-live="polite" :data-testid="TESTIDS.sendSelectionError">{{ selectionError }}</p>

		<div class="foot">
			<p class="summary" aria-live="polite" :data-testid="TESTIDS.sendTokenSummary">
				<template v-if="resolving">Reading this token…</template>
				<template v-else-if="selected && !isExit">
					Sending {{ symbol }} · balance on Ethereum
					<span :data-testid="TESTIDS.sendBalanceL1">{{ balanceText(balances.l1) }}</span>
				</template>
				<template v-else-if="selected">
					Sending {{ symbol }} · private
					<span :data-testid="TESTIDS.sendBalanceL2Private">{{ balanceText(balances.l2Private) }}</span>
					· public
					<span :data-testid="TESTIDS.sendBalanceL2Public">{{ balanceText(balances.l2Public) }}</span>
				</template>
			</p>
			<button type="button" class="next" :disabled="!canContinue" :data-testid="TESTIDS.sendTokenNext" @click="emit('next')">CONTINUE</button>
		</div>
	</section>
</template>

<style scoped>
.step {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.search {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid var(--nulo-outline);
}

.search:focus-within {
	border-color: var(--nulo-accent);
}

.glass {
	flex: none;
	width: 16px;
	height: 16px;
	fill: none;
	stroke: var(--txt-secondary);
	stroke-width: 1.5;
}

.field {
	flex: 1;
	min-width: 0;
	padding: 0;
	background: transparent;
	border: none;
	outline: none;
	color: var(--txt-primary);
	font: 500 13px/1.3 var(--font-mono);
}

.field::placeholder {
	color: var(--txt-tertiary);
}

.lookup {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 12px;
	border: 1px dashed var(--nulo-accent);
	background: var(--nulo-surface-low);
}

.mark {
	display: flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 28px;
	height: 28px;
	color: var(--txt-white);
	font: 700 11px/1 var(--font-mono);
	letter-spacing: 0.04em;
}

.ident {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.symbol {
	font: 600 13px/1.2 var(--font-mono);
	color: var(--txt-primary);
}

.meta {
	font-weight: 500;
	color: var(--txt-secondary);
}

.address {
	font: 500 10px/1.2 var(--font-mono);
	color: var(--txt-tertiary);
	letter-spacing: 0.02em;
}

.add {
	margin-left: auto;
	padding: 8px 14px;
	background: transparent;
	border: 1px solid var(--nulo-accent);
	color: var(--nulo-accent);
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	cursor: pointer;
}

.add:hover {
	background: var(--nulo-accent);
	color: var(--txt-inverse);
}

.note {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.err {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--red);
}

.foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.summary {
	margin: 0;
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.next {
	flex: none;
	padding: 12px 20px;
	background: var(--nulo-accent);
	border: 1px solid var(--nulo-accent);
	color: var(--txt-inverse);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.next:disabled {
	background: transparent;
	border-color: var(--nulo-outline);
	color: var(--txt-secondary);
	cursor: not-allowed;
}
</style>
