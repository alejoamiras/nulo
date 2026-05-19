/**
 * LazyListener — boot-message buffer for the service worker.
 *
 * MV3 service workers wake on event delivery and require listeners to be
 * registered at the top of the script file. But the wallet's services
 * (PXE adapter, profile, journal) aren't ready to handle messages until
 * boot finishes — async work like KDF unlock or chrome.storage rehydrate.
 *
 * Without buffering, messages arriving in the boot window are either
 * lost (no listener attached) or rejected (listener attached but service
 * not ready). LazyListener bridges this: attach the underlying chrome
 * listener at top-of-file, buffer events in-memory, then flush in order
 * once the consumer marks itself ready.
 *
 * Pattern matches MetaMask's `extension-lazy-listener` and was confirmed
 * by both Phase 2 audit rounds as a Phase 2 must-have.
 *
 * Usage:
 *
 *   // top of service worker entry — runs synchronously on each wake
 *   const lazy = makeLazyListener(handleMessage, {
 *     attach: (h) => {
 *       chrome.runtime.onMessage.addListener(h)
 *       return () => chrome.runtime.onMessage.removeListener(h)
 *     },
 *     ready: services.ready,  // resolves when boot finishes
 *   })
 *
 *   // later, on teardown:
 *   lazy.detach()
 */

const DEFAULT_MAX_BUFFERED = 100

/** Minimal logger shape — keeps this module free of `@nulo/wallet-core/logger`. */
export interface LazyListenerLogger {
	warn(message: string, ...details: unknown[]): void
}

export interface LazyListenerOptions<TMsg, TSender = unknown> {
	/**
	 * Attach the underlying chrome listener immediately (top-of-file).
	 * Must return an `unsubscribe` function for {@link LazyListener.detach}.
	 */
	attach: (handler: (msg: TMsg, sender: TSender) => void) => () => void
	/** Resolves when the real handler is allowed to receive messages. */
	ready: Promise<void>
	/** Buffer cap. Beyond this, oldest entries are dropped with a warn. Default 100. */
	maxBuffered?: number
	/** Optional logger for overflow warnings (defaults to `console`). */
	logger?: LazyListenerLogger
}

export interface LazyListener {
	/** Stops dispatching to the real handler. Idempotent. */
	detach: () => void
}

interface BufferedEvent<TMsg, TSender> {
	msg: TMsg
	sender: TSender
}

/**
 * Builds a buffer-then-flush listener. Caller is responsible for keeping
 * the LazyListener reference alive until the SW is torn down.
 */
export function makeLazyListener<TMsg, TSender = unknown>(
	realHandler: (msg: TMsg, sender: TSender) => void | Promise<void>,
	opts: LazyListenerOptions<TMsg, TSender>,
): LazyListener {
	const maxBuffered = opts.maxBuffered ?? DEFAULT_MAX_BUFFERED
	const logger: LazyListenerLogger = opts.logger ?? console
	const buffer: BufferedEvent<TMsg, TSender>[] = []
	let ready = false
	let detached = false
	let droppedCount = 0

	const dispatch = (msg: TMsg, sender: TSender): void => {
		if (detached) return
		// Errors thrown by realHandler must not crash the listener — log and continue.
		try {
			const result = realHandler(msg, sender)
			if (result && typeof (result as Promise<void>).catch === "function") {
				;(result as Promise<void>).catch((err) => {
					logger.warn("[lazy-listener] realHandler rejected", err)
				})
			}
		} catch (err) {
			logger.warn("[lazy-listener] realHandler threw", err)
		}
	}

	const onIncoming = (msg: TMsg, sender: TSender): void => {
		if (detached) return
		if (ready) {
			dispatch(msg, sender)
			return
		}
		if (buffer.length >= maxBuffered) {
			buffer.shift()
			droppedCount += 1
			logger.warn(`[lazy-listener] buffer overflow at ${maxBuffered}; dropped oldest (total dropped: ${droppedCount})`)
		}
		buffer.push({ msg, sender })
	}

	const unsubscribeUnderlying = opts.attach(onIncoming)

	opts.ready.then(() => {
		if (detached) return
		ready = true
		// Splice — drains the buffer atomically so any re-entrant push during
		// dispatch goes through the ready-path instead of being flushed twice.
		const drained = buffer.splice(0, buffer.length)
		for (const { msg, sender } of drained) {
			dispatch(msg, sender)
		}
	})

	return {
		detach: () => {
			if (detached) return
			detached = true
			buffer.length = 0
			unsubscribeUnderlying()
		},
	}
}
