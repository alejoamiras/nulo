import type { ProvePhaseEvent, ProvePhaseObserver } from "./chain-runtime"

/** Connects the prover factory's phase observer to the `PxeService` created after it. */
export interface ProvePhaseSink {
	emit: ProvePhaseObserver
	subscribe(observer: ProvePhaseObserver): void
}

export function createProvePhaseSink(): ProvePhaseSink {
	const observers: ProvePhaseObserver[] = []
	return {
		emit(event: ProvePhaseEvent) {
			for (const observer of observers) observer(event)
		},
		subscribe(observer) {
			observers.push(observer)
		},
	}
}
