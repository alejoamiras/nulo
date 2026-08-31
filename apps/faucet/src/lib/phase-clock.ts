import type { BridgePhase } from "./bridge-steps"

/**
 * Display-only phase timekeeper (the labor-illusion record): stamps when each phase of a bridge
 * was first seen active and when it completed, so completed phases can keep "✓ DEPOSIT - 14s"
 * instead of evaporating. Module-level so the stepper and a backgrounded card share one clock;
 * in-memory only, so a reload degrades honestly (already-done phases simply show no duration).
 */

export interface TimedBridgePhase extends BridgePhase {
	/** Milliseconds the phase took (done/skipped) - absent when its start was never observed. */
	elapsedMs?: number
	/** Epoch ms when the phase was first seen active - lets the renderer tick a live timer. */
	startedAt?: number
}

type PhaseTimes = Map<string, { startedAt?: number; doneAt?: number }>
const clocks = new Map<string, PhaseTimes>()

export function trackPhases(recordId: string, phases: BridgePhase[], now: number = Date.now()): TimedBridgePhase[] {
	let clock = clocks.get(recordId)
	if (!clock) {
		clock = new Map()
		clocks.set(recordId, clock)
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 22) — refactor when touched, never raise
	return phases.map((phase) => {
		let times = clock.get(phase.key)
		if (!times) {
			times = {}
			clock.set(phase.key, times)
		}
		// Backward transitions (a RETRY re-running the gate, a failed claim re-prompting) reset the
		// phase's clock: durations measure the LATEST attempt, never a sum across a stall. Without
		// this, a phase re-entered after a long failure inherits its pre-failure start and lies.
		if (phase.state === "pending" && (times.startedAt !== undefined || times.doneAt !== undefined)) {
			times.startedAt = undefined
			times.doneAt = undefined
		}
		if ((phase.state === "active" || phase.state === "failed") && times.doneAt !== undefined) {
			times.startedAt = now
			times.doneAt = undefined
		}
		if ((phase.state === "active" || phase.state === "failed") && times.startedAt === undefined) {
			times.startedAt = now
		}
		if (phase.state === "done" && times.doneAt === undefined && times.startedAt !== undefined) {
			times.doneAt = now
		}
		const out: TimedBridgePhase = { ...phase }
		if (times.startedAt !== undefined) {
			out.startedAt = times.startedAt
			if (times.doneAt !== undefined) out.elapsedMs = times.doneAt - times.startedAt
		}
		return out
	})
}

export function dropPhaseClock(recordId: string): void {
	clocks.delete(recordId)
}

/** TEST-ONLY. */
export function __resetPhaseClockForTests(): void {
	clocks.clear()
}

/** Compact duration: "14s", "2m 05s", "1h 12m". */
export function formatElapsed(ms: number): string {
	const sec = Math.max(0, Math.round(ms / 1000))
	if (sec < 60) return `${sec}s`
	const min = Math.floor(sec / 60)
	const rem = sec % 60
	if (min < 60) return `${min}m ${String(rem).padStart(2, "0")}s`
	const h = Math.floor(min / 60)
	return `${h}h ${String(min % 60).padStart(2, "0")}m`
}
