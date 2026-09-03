<script setup lang="ts">
/** Utils */
import { computed, ref } from "vue"
import { trimAddress } from "@/lib/format"
import type { ExitPlan, SendPlan } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import { checksumAddress } from "@/lib/token-display"

/**
 * What the factory answered for this token's portal: the derived address (`verified`), no clone yet
 * (`absent`), a clone at some OTHER address (`mismatch`), or a read that did not come back
 * (`unknown`). Absent and unknown are not interchangeable — only one of them means "this send
 * creates it".
 */
export type PortalState = "verified" | "absent" | "unknown" | "mismatch"

const props = defineProps<{
	plan: SendPlan | ExitPlan
	portalVerified: PortalState
	account: string
	signatureValiditySeconds: number
	slippageBps: number | null
}>()

// Collapsed by design: this panel is the ONE place the wizard names mechanism, and a reader who
// never opens it must still be able to act on the five lines above.
const open = ref(false)

const routeText = computed(() => {
	if (props.plan.direction === "l2-to-l1") return "Direct: the hub burns your tokens, the portal releases them on Ethereum."
	const hops = props.plan.gas?.route.path.length ?? 0
	return hops === 0 ? "Direct: no swap, the whole amount is bridged." : `Gas swap over ${hops} pool ${hops === 1 ? "hop" : "hops"}.`
})

const slippageText = computed(() =>
	props.slippageBps === null ? "Not applicable — this send buys no gas." : `${(props.slippageBps / 100).toFixed(2)}%`,
)

const portalText = computed(() => {
	const registered = props.plan.token.state.kind === "registered"
	if (props.portalVerified === "absent") return "Portal: will be created by this send at its derived address."
	if (props.portalVerified === "unknown") return "Portal: could not be read just now — this send still uses the derived address."
	if (props.portalVerified === "mismatch") {
		return "Portal: the factory already holds a DIFFERENT address for this token. Do not send until you know why."
	}
	return registered
		? "Portal: verified against the address the factory derives for this token."
		: "Portal: verified; this send also registers the token on the hub."
})

/** In FULL, never trimmed: this is the one line that says which contract the money leaves for, and a
 *  middle-elided address is exactly what an address-lookalike attack survives. */
const tokenAddress = computed(() => checksumAddress(props.plan.token.address))

const validityText = computed(() => {
	const seconds = props.signatureValiditySeconds
	if (seconds < 60) return `${seconds}s`
	return `${Math.round(seconds / 60)} min`
})
</script>

<template>
	<div class="details">
		<button type="button" class="toggle" :aria-expanded="open" :data-testid="TESTIDS.sendReviewDetailsToggle" @click="open = !open">
			{{ open ? "Hide details" : "Details" }}
		</button>
		<dl v-if="open" class="panel" :data-testid="TESTIDS.sendReviewDetails">
			<div class="row" :data-testid="TESTIDS.sendReviewToken">
				<dt>Token</dt>
				<dd class="full">{{ tokenAddress }}</dd>
			</div>
			<div class="row" :data-testid="TESTIDS.sendReviewRoute">
				<dt>Route</dt>
				<dd>{{ routeText }}</dd>
			</div>
			<div class="row" :data-testid="TESTIDS.sendReviewSlippage">
				<dt>Slippage</dt>
				<dd>{{ slippageText }}</dd>
			</div>
			<div class="row" :data-testid="TESTIDS.sendReviewPortal" :data-portal="portalVerified">
				<dt>Portal</dt>
				<dd>{{ portalText }}</dd>
			</div>
			<div class="row" :data-testid="TESTIDS.sendReviewAccount">
				<dt>Account</dt>
				<dd :title="account">{{ trimAddress(account) }}</dd>
			</div>
			<div class="row" :data-testid="TESTIDS.sendReviewSignature">
				<dt>Signature</dt>
				<dd>Valid for {{ validityText }}</dd>
			</div>
		</dl>
	</div>
</template>

<style scoped>
.details {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.toggle {
	align-self: flex-start;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font: 500 11px/1.4 var(--font-mono);
	letter-spacing: 0.04em;
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.toggle:hover {
	color: var(--nulo-accent);
}

.panel {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding: 12px 14px;
	border: 1px dashed var(--nulo-outline);
}

.row {
	display: flex;
	gap: 10px;
	align-items: baseline;
}

dt {
	flex: none;
	width: 88px;
	font: 600 11px/1.4 var(--font-mono);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
}

dd {
	margin: 0;
	font: 500 11.5px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

/* An address is only useful whole: wrap it rather than clip it. */
.full {
	overflow-wrap: anywhere;
	color: var(--txt-primary);
}

.row[data-portal="mismatch"] dd {
	color: var(--yellow);
}
</style>
