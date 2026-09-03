<script setup lang="ts">
/** Utils */
import { computed, ref } from "vue"
import { toDecimalString } from "@/lib/format"
import type { GasLegPlan, ResolvedToken } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	token: ResolvedToken
	amount: bigint
	gas: GasLegPlan | null
	/** How many Aztec transactions the proposed slice is sized for. */
	txTarget: number
	loading: boolean
	error: string | null
}>()
const emit = defineEmits<{ "update:txTarget": [target: number] }>()

const showTarget = ref(false)

// Full precision throughout: the split shown here is what the send is signed against, and Fee Juice
// amounts at 18 decimals disappear entirely under a display rounding.
const tokenArrives = computed(() => {
	const slice = props.gas?.fuelAmount ?? 0n
	const rest = props.amount > slice ? props.amount - slice : 0n
	return toDecimalString(rest, props.token.decimals)
})

const sliceText = computed(() => (props.gas ? toDecimalString(props.gas.fuelAmount, props.token.decimals) : "—"))

const gasArrives = computed(() => (props.gas ? toDecimalString(props.gas.quote, 18) : "—"))

const floorText = computed(() => (props.gas ? toDecimalString(props.gas.minFuelOutput, 18) : "—"))

const CAPPED_NOTE = {
	min: "The slice was raised to the smallest amount that buys usable gas.",
	half: "The slice was capped at half your amount.",
} as const

const cappedNote = computed(() => (props.gas?.capped ? CAPPED_NOTE[props.gas.capped] : null))

function onTarget(event: Event): void {
	const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10)
	// A blank or junk field is a half-typed edit, not an instruction to size the slice for zero txs.
	if (Number.isFinite(parsed) && parsed > 0) emit("update:txTarget", parsed)
}
</script>

<template>
	<div class="breakdown" :data-testid="TESTIDS.sendGasBreakdown" :data-loading="loading || undefined" :data-capped="gas?.capped ?? undefined">
		<p class="line" :data-testid="TESTIDS.sendGasBreakdownToken">
			<span class="what">Token arrives</span>
			<span class="value">{{ tokenArrives }} {{ token.symbol }}</span>
		</p>
		<p class="line" :data-testid="TESTIDS.sendGasBreakdownFuel">
			<span class="what">Gas arrives</span>
			<span class="value">{{ loading ? "sizing…" : `${gasArrives} FJ` }}</span>
		</p>
		<p class="sub" :data-testid="TESTIDS.sendGasShare">{{ sliceText }} {{ token.symbol }} becomes gas</p>
		<p class="sub" :data-testid="TESTIDS.sendGasFloor">at least {{ floorText }} FJ, or the send does not go through</p>
		<p v-if="cappedNote" class="sub">{{ cappedNote }}</p>

		<button type="button" class="change" :aria-expanded="showTarget" :data-testid="TESTIDS.sendGasChange" @click="showTarget = !showTarget">
			{{ showTarget ? "done" : "change" }}
		</button>
		<label v-if="showTarget" class="target">
			<span class="what">Enough gas for</span>
			<input
				class="target-input"
				type="number"
				min="1"
				step="1"
				aria-label="Transactions to size the gas for"
				:value="txTarget"
				:data-testid="TESTIDS.sendGasTxTarget"
				@input="onTarget"
			/>
			<span class="what">transactions</span>
		</label>

		<p v-if="error" class="err" aria-live="polite">{{ error }}</p>
	</div>
</template>

<style scoped>
.breakdown {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border: 1px solid var(--nulo-outline);
}

.line {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	margin: 0;
	font: 600 12.5px/1.4 var(--font-mono);
	color: var(--txt-primary);
}

.what {
	color: var(--txt-secondary);
	font-weight: 500;
}

.sub {
	margin: 0;
	font: 500 11px/1.4 var(--font-mono);
	color: var(--txt-tertiary);
}

.change {
	align-self: flex-start;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 500 11px/1.4 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.change:hover {
	color: var(--nulo-accent);
}

.target {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 500 11px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.target-input {
	width: 72px;
	padding: 6px 8px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 500 12px/1.2 var(--font-mono);
}

.err {
	margin: 0;
	color: var(--red);
	font: 500 12px/1.5 var(--font-mono);
}
</style>
