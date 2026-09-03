<script setup lang="ts">
/** Utils */
import { computed, watch } from "vue"
import { parseAmountStrict, toDecimalString } from "@/lib/format"
import type { AmountToken, Direction, GasLegPlan, SendIntent, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

/** Components */
import ChoiceCards from "./ChoiceCards.vue"
import GasBreakdown from "./GasBreakdown.vue"

export type RouteKind = "route" | "identity" | "no-route" | "unavailable"

const props = defineProps<{
	direction: Direction
	token: AmountToken
	/** The chain is still being read behind this step: the field is live, CONTINUE is not. */
	resolving?: boolean
	balances: TokenBalances
	intent: SendIntent
	/** A string model: the field must keep what the user typed, including a trailing separator. */
	amount: string
	isPrivate: boolean
	gas: GasLegPlan | null
	routeKind: RouteKind | null
	routeLoading: boolean
	txTarget: number
	fjPerTx: bigint | null
	gasError: string | null
	/** A refusal decided above the step (an exit on a token the hub has not bound): shown, and CONTINUE stays off. */
	blockedReason?: string | null
	/** Why `token` alone cannot continue (the account holds no gas to claim with): shown while it is the choice. */
	tokenOnlyBlocked?: string | null
}>()
const emit = defineEmits<{
	"update:intent": [intent: SendIntent]
	"update:amount": [amount: string]
	"update:isPrivate": [isPrivate: boolean]
	"update:txTarget": [target: number]
	/** This step owns the field's validity; the wizard gates the review on what it reports here. */
	"update:valid": [valid: boolean]
	back: []
	next: []
}>()

const NUMERIC_SHAPE = /^\d*(\.\d*)?$/

/** Referenced by `aria-describedby` / `aria-labelledby`: one amount step exists at a time. */
const AMOUNT_ERROR_ID = "send-amount-error"
const PRIVACY_LABEL_ID = "send-privacy-label"

// Only the outcomes that change what the user can do are said aloud; a working route is the default.
const ROUTE_LABEL: Partial<Record<RouteKind, string>> = {
	"no-route": "This token can't buy Aztec gas on the way in.",
	unavailable: "Gas options can't be checked right now.",
}

const isExit = computed(() => props.direction === "l2-to-l1")

/** An exit spends the balance the privacy choice names; a deposit spends the Ethereum one. */
const spendable = computed(() =>
	isExit.value ? (props.isPrivate ? props.balances.l2Private : props.balances.l2Public) : props.balances.l1,
)

const parsed = computed(() => parseAmountStrict(props.amount, props.token.decimals))

const amountError = computed<string | null>(() => {
	if (props.amount.trim() === "") return null
	if (parsed.value === null) {
		return NUMERIC_SHAPE.test(props.amount.trim())
			? `${props.token.symbol} has ${props.token.decimals} decimal places — use no more than that.`
			: "Enter the amount as a number."
	}
	if (parsed.value === 0n) return "Enter an amount greater than zero."
	const max = spendable.value
	if (max !== undefined && parsed.value > max) return "That's more than your balance."
	return null
})

const showGas = computed(() => !isExit.value && props.intent !== "token")

// Only an outcome is said; a route still being checked shows nothing rather than a spinner line.
const routeLine = computed(() => {
	if (isExit.value || props.routeLoading || !props.routeKind) return null
	return ROUTE_LABEL[props.routeKind] ?? null
})

const canContinue = computed(() => {
	if (props.blockedReason || props.resolving) return false
	if (!isExit.value && props.intent === "token" && props.tokenOnlyBlocked) return false
	if (amountError.value !== null || parsed.value === null || parsed.value === 0n) return false
	return !showGas.value || props.gas !== null
})

watch(canContinue, (valid) => emit("update:valid", valid), { immediate: true })

/** The balance is what "Use all" types into the field, so it is written the same way — full precision. */
const balanceText = computed(() => (spendable.value === undefined ? "—" : toDecimalString(spendable.value, props.token.decimals)))

const balanceTestid = computed(() => {
	if (!isExit.value) return TESTIDS.sendBalanceL1
	return props.isPrivate ? TESTIDS.sendBalanceL2Private : TESTIDS.sendBalanceL2Public
})

function onUseAll(): void {
	const max = spendable.value
	if (max !== undefined) emit("update:amount", toDecimalString(max, props.token.decimals))
}
</script>

<template>
	<section class="step" :data-testid="TESTIDS.sendStepAmount" :data-direction="direction">
		<ChoiceCards
			:intent="intent"
			:exit-only="isExit"
			:fee-asset="routeKind === 'identity'"
			:no-route="routeKind === 'no-route' || routeKind === 'unavailable'"
			@update:intent="emit('update:intent', $event)"
		/>

		<p v-if="routeLine" class="route" aria-live="polite" :data-testid="TESTIDS.sendRouteStatus" :data-route="routeKind ?? undefined">
			{{ routeLine }}
		</p>
		<p
			v-if="!isExit && intent === 'token' && tokenOnlyBlocked"
			class="route"
			data-route="no-gas"
			aria-live="polite"
			:data-testid="TESTIDS.sendTokenOnlyBlocked"
		>
			{{ tokenOnlyBlocked }}
		</p>

		<div class="amount">
			<label class="field" :data-invalid="amountError ? 'true' : undefined">
				<input
					class="input"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					placeholder="0"
					:aria-label="`Amount in ${token.symbol}`"
					:aria-invalid="amountError ? 'true' : undefined"
					:aria-describedby="amountError ? AMOUNT_ERROR_ID : undefined"
					:value="amount"
					:data-testid="TESTIDS.sendAmountInput"
					@input="emit('update:amount', ($event.target as HTMLInputElement).value)"
				/>
				<span class="unit">{{ token.symbol }}</span>
			</label>
			<div class="under">
				<span class="balance" :data-testid="balanceTestid">Balance {{ balanceText }} {{ token.symbol }}</span>
				<button type="button" class="use-all" :disabled="spendable === undefined" :data-testid="TESTIDS.sendAmountMax" @click="onUseAll">
					Use all
				</button>
			</div>
			<p v-if="amountError" :id="AMOUNT_ERROR_ID" class="err" aria-live="polite" :data-testid="TESTIDS.sendAmountError">{{ amountError }}</p>
		</div>

		<GasBreakdown
			v-if="showGas && intent !== 'token'"
			:token="token"
			:amount="parsed ?? 0n"
			:intent="intent"
			:gas="gas"
			:tx-target="txTarget"
			:fj-per-tx="fjPerTx"
			:loading="routeLoading"
			:error="gasError"
			@update:tx-target="emit('update:txTarget', $event)"
		/>

		<div class="privacy">
			<button
				type="button"
				role="switch"
				class="toggle"
				:class="{ on: isPrivate }"
				:aria-checked="isPrivate"
				:aria-labelledby="PRIVACY_LABEL_ID"
				:data-testid="TESTIDS.sendPrivateToggle"
				@click="emit('update:isPrivate', !isPrivate)"
			>
				<span class="knob" />
			</button>
			<span :id="PRIVACY_LABEL_ID" class="privacy-label">Private — only you can see it</span>
		</div>

		<p v-if="blockedReason" class="err" aria-live="polite" :data-testid="TESTIDS.sendAmountBlocked">{{ blockedReason }}</p>

		<div class="nav">
			<button type="button" class="btn" :data-testid="TESTIDS.sendAmountBack" @click="emit('back')">BACK</button>
			<button type="button" class="btn primary" :disabled="!canContinue" :data-testid="TESTIDS.sendAmountNext" @click="emit('next')">
				CONTINUE
			</button>
		</div>
	</section>
</template>

<style scoped>
.step {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.route {
	margin: 0;
	font: 500 11.5px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.route[data-route="no-route"],
.route[data-route="unavailable"],
.route[data-route="no-gas"] {
	color: var(--yellow);
}

.amount {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.field {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 14px;
	border: 1px solid var(--nulo-outline);
}

.field:focus-within {
	border-color: var(--nulo-accent);
}

.field[data-invalid] {
	border-color: var(--red);
}

.input {
	flex: 1;
	min-width: 0;
	padding: 0;
	background: transparent;
	border: none;
	outline: none;
	color: var(--txt-primary);
	font: 600 20px/1.2 var(--font-mono);
}

.input::placeholder {
	color: var(--txt-tertiary);
}

.unit {
	font: 600 13px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.under {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.balance {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.use-all {
	padding: 0;
	background: transparent;
	border: none;
	color: var(--nulo-accent);
	font: 500 12px/1.4 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.use-all:disabled {
	cursor: not-allowed;
	opacity: 0.5;
}

.err {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--red);
}

.privacy {
	display: flex;
	align-items: center;
	gap: 10px;
}

.toggle {
	position: relative;
	width: 40px;
	height: 22px;
	padding: 0;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	cursor: pointer;
}

.toggle .knob {
	position: absolute;
	top: 3px;
	left: 3px;
	width: 14px;
	height: 14px;
	background: var(--txt-secondary);
	transition: transform 0.15s ease, background 0.15s ease;
}

.toggle.on {
	border-color: var(--nulo-accent);
}

.toggle.on .knob {
	transform: translateX(18px);
	background: var(--nulo-accent);
}

.privacy-label {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.nav {
	display: flex;
	gap: 8px;
}

.btn {
	padding: 12px 18px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.btn:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.btn.primary {
	padding: 12px 20px;
	background: var(--nulo-accent);
	border-color: var(--nulo-accent);
	color: var(--txt-inverse);
}

.btn.primary:hover:not(:disabled) {
	color: var(--txt-inverse);
	opacity: 0.9;
}

.btn:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.btn.primary:disabled {
	background: transparent;
	border-color: var(--nulo-outline);
	color: var(--txt-secondary);
	opacity: 1;
}
</style>
