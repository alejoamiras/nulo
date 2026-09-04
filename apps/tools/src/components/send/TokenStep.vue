<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import type { CatalogProvenance } from "@/composables/useTokenCatalog"
import { formatBigInt } from "@/lib/format"
import type { Direction, ResolvedToken, SelectableToken, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

/** Components */
import PasteAddress from "./PasteAddress.vue"
import TokenList from "./TokenList.vue"

const props = defineProps<{
	direction: Direction
	tokens: SelectableToken[]
	search: string
	provenance: CatalogProvenance
	loading: boolean
	catalogError: string | null
	selected: SelectableToken | null
	resolved: ResolvedToken | null
	resolving: boolean
	selectionError: string | null
	balances: TokenBalances
	pasteError: string | null
}>()
const emit = defineEmits<{
	"update:search": [value: string]
	select: [token: SelectableToken]
	paste: [address: string]
	next: []
}>()

const isExit = computed(() => props.direction === "l2-to-l1")

const symbol = computed(() => props.resolved?.symbol ?? props.selected?.symbol ?? "")

const decimals = computed(() => props.resolved?.decimals ?? props.selected?.decimals ?? -1)

function balanceText(value: bigint | undefined): string {
	if (value === undefined || decimals.value < 0) return "—"
	return `${formatBigInt(value, decimals.value)} ${symbol.value}`.trim()
}

// The state a token is in decides how long its first send takes and what it costs. Said in outcome
// terms here; the mechanism belongs to the review's details.
const STATE_LABEL = {
	registered: "Ready to send",
	"portal-only": "Almost ready — your send finishes the setup",
	"first-time": "First time for this token — it takes a little longer",
} as const

const stateLabel = computed(() => (props.resolved ? STATE_LABEL[props.resolved.state.kind] : null))

const canContinue = computed(() => props.resolved !== null && !props.resolving)
</script>

<template>
	<section class="step" :data-testid="TESTIDS.sendStepToken" :data-direction="direction">
		<input
			class="search"
			type="search"
			aria-label="Search tokens"
			placeholder="Search by symbol, name or address"
			:value="search"
			:data-testid="TESTIDS.sendTokenSearch"
			@input="emit('update:search', ($event.target as HTMLInputElement).value)"
		/>

		<p v-if="catalogError" class="err" aria-live="polite" :data-testid="TESTIDS.sendCatalogError">{{ catalogError }}</p>

		<TokenList
			:tokens="tokens"
			:selected="selected"
			:loading="loading"
			:provenance="provenance"
			:empty="tokens.length === 0"
			@select="emit('select', $event)"
		/>

		<PasteAddress :error="pasteError" @paste="emit('paste', $event)" />

		<p v-if="resolving" class="status" aria-live="polite">Reading this token…</p>
		<p v-else-if="stateLabel" class="status" :data-testid="TESTIDS.sendTokenState" :data-state="resolved?.state.kind">{{ stateLabel }}</p>
		<p v-if="selectionError" class="err" aria-live="polite" :data-testid="TESTIDS.sendSelectionError">{{ selectionError }}</p>

		<div v-if="selected" class="balances">
			<span v-if="!isExit" class="balance" :data-testid="TESTIDS.sendBalanceL1">Ethereum: {{ balanceText(balances.l1) }}</span>
			<template v-else>
				<span class="balance" :data-testid="TESTIDS.sendBalanceL2Private">Private: {{ balanceText(balances.l2Private) }}</span>
				<span class="balance" :data-testid="TESTIDS.sendBalanceL2Public">Public: {{ balanceText(balances.l2Public) }}</span>
			</template>
		</div>

		<button type="button" class="next" :disabled="!canContinue" :data-testid="TESTIDS.sendTokenNext" @click="emit('next')">CONTINUE</button>
	</section>
</template>

<style scoped>
.step {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.search {
	padding: 10px 12px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 500 13px/1.3 var(--font-mono);
}

.status {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.err {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--red);
}

.balances {
	display: flex;
	gap: 14px;
	flex-wrap: wrap;
}

.balance {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.next {
	align-self: flex-start;
	padding: 10px 18px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.next:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.next:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}
</style>
