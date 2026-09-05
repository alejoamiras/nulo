<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { type AssetBlock, type AssetKind, assetDecimals, assetSymbol } from "@/lib/asset-label"
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { isStoredAmount, toDecimalString } from "@/lib/format"
import { formatElapsed } from "@/lib/phase-clock"
import { TESTIDS } from "@/lib/testids"
import { safeDisplay } from "@/lib/token-display"

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
	 *  and treat `available` as the full received amount. */
	fuelUsed?: string
	/** A send's own token identity, taken from the record's frozen block. Absent ⇒ the single-token
	 *  bridge, whose symbol and decimals come from the deployment. */
	token?: AssetBlock
	/** What the review promised, replayed beside what actually landed. */
	reviewSaid?: string
	/** The L2 token a wallet can be asked to watch. Absent ⇒ no add-token CTA. */
	addTokenLabel?: string
}

const props = withDefaults(defineProps<{ snapshot: ReceiptSnapshot; ctaLabel?: string; addTokenBusy?: boolean }>(), {
	ctaLabel: "NEW BRIDGE",
	addTokenBusy: false,
})
const emit = defineEmits<{ "new-bridge": []; "add-token": [] }>()

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
/** Past-tense hero verb by surface — the only label on the hero row. */
const heroLabel = computed(() => (isFuel.value ? "Fueled" : isDeposit.value ? "Bridged" : "Released"))

// Full precision, matching the review's own wording: the "review said … you got …" line is only a
// check the reader can make if both halves are written the same way.
const amountDisplay = computed(() =>
	isStoredAmount(props.snapshot.amount)
		? toDecimalString(BigInt(props.snapshot.amount), assetDecimals(props.snapshot.assetKind, props.snapshot.token))
		: "—",
)
const amountSymbol = computed(() => safeDisplay(assetSymbol(props.snapshot.assetKind, props.snapshot.isPrivate, props.snapshot.token)))
// Fuel rides IN only on a token deposit: a withdraw never carries gas, and a Fuel bridge IS the gas (no split).
// The `!isFuel` guard keeps hasFuel and isFuel mutually exclusive, so the receiptFuel testid is never duplicated.
const hasFuel = computed(() => isDeposit.value && !isFuel.value && !!props.snapshot.fuelReceived)
/** The fuel figures come from the journal record, so an impossible stored string reads as a dash. */
const fuelUsed = computed(() =>
	props.snapshot.fuelUsed && isStoredAmount(props.snapshot.fuelUsed) ? BigInt(props.snapshot.fuelUsed) : null,
)
const usedDisplay = computed(() => (props.snapshot.fuelUsed ? (fuelUsed.value === null ? "—" : toDecimalString(fuelUsed.value, 18)) : null))
/** Gas READY = received − used (the net the user can spend next); used unknown ⇒ the full received. */
const availableDisplay = computed(() => {
	if (!props.snapshot.fuelReceived) return null
	if (!isStoredAmount(props.snapshot.fuelReceived)) return "—"
	const available = BigInt(props.snapshot.fuelReceived) - (fuelUsed.value ?? 0n)
	return toDecimalString(available < 0n ? 0n : available, 18)
})

/** A send names its own token, so its hero and gas rows carry the send-specific ids the wizard's
 *  tests select on; the single-token bridge keeps the ids it has always emitted. */
const isSend = computed(() => props.snapshot.token !== undefined)
const heroTestid = computed(() => (isFuel.value ? TESTIDS.receiptFuel : isSend.value ? TESTIDS.sendReceiptToken : undefined))
const gasTestid = computed(() => (isSend.value ? TESTIDS.sendReceiptGas : TESTIDS.receiptFuel))

/** What actually landed — the counterpart the review line is read against. */
const got = computed(() => {
	const token = `${amountDisplay.value} ${amountSymbol.value}`
	return availableDisplay.value ? `${token} + ${availableDisplay.value} ${gasLabel.value}` : token
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

		<!-- The mint left-rule and the small ✓ are the only green — success without shouting. The bridged
		     asset is the hero (cream, large); Fee Juice demotes to dim rows (absent on withdraw/Fuel/plain). -->
		<div class="ledger">
			<p class="eyebrow">
				<span>{{ route }} · {{ privacyWord }}<template v-if="totalElapsed"> · {{ totalElapsed }}</template></span>
				<span class="done" role="img" aria-label="completed">✓</span>
			</p>
			<div class="row primary" :data-testid="heroTestid">
				<span class="k">{{ heroLabel }}</span>
				<span class="v">{{ amountDisplay }} {{ amountSymbol }}</span>
			</div>
			<template v-if="hasFuel">
				<div class="row" :data-testid="gasTestid">
					<span class="k">Gas ready</span><span class="v">{{ availableDisplay }} {{ gasLabel }}</span>
				</div>
				<div v-if="usedDisplay" class="row">
					<span class="k">Gas used</span><span class="v">&minus; {{ usedDisplay }} {{ gasLabel }}</span>
				</div>
			</template>
		</div>

		<p v-if="snapshot.reviewSaid" class="review-said" :data-testid="TESTIDS.sendReceiptReviewSaid">
			Review said {{ snapshot.reviewSaid }} &middot; you got {{ got }}
		</p>

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
		<Flex gap="8" class="ctas">
			<button type="button" class="action" :data-testid="TESTIDS.receiptNewBridge" @click="emit('new-bridge')">{{ ctaLabel }}</button>
			<button
				v-if="snapshot.addTokenLabel"
				type="button"
				class="action"
				:disabled="addTokenBusy"
				:data-testid="TESTIDS.sendReceiptAddToken"
				@click="emit('add-token')"
			>
				{{ addTokenBusy ? "ADDING…" : snapshot.addTokenLabel }}
			</button>
		</Flex>
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
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	color: var(--txt-secondary);
	font: 600 10px/1.5 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.eyebrow .done {
	color: var(--mint);
	letter-spacing: 0;
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

/* The bridged asset is the hero: cream + large, the only thing that draws the eye. */
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

.links a {
	color: var(--txt-secondary);
	font: 500 12px/1 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.links a:hover {
	color: var(--nulo-accent);
}

.review-said {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.ctas {
	align-self: flex-start;
	flex-wrap: wrap;
}

.action {
	padding: 10px 16px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.05em;
	cursor: pointer;
}

.action:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.action:disabled {
	cursor: not-allowed;
	opacity: 0.6;
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
