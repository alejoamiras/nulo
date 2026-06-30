<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { type AssetKind, assetDecimals, assetSymbol } from "@/lib/asset-label"
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
	/** Bridged asset. Absent ⇒ the token bridge (back-compat — bridge receipts omit it). "fee-juice" ⇒ a
	 *  Fuel bridge: the amount IS Fee Juice (18-dec, "FJ"/"Private FJ"), there is no separate token leg. */
	assetKind?: AssetKind
	l1TxHash?: string
	l2TxHash?: string
	/** Persisted facts (createdAt/completedAt) - the end-to-end time always survives reloads. */
	startedAt?: number
	completedAt?: number
	/** Fueled deposits: the FJ that landed as gas (base units). */
	fuelReceived?: string
	/** The claim tx's fee (gas used), base units — read post-completion. Undefined ⇒ omit the used row
	 *  and treat `available` as the full bought amount. */
	fuelUsed?: string
}

const props = withDefaults(defineProps<{ snapshot: ReceiptSnapshot; ctaLabel?: string }>(), { ctaLabel: "NEW BRIDGE" })
const emit = defineEmits<{ "new-bridge": [] }>()

// The meme: a one-shot burst of square monospace bits. Deterministic pseudo-random placement,
// CSS-only, gone in under a second - celebration without a dependency.
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
	left: `${(i * 53) % 97}%`,
	animationDelay: `${(i % 7) * 60}ms`,
	color: i % 2 === 0 ? "var(--mint)" : "var(--nulo-accent)",
}))

const isDeposit = computed(() => props.snapshot.direction === "deposit")
/** A direct Fuel bridge: the amount itself is Fee Juice (no token leg, no bought/used split). */
const isFuel = computed(() => props.snapshot.assetKind === "fee-juice")
const route = computed(() => (isDeposit.value ? "Ethereum → Aztec" : "Aztec → Ethereum"))
const privacyWord = computed(() => (props.snapshot.isPrivate ? "private" : "public"))
/** Gas naming by surface: private → "Private FJ", public → "FJ". ($AZTEC is the L1-side name.) */
const gasLabel = computed(() => (props.snapshot.isPrivate ? "Private FJ" : "FJ"))
const stampWord = computed(() => (isFuel.value ? "FUELED ✓" : isDeposit.value ? "BRIDGED ✓" : "RELEASED ✓"))

const amountDisplay = computed(() => formatBigInt(BigInt(props.snapshot.amount), assetDecimals(props.snapshot.assetKind)))
const amountSymbol = computed(() => assetSymbol(props.snapshot.assetKind, props.snapshot.isPrivate))
// Fuel only ever rides IN on a deposit; a withdraw never carries gas back to Ethereum.
const hasFuel = computed(() => isDeposit.value && !!props.snapshot.fuelReceived)
const boughtDisplay = computed(() => (props.snapshot.fuelReceived ? formatBigInt(BigInt(props.snapshot.fuelReceived), 18) : null))
const usedDisplay = computed(() => (props.snapshot.fuelUsed ? formatBigInt(BigInt(props.snapshot.fuelUsed), 18) : null))
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

		<div class="rhead">
			<p class="stamp">{{ stampWord }}</p>
			<span class="meta"><template v-if="totalElapsed">{{ totalElapsed }} · </template>{{ privacyWord }}</span>
		</div>
		<p class="route">{{ route }}</p>

		<div class="ledger">
			<div v-if="isFuel" class="row" :data-testid="TESTIDS.receiptFuel"><span class="k">Fuel</span><span>{{ amountDisplay }} {{ amountSymbol }}</span></div>
			<template v-else-if="isDeposit">
				<div class="row"><span class="k">Tokens</span><span>{{ amountDisplay }} {{ amountSymbol }}</span></div>
				<template v-if="hasFuel">
					<div class="row" :data-testid="TESTIDS.receiptFuel"><span class="k">Gas bought</span><span>{{ boughtDisplay }} {{ gasLabel }}</span></div>
					<div v-if="usedDisplay" class="row"><span class="k">Gas used</span><span>&minus; {{ usedDisplay }} {{ gasLabel }}</span></div>
				</template>
			</template>
			<div v-else class="row"><span class="k">Released</span><span>{{ amountDisplay }} {{ amountSymbol }} &rarr; Ethereum</span></div>
		</div>

		<div v-if="hasFuel && availableDisplay" class="reserve">
			<div class="big">{{ availableDisplay }} {{ gasLabel }} available</div>
			<div class="note">Ready to power your next {{ snapshot.isPrivate ? "private " : "" }}transaction</div>
		</div>

		<Flex v-if="links.length" gap="12" class="links">
			<a
				v-for="link in links"
				:key="link.href"
				:href="link.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-testid="TESTIDS.receiptLink"
			>{{ link.label }}</a>
		</Flex>
		<button type="button" class="action" :data-testid="TESTIDS.receiptNewBridge" @click="emit('new-bridge')">{{ ctaLabel }}</button>
	</section>
</template>

<style scoped>
.receipt {
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.rhead {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
}

.meta {
	color: var(--txt-secondary);
	font: 500 13px/1 var(--font-mono);
}

.route {
	margin: 0;
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 17px;
	color: var(--txt-primary);
}

.ledger {
	display: flex;
	flex-direction: column;
	font: 500 13px/1.5 var(--font-mono);
}

.ledger .row {
	display: flex;
	justify-content: space-between;
	padding: 6px 0;
	border-bottom: 1px solid var(--nulo-outline);
}

.ledger .row:last-child {
	border-bottom: none;
}

.ledger .row .k {
	color: var(--txt-secondary);
}

.reserve {
	border: 1px solid var(--mint);
	padding: 12px 14px;
}

.reserve .big {
	color: var(--mint);
	font: 600 15px/1.2 var(--font-mono);
}

.reserve .note {
	color: var(--txt-secondary);
	font: 500 12px/1.4 var(--font-mono);
	margin-top: 4px;
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
