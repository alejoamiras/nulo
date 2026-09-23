/**
 * Composes a sendTx handler chain with pre-claim liveness vouching. Extracted
 * from the `onWalletMessage` closure so the two ORDERING invariants are
 * unit-pinnable (test-less closure wiring is silently revertible):
 *
 * - `begin` fires at id-resolution, BEFORE awaiting `prev` — the session-FIFO
 *   wait is the very window the vouching exists for; beginning inside
 *   `prev.then` would leave a parked sibling untouched and reapable.
 * - `end` fires only at handler SETTLEMENT (the finally) — never at the early
 *   `onExecutionEnqueued` release, which fires pre-grant while the heartbeat's
 *   first touch may still be 30 s away. It runs before `releaseFifo` and is
 *   the idempotent backstop; the lane's ownership migration at mutex enqueue
 *   is the normal removal.
 */
export function chainSendTxWithVouching<T>(deps: {
	queuedJournalIdPromise: Promise<string | undefined>
	prev: Promise<void>
	vouch: { beginQueuedWait(id: string): void; endQueuedWait(id: string): void }
	releaseFifo: () => void
	run: (queuedJournalId: string | undefined) => Promise<T | undefined>
}): Promise<T | undefined> {
	let heartbeatId: string | undefined
	const handlerChain = deps.queuedJournalIdPromise.then((queuedJournalId) => {
		if (queuedJournalId) {
			heartbeatId = queuedJournalId
			deps.vouch.beginQueuedWait(queuedJournalId)
		}
		return deps.prev.then(() => deps.run(queuedJournalId))
	})
	handlerChain
		.finally(() => {
			if (heartbeatId) deps.vouch.endQueuedWait(heartbeatId)
			deps.releaseFifo()
		})
		.catch(() => {})
	return handlerChain
}
