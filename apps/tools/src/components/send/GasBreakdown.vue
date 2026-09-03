<script setup lang="ts">
/** Utils */
import { computed, ref } from "vue"
import { formatCompact, toDecimalString } from "@/lib/format"
import type { GasLegPlan, ResolvedToken, SendIntent } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	token: ResolvedToken
	amount: bigint
	/** `token+gas` sizes a slice for a number of transactions; `gas` spends the whole amount. */
	intent: Extract<SendIntent, "token+gas" | "gas">
	gas: GasLegPlan | null
	/** How many Aztec transactions the proposed slice is sized for. */
	txTarget: number
	/** What one Aztec transaction costs on this network, for saying what a gas-only send is enough for. */
	fjPerTx: bigint | null
	loading: boolean
	error: string | null
}>()
const emit = defineEmits<{ "update:txTarget": [target: number] }>()

const MAX_TX = 999

const sizing = ref(false)

/** The split the send is signed against, at full precision: a token remainder shown rounded is a
 *  different number from the one leaving the wallet. */
const tokenArrives = computed(() => {
	const slice = props.gas?.fuelAmount ?? 0n
	const rest = props.amount > slice ? props.amount - slice : 0n
	return toDecimalString(rest, props.token.decimals)
})

const sliceText = computed(() => (props.gas ? toDecimalString(props.gas.fuelAmount, props.token.decimals) : "—"))

// The gas figures are a quote, read at a glance; the exact floor lives in the disclosure.
const gasArrives = computed(() => (props.gas ? `≈ ${formatCompact(props.gas.quote, 18)} FJ` : "—"))

const floorText = computed(() => (props.gas ? toDecimalString(props.gas.minFuelOutput, 18) : "—"))

const enoughFor = computed(() => {
	if (!props.gas || !props.fjPerTx || props.fjPerTx <= 0n) return null
	return Number(props.gas.quote / props.fjPerTx)
})

const CAPPED_NOTE = {
	min: "The slice was raised to the smallest amount that buys usable gas.",
	half: "The slice was capped at half your amount.",
} as const

const cappedNote = computed(() => (props.gas?.capped ? CAPPED_NOTE[props.gas.capped] : null))

function setTarget(next: number): void {
	if (Number.isFinite(next) && next >= 1 && next <= MAX_TX && next !== props.txTarget) emit("update:txTarget", next)
}

function onTarget(event: Event): void {
	// A blank or junk field is a half-typed edit, not an instruction to size the slice for zero txs.
	setTarget(Number.parseInt((event.target as HTMLInputElement).value, 10))
}
</script>

