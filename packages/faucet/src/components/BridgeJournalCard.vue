<script setup lang="ts">
/** Services */
import {
	type BridgeJournalRecord,
	type DepositJournalRecord,
	type WithdrawJournalRecord,
	deriveDepositStage,
	deriveWithdrawStage,
} from "@nulo/bridge-core"
import { computed, ref } from "vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"

/** Utils */
import { etherscanTxUrl, explorerTxUrl } from "@/lib/explorer"
import { TESTIDS } from "@/lib/testids"

/** Components */
import BridgePhaseRail from "./BridgePhaseRail.vue"

const props = defineProps<{ record: BridgeJournalRecord }>()

const journal = useBridgeJournal()

const discardArmed = ref(false)

const rt = computed(() => journal.runtime.value[props.record.id] ?? {})
const busy = computed(() => !!rt.value.busy)

const stage = computed(() => {
	if (props.record.direction === "deposit") {
		const rec = props.record as DepositJournalRecord
		return deriveDepositStage(rec, { claimable: rt.value.claimable ?? !!rec.leafIndex })
	}
	const rec = props.record as WithdrawJournalRecord
	return deriveWithdrawStage(rec, { proven: rt.value.proven ?? false })
})

const attention = computed(() => rt.value.attention)
const actionable = computed(() => !attention.value || attention.value === "unknown-outcome" || attention.value === "error")

const stageLabel = computed(() => {
	const r = props.record
	if (r.direction === "deposit") {
		switch (stage.value) {
			case "depositing":
				return "Depositing on Ethereum - confirm the transaction(s) in your Ethereum wallet."
			case "syncing":
				return "Waiting for the message to sync to Aztec - no signature needed (~1–2 min)."
			case "claimable":
				return r.isPrivate
					? "Ready to resume. Claiming asks your Ethereum wallet to unseal the recovery secret, waits for sync if needed, then asks your Aztec wallet to confirm."
					: "Ready to resume. Claiming waits for sync if needed, then asks your Aztec wallet to confirm."
			case "claiming":
				return "Claiming on Aztec - confirm in your Aztec wallet."
			default:
				return "Bridged to Aztec ✓"
		}
	}
	switch (stage.value) {
		case "exiting":
			return "Exiting Aztec - confirm in your Aztec wallet."
		case "proving":
			return rt.value.provenBlock !== undefined && rt.value.targetBlock !== undefined
				? `Waiting for Aztec to prove the exit - proven block ${rt.value.provenBlock} of ${rt.value.targetBlock}. Proving lands in epoch batches: the number sits, then jumps.`
				: "Waiting for Aztec to prove the exit - proving lands in epoch batches and can take a while."
		case "consumable":
			return "Proven. Finish on Ethereum to release the funds."
		case "consuming":
			return "Releasing on Ethereum - confirm in your Ethereum wallet."
		default:
			return "Released to Ethereum ✓"
	}
})

const showClaim = computed(
	() => props.record.direction === "deposit" && stage.value !== "done" && stage.value !== "depositing" && actionable.value,
)
const showFinish = computed(
	() => props.record.direction === "withdraw" && stage.value !== "done" && stage.value !== "exiting" && actionable.value,
)

/** A soft note (e.g. the 30-min "still confirming") renders even without an attention state. */
const note = computed(() => rt.value.note)

const txLinks = computed(() => {
	const links: { label: string; href: string }[] = []
	if (props.record.direction === "deposit") {
		const rec = props.record as DepositJournalRecord
		if (rec.depositTxHash) links.push({ label: "deposit tx ↗", href: etherscanTxUrl(rec.depositTxHash) })
		if (rec.claimTxHash) links.push({ label: "claim tx ↗", href: explorerTxUrl(rec.claimTxHash) })
	} else {
		const rec = props.record as WithdrawJournalRecord
		if (rec.exitTxHash && !rec.exitTxHash.startsWith("wd-pending"))
			links.push({ label: "exit tx ↗", href: explorerTxUrl(rec.exitTxHash) })
		if (rec.consumeTxHash) links.push({ label: "finish tx ↗", href: etherscanTxUrl(rec.consumeTxHash) })
	}
	return links.filter((l) => l.href !== "")
})

const amountDisplay = computed(() => (Number(props.record.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }))

const age = computed(() => {
	const mins = Math.max(0, Math.round((Date.now() - props.record.createdAt) / 60_000))
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.round(mins / 60)
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
})

function onAction() {
	if (props.record.direction === "deposit") void journal.runDepositClaim(props.record.id)
	else void journal.runWithdrawConsume(props.record.id)
}

function onDiscard() {
	if (!discardArmed.value) {
		discardArmed.value = true
		return
	}
	journal.discard(props.record.id)
}
</script>

