<script setup lang="ts">
/** Services */
import { type BridgeJournalRecord, type DepositJournalRecord, assetKindOf, isProvisionalWithdrawId } from "@nulo/bridge-core"
import { computed } from "vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"

/** Utils */
import { assetDecimals, assetSymbol } from "@/lib/asset-label"
import { isTerminalAttention, stepperPhases } from "@/lib/bridge-steps"
import { formatBigInt } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

/** Components */
import BridgePhaseRail from "./BridgePhaseRail.vue"

const props = defineProps<{ record: BridgeJournalRecord }>()
const emit = defineEmits<{ background: []; backup: [record: BridgeJournalRecord] }>()
const exportable = computed(() => {
	if (isProvisionalWithdrawId(props.record.id)) return false
	const r = props.record
	if (r.direction === "deposit" && r.isPrivate && !(r as DepositJournalRecord).sealedEnvelope) return false
	return true
})

const journal = useBridgeJournal()

const rt = computed(() => journal.runtime.value[props.record.id] ?? {})
const phases = computed(() => stepperPhases(props.record, rt.value))

const failedPhase = computed(() => phases.value.find((p) => p.state === "failed"))

/** Per-phase retry routing (plan S9): only engine-drivable phases get a RETRY. */
const canRetry = computed(() => {
	const key = failedPhase.value?.key
	if (!key) return false
	// A terminal attention is not re-drivable from any surface — retrying repeats the same failure.
	if (isTerminalAttention(journal.runtime.value[props.record.id]?.attention)) return false
	if (props.record.direction === "deposit") {
		// SYNC/CLAIM/CONFIRM are engine-driven; the L1 legs are not re-drivable from here.
		return key === "sync" || key === "claim" || key === "confirm"
	}
	return key === "prove" || key === "finish" || key === "confirm"
})

function onRetry() {
	if (props.record.direction === "deposit") void journal.runDepositClaim(props.record.id)
	else void journal.runWithdrawConsume(props.record.id)
}

const headline = computed(() => {
	// A fee-juice (Fuel) record is 18-dec Fee Juice, not the token bridge asset (codex LOW — same class
	// as the toast/card; the stepper header is the third shared surface).
	const kind = assetKindOf(props.record)
	const amount = formatBigInt(BigInt(props.record.amount), assetDecimals(kind))
	const dir = props.record.direction === "deposit" ? "ETHEREUM → AZTEC" : "AZTEC → ETHEREUM"
	return `${dir} · ${amount} ${assetSymbol(kind, props.record.isPrivate)} · ${props.record.isPrivate ? "PRIVATE" : "PUBLIC"}`
})
</script>

<template>
	<section class="stepper" :data-testid="TESTIDS.stepper" :data-id="record.id">
		<header class="head-row">
			<div>
				<h3>BRIDGING</h3>
				<p class="headline">{{ headline }}</p>
			</div>
			<button
				v-if="exportable"
				type="button"
				class="backup"
				title="Download this bridge's recovery file - restores it on any browser with your Ethereum wallet."
				:data-testid="TESTIDS.stepperBackup"
				@click="emit('backup', record)"
			>
				BACKUP ⤓
			</button>
		</header>

		<BridgePhaseRail :record="record" :retryable="canRetry" @retry="onRetry" />

		<div class="actions">
			<button type="button" class="action subtle" :data-testid="TESTIDS.stepperBackground" @click="emit('background')">
				RUN IN BACKGROUND
			</button>
		</div>
		<p class="bg-hint">Backgrounding moves this bridge to Your Bridges - it keeps running either way.</p>
	</section>
</template>

<style scoped>
.stepper {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.stepper h3 {
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 18px;
	color: var(--txt-primary);
	margin: 0;
}

.headline {
	margin: 4px 0 0;
	color: var(--txt-secondary);
	font: 600 13px/1.4 var(--font-mono);
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
}

.action:hover {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.action.subtle {
	color: var(--txt-secondary);
}

.bg-hint {
	margin: 0;
	color: var(--txt-secondary);
	font: 500 11px/1.5 var(--font-mono);
}

.head-row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.backup {
	background: var(--txt-primary);
	border: 1px solid var(--txt-primary);
	color: var(--txt-inverse);
	font: 700 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
	padding: 8px 12px;
	white-space: nowrap;
}

.backup:hover {
	background: transparent;
	color: var(--txt-primary);
}
</style>
