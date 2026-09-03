<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { formatCompact, toDecimalString, trimAddress } from "@/lib/format"
import type { ExitPlan, SendPlan } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import { safeDisplay } from "@/lib/token-display"

/** Components */
import ReviewDetails, { type PortalState } from "./ReviewDetails.vue"

/** What the view states about the plan, frozen with it: the clock, the fee model, the transaction
 *  count the gas was sized for. Strings and a count, so this step only repeats them. */
export interface ReviewEstimate {
	takes: string
	networkFee: string
	/** How many Aztec transactions the gas leg covers; null when the send buys no gas. */
	txCovered: number | null
}

const props = defineProps<{
	plan: SendPlan | ExitPlan
	portalVerified: PortalState
	account: string
	signatureValiditySeconds: number
	slippageBps: number | null
	estimate: ReviewEstimate
	grant: "idle" | "pending" | "declined" | "busy"
	busy: boolean
	error: string | null
	/** Set when a pause refused the exit before anything was authorised; the balance is untouched. */
	paused?: "l1" | "l2" | null
}>()
const emit = defineEmits<{ back: []; confirm: [] }>()

const isExit = computed(() => props.plan.direction === "l2-to-l1")

const token = computed(() => props.plan.token)

/** The ticker as it may be rendered: for a listed token this string is publisher-controlled. */
const symbol = computed(() => safeDisplay(token.value.symbol))

/** The token contract contradicts the list that named it. Not fatal — the wizard resolved onto the
 *  contract's own values — but the user chose the row by the name the list published, so the review
 *  has to say the two disagree before anything is signed. */
const conflict = computed(() => token.value.metadataConflict)

const gas = computed(() => (props.plan.direction === "l1-to-l2" ? props.plan.gas : undefined))

// Every token amount on this screen is full precision: a display rounding is a different number
// from the one being signed, and at two places a small send reads as zero. The gas figure is a
// quote, shown compact.
const sendText = computed(() => `${toDecimalString(props.plan.amount, token.value.decimals)} ${symbol.value}`)

const tokenArrives = computed(() => {
	if (props.plan.direction === "l2-to-l1") return `${sendText.value} to ${trimAddress(props.plan.recipientL1)} on Ethereum`
	const slice = gas.value?.fuelAmount ?? 0n
	const rest = props.plan.amount > slice ? props.plan.amount - slice : 0n
	if (rest === 0n) return null
	return `${toDecimalString(rest, token.value.decimals)} ${symbol.value}`
})

const where = computed(() => (props.plan.direction === "l1-to-l2" ? (props.plan.isPrivate ? "private" : "public") : ""))

const gasArrives = computed(() => (gas.value ? `≈ ${formatCompact(gas.value.quote, 18)} FJ` : null))

const gasFor = computed(() => {
	const n = props.estimate.txCovered
	if (n === null) return "gas"
	return `gas for ≈ ${n} ${n === 1 ? "transaction" : "transactions"}`
})

const firstTime = computed(() => props.plan.direction === "l1-to-l2" && token.value.state.kind !== "registered")

/** A portal that is neither absent nor the derived one means this send would fund a contract the
 *  wizard cannot account for; nothing may be signed against it. */
const portalMismatch = computed(() => props.portalVerified === "mismatch")

const confirmDisabled = computed(() => props.busy || props.grant === "pending" || portalMismatch.value)
</script>