<template>
	<article
		class="journal-card"
		:data-testid="TESTIDS.journalCard"
		:data-id="record.id"
		:data-direction="record.direction"
		:data-stage="stage"
		:data-privacy="record.isPrivate ? 'private' : 'public'"
		:data-attention="attention"
	>
		<p v-if="stage === 'done'" class="stamp">BRIDGED ✓</p>
		<header class="row">
			<span class="dir">{{ record.direction === "deposit" ? "ETHEREUM → AZTEC" : "AZTEC → ETHEREUM" }}</span>
			<span class="amt">{{ amountDisplay }} USDC</span>
			<span class="tag" :class="{ private: record.isPrivate }">{{ record.isPrivate ? "PRIVATE" : "PUBLIC" }}</span>
			<span class="age">{{ age }}</span>
		</header>

		<BridgePhaseRail v-if="stage !== 'done'" :record="record" compact />

		<p class="stage" :data-testid="TESTIDS.journalStage">{{ stageLabel }}</p>

		<p v-if="note" class="attention" :data-testid="TESTIDS.journalAttention">{{ note }}</p>

		<div v-if="txLinks.length" class="links">
			<a
				v-for="link in txLinks"
				:key="link.href"
				:href="link.href"
				target="_blank"
				rel="noopener noreferrer"
				:data-testid="TESTIDS.journalTxLink"
			>{{ link.label }}</a>
		</div>

		<div class="actions">
			<button
				v-if="showClaim && stage !== 'done'"
				type="button"
				class="action"
				:disabled="busy"
				:data-testid="TESTIDS.journalClaim"
				@click="onAction"
			>
				{{ attention === "unknown-outcome" || attention === "error" ? "RETRY" : "CLAIM" }}
			</button>
			<button
				v-if="showFinish && stage !== 'done'"
				type="button"
				class="action"
				:disabled="busy"
				:data-testid="TESTIDS.journalFinish"
				@click="onAction"
			>
				{{ attention === "unknown-outcome" || attention === "error" ? "RETRY" : "FINISH" }}
			</button>
			<button
				v-if="stage === 'done'"
				type="button"
				class="action subtle"
				:data-testid="TESTIDS.journalClear"
				@click="journal.clearDone(record.id)"
			>
				CLEAR
			</button>
			<button
				v-else
				type="button"
				class="action danger"
				:disabled="busy"
				:data-testid="discardArmed ? TESTIDS.journalDiscardConfirm : TESTIDS.journalDiscard"
				@click="onDiscard"
			>
				{{ discardArmed ? "CONFIRM DISCARD" : "DISCARD" }}
			</button>
		</div>

		<p v-if="discardArmed && stage !== 'done' && record.isPrivate && record.direction === 'deposit'" class="discard-warning">
			Discarding destroys the only copy of this claim's sealed recovery secret - the deposited funds become
			unclaimable. Testnet only.
		</p>
	</article>
</template>

<style scoped>
.journal-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px;
	border: 1px solid var(--nulo-outline);
}

.journal-card[data-attention] {
	border-style: dashed;
}

.row {
	display: flex;
	align-items: baseline;
	gap: 10px;
}

.dir {
	font: 700 13px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.04em;
}

.amt {
	font: 600 13px/1 var(--font-mono);
	color: var(--txt-primary);
}

.tag {
	font: 600 10px/1 var(--font-mono);
	color: var(--txt-secondary);
	border: 1px solid var(--nulo-outline);
	padding: 3px 6px;
	letter-spacing: 0.08em;
}

.tag.private {
	color: var(--nulo-accent);
	border-color: var(--nulo-accent);
}

.age {
	margin-left: auto;
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.stage {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.step {
	margin: 0;
	color: var(--txt-primary);
	font: 600 12px/1.5 var(--font-mono);
}

.pulse {
	color: var(--nulo-accent);
	animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 0.25;
	}
	50% {
		opacity: 1;
	}
}

.links {
	display: flex;
	gap: 12px;
}

.links a {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.links a:hover {
	color: var(--nulo-accent);
}

.attention {
	margin: 0;
	padding: 8px 10px;
	border: 1px dashed var(--yellow);
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

.actions {
	display: flex;
	gap: 8px;
}

.action {
	padding: 8px 14px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 12px/1 var(--font-mono);
	letter-spacing: 0.05em;
	cursor: pointer;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.action:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.action.danger:hover:not(:disabled) {
	border-color: var(--red);
	color: var(--red);
}

.action.subtle {
	color: var(--txt-secondary);
}

.action:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.discard-warning {
	margin: 0;
	color: var(--red);
	font: 500 12px/1.5 var(--font-mono);
}

.stamp {
	margin: 0 0 6px;
	font: 700 20px/1 var(--font-mono);
	letter-spacing: 0.12em;
	color: var(--mint);
	animation: stamp-in 0.25s ease-out;
}

.journal-card[data-stage="done"] {
	border-color: var(--mint);
	animation: flash 0.3s ease-out;
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

@keyframes flash {
	0% {
		background: var(--mint);
	}
	100% {
		background: transparent;
	}
}
</style>
