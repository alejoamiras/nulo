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

const amountDisplay = computed(() => formatBigInt(BigInt(props.snapshot.amount), BRIDGE_TOKEN_DECIMALS))
const headline = computed(() =>
	props.snapshot.direction === "deposit"
		? `${amountDisplay.value} ${BRIDGE_TOKEN_SYMBOL} to Aztec`
		: `${amountDisplay.value} ${BRIDGE_TOKEN_SYMBOL} to Ethereum`,
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
		<div class="confetti" aria-hidden="true">
			<span v-for="(c, i) in CONFETTI" :key="i" class="bit" :style="c">{{ i % 3 === 0 ? "▓" : i % 3 === 1 ? "░" : "✓" }}</span>
		</div>
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
	font: 700 20px/1 var(--font-mono);
	letter-spacing: 0.12em;
	color: var(--mint);
	animation: stamp-in 0.25s ease-out;
}

@keyframes stamp-in {
	0% {
		transform: scale(1.8);
		opacity: 0;
	}
	60% {
		transform: scale(0.94);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

.receipt {
	position: relative;
	overflow: hidden;
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