<template>
	<section class="step" :data-testid="TESTIDS.sendStepReview" :data-direction="plan.direction">
		<dl class="lines">
			<div class="line" :data-testid="TESTIDS.sendReviewSend">
				<dt>Send</dt>
				<dd>{{ sendText }}</dd>
			</div>
			<div class="line" :data-testid="TESTIDS.sendReviewArrives">
				<dt>Arrives</dt>
				<dd class="legs">
					<span v-if="tokenArrives" class="leg">{{ tokenArrives }} <span v-if="where" class="soft-inline">{{ where }}</span></span>
					<span v-if="gasArrives" class="leg" :data-testid="TESTIDS.sendReviewGas">{{ gasArrives }} <span class="soft-inline">{{ gasFor }}</span></span>
				</dd>
			</div>
			<div class="line" :data-testid="TESTIDS.sendReviewNetworkFee">
				<dt>Fee</dt>
				<dd>{{ estimate.networkFee }}</dd>
			</div>
			<div class="line" :data-testid="TESTIDS.sendReviewTakes">
				<dt>Takes</dt>
				<dd>{{ estimate.takes }}</dd>
			</div>
		</dl>

		<p v-if="firstTime" class="soft" :data-testid="TESTIDS.sendReviewFirstTime">
			First time for this token here — the send takes a little longer and costs a bit more than the next one will.
		</p>
		<p v-if="conflict" class="warn" aria-live="polite" :data-testid="TESTIDS.sendReviewMetadataWarning">
			This contract calls itself {{ safeDisplay(conflict.live.symbol) }} ({{ conflict.live.decimals }} decimals), not
			{{ safeDisplay(conflict.listed.symbol) }} ({{ conflict.listed.decimals }} decimals) as the token list said. Check the address in the
			details before you send.
		</p>
		<p v-if="portalMismatch" class="warn" aria-live="polite" :data-testid="TESTIDS.sendReviewPortalWarning">
			This token's setup on Ethereum is not the one this send derives, so it cannot continue. Open the details below to see what was found.
		</p>
		<p v-if="isExit" class="soft" :data-testid="TESTIDS.sendReviewBurnNote">
			Your tokens leave Aztec as soon as you sign. Ethereum releases them when you finish, which is a separate step.
		</p>

		<ReviewDetails
			:plan="plan"
			:portal-verified="portalVerified"
			:account="account"
			:signature-validity-seconds="signatureValiditySeconds"
			:slippage-bps="slippageBps"
		/>

		<p v-if="grant === 'pending'" class="status" aria-live="polite" :data-testid="TESTIDS.sendGrantPending">Confirm the request in your wallet.</p>
		<p v-else-if="grant === 'declined'" class="warn" aria-live="polite" :data-testid="TESTIDS.sendGrantDeclined">
			Your wallet declined this token. Sign and send again to retry.
		</p>
		<p v-else-if="grant === 'busy'" class="status" aria-live="polite" :data-testid="TESTIDS.sendGrantBusy">
			Your wallet is finishing another request. Try again in a moment.
		</p>
		<p v-if="paused" class="status" aria-live="polite" :data-testid="TESTIDS.sendPausedNotice">
			{{ paused === "l1" ? "Withdrawals to Ethereum are paused right now." : "Exits from Aztec are paused right now." }}
			Your balance is untouched — try again later.
		</p>
		<p v-else-if="error" class="err" aria-live="polite" :data-testid="TESTIDS.sendReviewError">{{ error }}</p>

		<div class="nav">
			<button type="button" class="btn" :disabled="busy" :data-testid="TESTIDS.sendReviewBack" @click="emit('back')">BACK</button>
			<button type="button" class="btn primary" :disabled="confirmDisabled" :data-testid="TESTIDS.sendReviewConfirm" @click="emit('confirm')">
				{{ busy ? "SENDING…" : "SIGN & SEND" }}
			</button>
		</div>
	</section>
</template>

<style scoped>
.step {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.lines {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin: 0;
	padding: 14px 16px;
	border: 1px solid var(--nulo-outline);
}

.line {
	display: flex;
	gap: 12px;
	align-items: baseline;
}

dt {
	flex: none;
	width: 92px;
	font: 600 11px/1.4 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}

dd {
	margin: 0;
	font: 600 13px/1.4 var(--font-mono);
	color: var(--txt-primary);
}

.legs {
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.soft-inline {
	color: var(--txt-secondary);
	font-weight: 500;
}

.soft {
	margin: 0;
	padding: 8px 10px;
	border: 1px dashed var(--nulo-outline);
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.status {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.warn {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--yellow);
}

.err {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--red);
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
</style>
