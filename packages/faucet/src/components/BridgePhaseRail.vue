<script setup lang="ts">
/** Services */
import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { computed, onBeforeUnmount, ref } from "vue"

/** Composables */
import { useBridgeJournal } from "@/composables/useBridgeJournal"

/** Utils */
import { type BridgePhase, stepperPhases } from "@/lib/bridge-steps"
import { formatElapsed, trackPhases } from "@/lib/phase-clock"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{ record: BridgeJournalRecord; compact?: boolean }>()

const journal = useBridgeJournal()

// 1s heartbeat for the live elapsed timer on the active phase (display only).
const now = ref(Date.now())
const ticker = setInterval(() => {
	now.value = Date.now()
}, 1000)
onBeforeUnmount(() => clearInterval(ticker))

const rt = computed(() => journal.runtime.value[props.record.id] ?? {})
const phases = computed(() => trackPhases(props.record.id, stepperPhases(props.record, rt.value), now.value))
const activePhase = computed(() => phases.value.find((p) => p.state === "active" || p.state === "failed"))

const GLYPH: Record<BridgePhase["state"], string> = {
	pending: "▢",
	active: "●",
	done: "✓",
	skipped: "⊘",
	failed: "✕",
}

const BAR_CELLS = 8
function bar(fraction: number): string {
	const filled = Math.round(fraction * BAR_CELLS)
	return "▓".repeat(filled) + "░".repeat(BAR_CELLS - filled)
}

function liveElapsed(startedAt?: number): string | null {
	if (startedAt === undefined) return null
	return formatElapsed(now.value - startedAt)
}
</script>

<template>
	<!-- Compact: one glyph strip + the active phase's live line (journal cards). -->
	<div v-if="compact" class="rail compact" :data-testid="TESTIDS.journalRail" :data-id="record.id">
		<div class="strip">
			<span
				v-for="phase in phases"
				:key="phase.key"
				class="cell"
				:class="phase.state"
				:data-testid="TESTIDS.journalPhase"
				:data-phase="phase.key"
				:data-state="phase.state"
				:title="phase.label"
			>{{ GLYPH[phase.state] }}</span>
			<span v-if="activePhase" class="strip-label">{{ activePhase.label }}</span>
			<span v-if="activePhase && liveElapsed(activePhase.startedAt)" class="strip-clock">{{ liveElapsed(activePhase.startedAt) }}</span>
		</div>
		<p v-if="activePhase?.detail" class="detail" :data-testid="TESTIDS.journalStep">
			<span v-if="activePhase.state === 'active'" class="pulse">●</span>
			{{ activePhase.detail }}
		</p>
		<p v-if="activePhase?.progress" class="bar-line">
			<span class="bar">{{ bar(activePhase.progress.fraction) }}</span>
			<span class="bar-count">{{ activePhase.progress.current }} / {{ activePhase.progress.target }}</span>
		</p>
	</div>

	<!-- Full: the stepper's vertical rail - a work log that ACCUMULATES (labor illusion). -->
	<ol v-else class="rail full">
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
			<span v-else-if="phase.state === 'done' && phase.elapsedMs !== undefined" class="took">{{ formatElapsed(phase.elapsedMs) }}</span>
			<span v-else-if="phase.state === 'active' && liveElapsed(phase.startedAt)" class="clock">
				{{ liveElapsed(phase.startedAt) }}<template v-if="phase.eta"> · {{ phase.eta }}</template>
			</span>
			<p v-if="phase.detail && (phase.state === 'active' || phase.state === 'failed')" class="detail">{{ phase.detail }}</p>
			<p v-if="phase.progress" class="bar-line">
				<span class="bar">{{ bar(phase.progress.fraction) }}</span>
				<span class="bar-count">{{ phase.progress.current }} / {{ phase.progress.target }}</span>
			</p>
		</li>
	</ol>
</template>

<style scoped>
/* ---------- shared ---------- */
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

@keyframes stamp {
	0% {
		transform: scale(1.9);
		opacity: 0;
	}
	60% {
		transform: scale(0.92);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

.bar-line {
	display: flex;
	gap: 8px;
	align-items: baseline;
	margin: 4px 0 0;
}

.bar {
	font: 600 12px/1 var(--font-mono);
	color: var(--nulo-accent);
	letter-spacing: 0.1em;
}

.bar-count {
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.detail {
	margin: 4px 0 0;
	color: var(--txt-secondary);
	font: 500 12px/1.5 var(--font-mono);
}

/* ---------- full rail ---------- */
.rail.full {
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

/* The stamp moment: every ✓/⊘ snaps in once when the phase completes. */
.phase.done .glyph,
.phase.skipped .glyph {
	color: var(--mint);
	animation: stamp 0.22s ease-out;
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

.took {
	justify-self: start;
	font: 500 11px/1 var(--font-mono);
	color: var(--mint);
}

.clock {
	justify-self: start;
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.phase .detail,
.phase .bar-line {
	grid-column: 2 / -1;
}

/* ---------- compact rail (journal cards) ---------- */
.rail.compact {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.strip {
	display: flex;
	gap: 6px;
	align-items: baseline;
}

.cell {
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.cell.pending {
	opacity: 0.45;
}

.cell.active {
	color: var(--nulo-accent);
	animation: pulse 1.2s ease-in-out infinite;
}

.cell.failed {
	color: var(--red);
}

.cell.done,
.cell.skipped {
	color: var(--mint);
	animation: stamp 0.22s ease-out;
}

.strip-label {
	margin-left: 4px;
	font: 600 11px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.06em;
}

.strip-clock {
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
}
</style>
