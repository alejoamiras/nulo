import type { ProvePhaseEvent, ProvePhaseObserver } from "./chain-runtime"

/**
 * The seam between the prover factory (which emits phases) and `PxeService`
 * (which forwards them to the service worker). The factory is built before
 * the service exists, so neither can hold the other directly: the shell
 * creates the sink, hands `emit` to the factory and the sink to the service.
 */
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