<template>
	<div
		class="card"
		:data-testid="TESTIDS.sendGasBreakdown"
		:data-intent="intent"
		:data-loading="loading || undefined"
		:data-capped="gas?.capped ?? undefined"
	>
		<template v-if="intent === 'token+gas'">
			<div class="head">
				<span class="eyebrow">Gas for</span>
				<div class="stepper" role="group" aria-label="Transactions to size the gas for">
					<button
						type="button"
						class="nudge"
						aria-label="One transaction fewer"
						:disabled="txTarget <= 1"
						:data-testid="TESTIDS.sendGasTxFewer"
						@click="setTarget(txTarget - 1)"
					>
						−
					</button>
					<label class="count">
						<input
							class="count-input"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							aria-label="Transactions to size the gas for"
							:value="txTarget"
							:data-testid="TESTIDS.sendGasTxTarget"
							@change="onTarget"
						/>
						<span class="count-unit">{{ txTarget === 1 ? "transaction" : "transactions" }}</span>
					</label>
					<button
						type="button"
						class="nudge"
						aria-label="One transaction more"
						:disabled="txTarget >= MAX_TX"
						:data-testid="TESTIDS.sendGasTxMore"
						@click="setTarget(txTarget + 1)"
					>
						+
					</button>
				</div>
			</div>
			<hr class="rule" />
			<p class="line" :data-testid="TESTIDS.sendGasBreakdownToken">
				<span class="what">Arrives as {{ token.symbol }}</span>
				<span class="value">{{ tokenArrives }} {{ token.symbol }}</span>
			</p>
			<p class="line" :data-testid="TESTIDS.sendGasBreakdownFuel">
				<span class="what">Arrives as gas</span>
				<span class="value">
					<template v-if="loading">sizing…</template>
					<template v-else>{{ gasArrives }} <span class="from" :data-testid="TESTIDS.sendGasShare">from {{ sliceText }} {{ token.symbol }}</span></template>
				</span>
			</p>
			<button type="button" class="disclose" :aria-expanded="sizing" :data-testid="TESTIDS.sendGasChange" @click="sizing = !sizing">
				How the gas is sized
			</button>
			<div v-if="sizing" class="sizing" :data-testid="TESTIDS.sendGasSizing">
				<p class="sub">
					{{ sliceText }} {{ token.symbol }} of your amount is swapped for Fee Juice on the way in, sized so ≈ {{ txTarget }}
					{{ txTarget === 1 ? "transaction" : "transactions" }} on Aztec are covered.
				</p>
				<p class="sub" :data-testid="TESTIDS.sendGasFloor">The swap must deliver at least {{ floorText }} FJ, or the send does not go through.</p>
				<p v-if="cappedNote" class="sub">{{ cappedNote }}</p>
			</div>
		</template>

		<template v-else>
			<p class="line" :data-testid="TESTIDS.sendGasBreakdownFuel">
				<span class="what">Arrives as gas</span>
				<span class="value">{{ loading ? "sizing…" : gasArrives }}</span>
			</p>
			<p v-if="enoughFor !== null" class="line" :data-testid="TESTIDS.sendGasEnough">
				<span class="what">Enough for</span>
				<span class="value">≈ {{ enoughFor }} {{ enoughFor === 1 ? "transaction" : "transactions" }}</span>
			</p>
		</template>

		<p v-if="error" class="err" aria-live="polite">{{ error }}</p>
	</div>
</template>

<style scoped>
.card {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
	border: 1px solid var(--nulo-outline);
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}

.eyebrow {
	font: 600 11px/1.4 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}

.stepper {
	display: flex;
	align-items: stretch;
	border: 1px solid var(--nulo-outline);
}

.nudge {
	width: 36px;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 600 16px/1 var(--font-mono);
	cursor: pointer;
}

.nudge:first-child {
	border-right: 1px solid var(--nulo-outline);
}

.nudge:last-child {
	border-left: 1px solid var(--nulo-outline);
}

.nudge:hover:not(:disabled) {
	color: var(--nulo-accent);
}

.nudge:disabled {
	cursor: not-allowed;
	opacity: 0.4;
}

.count {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 120px;
	height: 34px;
	padding: 0 10px;
	justify-content: center;
	font: 600 13px/1 var(--font-mono);
	color: var(--txt-primary);
}

.count-input {
	width: 3ch;
	padding: 0;
	background: transparent;
	border: none;
	color: inherit;
	font: inherit;
	text-align: right;
}

.count-input:focus {
	outline: none;
	text-decoration: underline;
	text-underline-offset: 3px;
}

.count-unit {
	white-space: nowrap;
}

.rule {
	margin: 4px 0;
	border: none;
	height: 1px;
	background: var(--nulo-outline);
}

.line {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	margin: 0;
	font: 600 12.5px/1.4 var(--font-mono);
	color: var(--txt-primary);
}

.what,
.from {
	color: var(--txt-secondary);
	font-weight: 500;
}

.disclose {
	align-self: flex-start;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--txt-tertiary);
	font: 500 11px/1.4 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.disclose:hover {
	color: var(--nulo-accent);
}

.sizing {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.sub {
	margin: 0;
	font: 500 11px/1.5 var(--font-mono);
	color: var(--txt-tertiary);
}

.err {
	margin: 0;
	color: var(--red);
	font: 500 12px/1.5 var(--font-mono);
}
</style>
