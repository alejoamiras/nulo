<script setup lang="ts">
/** Services */
import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { computed } from "vue"

/** Composables */
import { type RecordRuntime, useBridgeJournal } from "@/composables/useBridgeJournal"

/** Utils */
import { type BridgePhase, stepperPhases } from "@/lib/bridge-steps"
import { useNow } from "@/lib/clock"
import { formatElapsed, trackPhases } from "@/lib/phase-clock"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	record: BridgeJournalRecord
	compact?: boolean
	retryable?: boolean
	/** Narration for a record the journal does not hold yet (the wizard's permission phase). */
	runtime?: RecordRuntime
}>()
const emit = defineEmits<{ retry: [] }>()

const journal = useBridgeJournal()

// Shared 1s heartbeat (one app-wide interval - N cards must not mean N timers).
const now = useNow()

const rt = computed(() => props.runtime ?? journal.runtime.value[props.record.id] ?? {})
// `now` drives RENDER ticks only; trackPhases stamps with the real clock internally - stamping
// with the shared ref once recorded a stale page-load time as a phase start (SEAL showing 5m
// the instant a bridge began, when the wallet connected long after load).
const phases = computed(() => {
	void now.value // re-evaluate every tick so live timers advance.
	return trackPhases(props.record.id, stepperPhases(props.record, rt.value))
})
const activePhase = computed(() => phases.value.find((p) => p.state === "active" || p.state === "failed"))
/** Compact cards narrate only what is LIVE: a failed note, or the engine's running stepDetail -
 *  never the static signing prompt (an idle card must not instruct "confirm in your wallet"). */
const compactDetail = computed(() => {
	const phase = activePhase.value
	if (!phase?.detail) return null
	if (phase.state === "failed") return phase.detail
	return rt.value.stepDetail ? phase.detail : null
})

const GLYPH: Record<BridgePhase["state"], string> = {
	pending: "▢",
	active: "●",
	done: "✓",
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
				:class="[phase.state, { landed: phase.state === 'active' && phase.landed }]"
				:data-testid="TESTIDS.journalPhase"
				:data-phase="phase.key"
				:data-state="phase.state"
				:title="phase.label"
			>{{ GLYPH[phase.state] }}</span>
			<span v-if="activePhase" class="strip-label">{{ activePhase.label }}</span>
			<span v-if="activePhase && liveElapsed(activePhase.startedAt)" class="strip-clock">{{ liveElapsed(activePhase.startedAt) }}</span>
		</div>
		<p v-if="compactDetail" class="detail" :data-testid="TESTIDS.journalStep">{{ compactDetail }}</p>
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
			:data-testid="phase.key === 'register' ? TESTIDS.sendStepperRegister : TESTIDS.stepperPhase"
			:data-phase="phase.key"
			:data-state="phase.state"
		>
			<span class="glyph" :class="{ pulse: phase.state === 'active', landed: phase.state === 'active' && phase.landed }">{{
				GLYPH[phase.state]
			}}</span>
			<span class="label">{{ phase.label }}</span>
			<span v-if="phase.state === 'done' && phase.elapsedMs !== undefined" class="took">{{ formatElapsed(phase.elapsedMs) }}</span>
			<span v-else-if="phase.state === 'active' && liveElapsed(phase.startedAt)" class="clock">
				{{ liveElapsed(phase.startedAt) }}<template v-if="phase.eta"> · {{ phase.eta }}</template>
			</span>
			<p v-if="phase.detail && (phase.state === 'active' || phase.state === 'failed')" class="detail">{{ phase.detail }}</p>
			<button
				v-if="phase.state === 'failed' && retryable"
				type="button"
				class="retry"
				:data-testid="TESTIDS.stepperRetry"
				@click="emit('retry')"
			>
				RETRY
			</button>
			<p v-if="phase.progress" class="bar-line">
				<span class="bar">{{ bar(phase.progress.fraction) }}</span>
				<span class="bar-count">{{ phase.progress.current }} / {{ phase.progress.target }}</span>
			</p>
		</li>
	</ol>
</template>

<style scoped>
/* ---------- shared ---------- */
/* The one pulse on the page: the full rail's live glyph, slow. The compact rails (journal cards,
   several per page) never animate, and reduced motion stops this one too. */
.pulse {
	animation: pulse 2.4s ease-in-out infinite;
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

@media (prefers-reduced-motion: reduce) {
	.pulse,
	.phase.done .glyph,
	.cell.done {
		animation: none;
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
	color: var(--txt-primary);
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

/* ---------- full rail: a timeline down one spine ---------- */
.rail.full {
	position: relative;
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
}

.phase {
	position: relative;
	display: grid;
	grid-template-columns: 22px minmax(0, 1fr) auto;
	column-gap: 12px;
	align-items: baseline;
	padding: 9px 0;
}

.phase::before {
	content: "";
	position: absolute;
	left: 10.5px;
	top: 0;
	bottom: 0;
	width: 1px;
	background: var(--nulo-border);
}

.phase:first-child::before {
	top: 50%;
}

.phase:last-child::before {
	bottom: 50%;
}

.phase.pending {
	opacity: 0.5;
}

.glyph {
	position: relative;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-secondary);
}

.phase.active .glyph {
	color: var(--nulo-accent);
}

/* The quiet flip: once the claim is seen PROPOSED, the live dot adopts the
 * done-family color. Same glyph, same pulse - the only change is the hue. */
.phase.active .glyph.landed {
	color: var(--mint);
}

.phase.failed .glyph {
	color: var(--red);
}

/* The stamp moment: every ✓ snaps in once when the phase completes. */
.phase.done .glyph {
	color: var(--mint);
	animation: stamp 0.22s ease-out;
}

.label {
	font: 600 12px/1 var(--font-mono);
	color: var(--txt-primary);
	letter-spacing: 0.06em;
}

.took,
.clock {
	justify-self: end;
	font: 500 11px/1 var(--font-mono);
	color: var(--txt-secondary);
	text-align: right;
}

.phase .detail,
.phase .bar-line,
.phase .retry {
	grid-column: 2 / -1;
}

.phase .detail {
	margin-top: 6px;
}

.retry {
	justify-self: start;
	margin-top: 6px;
	padding: 6px 12px;
	background: transparent;
	border: 1px solid var(--red);
	color: var(--red);
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.06em;
	cursor: pointer;
}

.retry:hover {
	background: var(--red);
	color: var(--txt-inverse);
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
	color: var(--txt-primary);
}

.cell.active.landed {
	color: var(--mint);
}

.cell.failed {
	color: var(--red);
}

.cell.done {
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
