/**
 * Per-session FIFO baton primitive used by `onWalletMessage`.
 *
 * The baton replaces the original "single Promise chained on handler
 * completion" FIFO. It advances when the handler EITHER:
 *   (a) explicitly calls `releaseFifo()` mid-execution (sendTx does this
 *       after tx-build), OR
 *   (b) completes (safety-net `.finally(releaseFifo)`),
 * whichever fires first. Lets concurrent dApp sendTx proceed past the
 * popup-wait phase while previous proving continues in the background.
 *
 * Extracted from `background.ts` so the baton mechanics + safety-net +
 * idempotence are unit-testable without spinning up the full
 * BackgroundConnectionHandler.
 */

export interface SessionBaton {
	/** Resolves when the handler signals FIFO-release. Stored in the
	 *  `sessionQueues` map; the NEXT message's handler awaits this. */
	readonly baton: Promise<void>
	/** Idempotent release callback. Safe to call multiple times — only the
	 *  first call resolves the baton. */
	readonly releaseFifo: () => void
}

/** Create a fresh baton + release callback for a session-FIFO slot. */
export function createSessionBaton(): SessionBaton {
	let resolveBaton!: () => void
	const baton = new Promise<void>((resolve) => {
		resolveBaton = resolve
	})
	let released = false
	const releaseFifo = () => {
		if (released) return
		released = true
		resolveBaton()
	}
	return { baton, releaseFifo }
}
