<script setup lang="ts">
/** Services */
import type { BridgeJournalRecord, DepositJournalRecord } from "@nulo/bridge-core"
import { computed } from "vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"

/** Utils */
import { type BridgePhase, stepperPhases } from "@/lib/bridge-steps"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{ record: BridgeJournalRecord }>()
const emit = defineEmits<{ background: [] }>()

const journal = useBridgeJournal()

const rt = computed(() => journal.runtime.value[props.record.id] ?? {})
const phases = computed(() => stepperPhases(props.record, rt.value))

const GLYPH: Record<BridgePhase["state"], string> = {
	pending: "▢",
	active: "●",
	done: "✓",
	skipped: "⊘",
	failed: "✕",
}

const failedPhase = computed(() => phases.value.find((p) => p.state === "failed"))

/** Per-phase retry routing (plan S9): only engine-drivable phases get a RETRY. */
const canRetry = computed(() => {
	const key = failedPhase.value?.key
	if (!key) return false
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
	const amount = (Number(props.record.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
	const dir = props.record.direction === "deposit" ? "ETHEREUM → AZTEC" : "AZTEC → ETHEREUM"
	return `${dir} · ${amount} USDC · ${props.record.isPrivate ? "PRIVATE" : "PUBLIC"}`
})
</script>

<template>
	<section class="stepper" :data-testid="TESTIDS.stepper" :data-id="record.id">
		<header>
			<h3>BRIDGING</h3>
			<p class="headline">{{ headline }}</p>
		</header>

		<ol class="rail">
			<li
				v-for="phase in phases"
				:key="phase.key"
				class="phase"
				:class="phase.state"
				:data-testid="TESTIDS.stepperPhase"
				:data-phase="phase.key"
				:data-state="phase.state"
			>
				<span class="glyph" :class="{ pulse: phase.state === 'active' }">{{ GLYPH[phase.state] }}</span>
				<span class="label">{{ phase.label }}</span>
				<span v-if="phase.state === 'skipped'" class="badge">SKIPPED</span>
				<p v-if="phase.detail && (phase.state === 'active' || phase.state === 'failed')" class="detail">{{ phase.detail }}</p>
			</li>
		</ol>

		<div class="actions">
			<button v-if="canRetry" type="button" class="action" :data-testid="TESTIDS.stepperRetry" @click="onRetry">RETRY</button>
			<button type="button" class="action subtle" :data-testid="TESTIDS.stepperBackground" @click="emit('background')">
				RUN IN BACKGROUND
			</button>
		</div>
		<p class="bg-hint">Backgrounding moves this bridge to Pending Bridges - it keeps running either way.</p>
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

.rail {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.phase {
	display: grid;
	grid-template-columns: 20px auto 1fr;
	column-gap: 10px;
	align-items: baseline;
	padding: 8px 10px;
	border: 1px solid var(--nulo-outline);
}

.phase.active {
	border-color: var(--nulo-accent);
}

.phase.failed {
	border-color: var(--red);
}

.phase.pending {
	opacity: 0.55;
}

.glyph {
	font: 600 13px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.phase.active .glyph {
	color: var(--nulo-accent);
}

.phase.failed .glyph {
	color: var(--red);
}

.pulse {
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

.label {
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.06em;
}

.badge {
	justify-self: start;
	font: 600 10px/1 var(--font-mono);
	color: var(--txt-secondary);
	border: 1px solid var(--nulo-outline);
	padding: 2px 5px;
}

.detail {
	grid-column: 2 / -1;
	margin: 4px 0 0;
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
</style>
