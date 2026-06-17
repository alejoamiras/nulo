<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { formatBigInt } from "@/lib/format"
import { formatElapsed } from "@/lib/phase-clock"
import { TESTIDS } from "@/lib/testids"

/** The snapshot is captured at the stepper→receipt transition (plan S11) - a cross-tab discard
 *  or the auto-hide grace cannot blank this view. */
export interface ReceiptSnapshot {
	direction: "deposit" | "withdraw"
	amount: string
	isPrivate: boolean
	l1TxHash?: string
	l2TxHash?: string
	/** Persisted facts (createdAt/completedAt) - the end-to-end time always survives reloads. */
	startedAt?: number
	completedAt?: number
	/** Fueled deposits: the FJ that landed as gas (base units). */
	fuelReceived?: string
	/** The claim tx's fee (gas used), base units — read post-completion. Undefined ⇒ omit the used row
	 *  and treat `available` as the full received amount. */
	fuelUsed?: string
}

const props = defineProps<{ snapshot: ReceiptSnapshot }>()
const emit = defineEmits<{ "new-bridge": [] }>()

// The meme: a one-shot burst of square monospace bits. Deterministic pseudo-random placement,
// CSS-only, gone in under a second - celebration without a dependency.
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
	left: `${(i * 53) % 97}%`,
	animationDelay: `${(i % 7) * 60}ms`,
	color: i % 2 === 0 ? "var(--mint)" : "var(--nulo-accent)",
}))

const isDeposit = computed(() => props.snapshot.direction === "deposit")
const route = computed(() => (isDeposit.value ? "Ethereum → Aztec" : "Aztec → Ethereum"))
const privacyWord = computed(() => (props.snapshot.isPrivate ? "private" : "public"))
/** Gas naming by surface: private → "Private FJ", public → "FJ". ($AZTEC is the L1-side name.) */
const gasLabel = computed(() => (props.snapshot.isPrivate ? "Private FJ" : "FJ"))

const amountDisplay = computed(() => formatBigInt(BigInt(props.snapshot.amount), BRIDGE_TOKEN_DECIMALS))
// Fuel only ever rides IN on a deposit; a withdraw never carries gas back to Ethereum.
const hasFuel = computed(() => isDeposit.value && !!props.snapshot.fuelReceived)
const usedDisplay = computed(() => (props.snapshot.fuelUsed ? formatBigInt(BigInt(props.snapshot.fuelUsed), 18) : null))
/** Gas READY = received − used (the net the user can spend next); used unknown ⇒ the full received. */
const availableDisplay = computed(() => {
	if (!props.snapshot.fuelReceived) return null
	const available = BigInt(props.snapshot.fuelReceived) - (props.snapshot.fuelUsed ? BigInt(props.snapshot.fuelUsed) : 0n)
	return formatBigInt(available < 0n ? 0n : available, 18)
})

const totalElapsed = computed(() => {
	const { startedAt, completedAt } = props.snapshot
	if (startedAt === undefined || completedAt === undefined || completedAt <= startedAt) return null
	return formatElapsed(completedAt - startedAt)
})

const links = computed(() => {
	const out: { label: string; href: string }[] = []
	if (props.snapshot.l1TxHash) {
		out.push({
			label: isDeposit.value ? "deposit tx ↗" : "finish tx ↗",
			href: etherscanTxUrl(props.snapshot.l1TxHash),
		})
	}
	if (props.snapshot.l2TxHash) {
		out.push({
			label: isDeposit.value ? "claim tx ↗" : "exit tx ↗",
			href: explorerTxUrl(props.snapshot.l2TxHash),
		})
	}
	return out.filter((l) => l.href !== "")
})
</script>

<template>
	<section class="receipt" :data-testid="TESTIDS.receipt">
		<div class="confetti" aria-hidden="true">
			<span v-for="(c, i) in CONFETTI" :key="i" class="bit" :style="c">{{ i % 3 === 0 ? "▓" : i % 3 === 1 ? "░" : "✓" }}</span>
		</div>

		<!-- The mint left-rule is the ONLY green AND the single success mark; the bridged TOKENS are the
		     hero (cream, large). Fee Juice is demoted to dim rows that vanish on plain/withdraw. -->
		<div class="ledger">
			<p class="eyebrow">{{ route }} · {{ privacyWord }}<template v-if="totalElapsed"> · {{ totalElapsed }}</template></p>
			<div class="row primary">
				<span class="k">{{ isDeposit ? "Bridged" : "Released" }}</span>
				<span class="v">{{ amountDisplay }} {{ BRIDGE_TOKEN_SYMBOL }}</span>
			</div>
			<template v-if="hasFuel">
				<div class="row" :data-testid="TESTIDS.receiptFuel">
					<span class="k">Gas ready</span><span class="v">{{ availableDisplay }} {{ gasLabel }}</span>
				</div>
				<div v-if="usedDisplay" class="row">
					<span class="k">Gas used</span><span class="v">&minus; {{ usedDisplay }} {{ gasLabel }}</span>
				</div>
			</template>
		</div>

		<div v-if="links.length" class="links">
			<a
				v-for="link in links"
				:key="link.href"
				:href="link.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-testid="TESTIDS.receiptLink"
			>{{ link.label }}</a>
		</div>
		<button type="button" class="action" :data-testid="TESTIDS.receiptNewBridge" @click="emit('new-bridge')">NEW BRIDGE</button>
	</section>
</template>

<style scoped>
.receipt {
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.ledger {
	border-left: 2px solid var(--mint);
	padding-left: 14px;
	display: flex;
	flex-direction: column;
}

.eyebrow {
	margin: 0 0 5px;
	color: var(--txt-secondary);
	font: 600 10px/1.5 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.row {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	padding: 5px 0;
}

.row .k {
	color: var(--txt-secondary);
	font: 500 12px/1 var(--font-mono);
}

.row .v {
	color: var(--txt-secondary);
	font: 500 13px/1 var(--font-mono);
}

/* The bridged tokens are the hero: cream + large, the only thing that draws the eye. */
.row.primary {
	padding-top: 7px;
}

.row.primary .k {
	color: var(--txt-primary);
}

.row.primary .v {
	color: var(--txt-primary);
	font: 600 19px/1.1 var(--font-mono);
}

.links {
	display: flex;
	gap: 12px;
}

.links a {
	color: var(--txt-secondary);
	font: 500 12px/1 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.links a:hover {
	color: var(--nulo-accent);
}

.action {
	align-self: flex-start;
	padding: 10px 16px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.05em;
	cursor: pointer;
}

.action:hover {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.confetti {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.bit {
	position: absolute;
	top: -14px;
	font: 600 11px/1 var(--font-mono);
	animation: confetti-fall 0.9s ease-in forwards;
}

@keyframes confetti-fall {
	0% {
		transform: translateY(0) rotate(0deg);
		opacity: 1;
	}
	100% {
		transform: translateY(140px) rotate(200deg);
		opacity: 0;
	}
}
</style>
