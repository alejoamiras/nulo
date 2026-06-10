<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
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
}

const props = defineProps<{ snapshot: ReceiptSnapshot }>()
const emit = defineEmits<{ "new-bridge": [] }>()

const amountDisplay = computed(() => (Number(props.snapshot.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }))
const headline = computed(() =>
	props.snapshot.direction === "deposit" ? `${amountDisplay.value} USDC to Aztec` : `${amountDisplay.value} USDC to Ethereum`,
)
const totalElapsed = computed(() => {
	const { startedAt, completedAt } = props.snapshot
	if (startedAt === undefined || completedAt === undefined || completedAt <= startedAt) return null
	return formatElapsed(completedAt - startedAt)
})
const links = computed(() => {
	const out: { label: string; href: string }[] = []
	if (props.snapshot.l1TxHash) {
		out.push({
			label: props.snapshot.direction === "deposit" ? "deposit tx ↗" : "finish tx ↗",
			href: etherscanTxUrl(props.snapshot.l1TxHash),
		})
	}
	if (props.snapshot.l2TxHash) {
		out.push({
			label: props.snapshot.direction === "deposit" ? "claim tx ↗" : "exit tx ↗",
			href: explorerTxUrl(props.snapshot.l2TxHash),
		})
	}
	return out.filter((l) => l.href !== "")
})
</script>

<template>
	<section class="receipt" :data-testid="TESTIDS.receipt">
		<p class="stamp">{{ snapshot.direction === "deposit" ? "BRIDGED ✓" : "RELEASED ✓" }}</p>
		<h3>{{ headline }}</h3>
		<p class="sub">
			{{ snapshot.isPrivate ? "Arrived in your PRIVATE balance." : "Arrived in your public balance." }}
			<template v-if="totalElapsed"> {{ totalElapsed }} end to end.</template>
		</p>
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
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.receipt h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.sub {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 13px/1.5 var(--font-mono);
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

.stamp {
	margin: 0;
	padding: 14px 18px;
	align-self: flex-start;
	font: 700 26px/1 var(--font-mono);
	letter-spacing: 0.14em;
	color: var(--nulo-bg, #000);
	background: var(--mint);
	animation: stamp-in 0.3s ease-out;
}

@keyframes stamp-in {
	0% {
		transform: scale(1.6) rotate(-3deg);
		opacity: 0;
	}
	65% {
		transform: scale(0.95) rotate(0.5deg);
		opacity: 1;
	}
	100% {
		transform: scale(1) rotate(0deg);
		opacity: 1;
	}
}
</style>
