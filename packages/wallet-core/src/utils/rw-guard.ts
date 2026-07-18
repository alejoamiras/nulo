import { type ILogger, LogLevel } from "../logger/interfaces"

/** Force-release timeout for stuck readers (ms). Converts a deadlock into a
 *  loud log + forced drain so the wallet recovers on its own instead of
 *  hanging forever. MUST exceed the longest legitimate reader: a `proveTx`
 *  can legitimately hold a read for up to 30 minutes (aztec-runtime's
 *  `PROVE_TX_TIMEOUT_MS` — not importable here, wallet-core sits below it),
 *  and a premature force-release lets a writer (profile deletion) run
 *  concurrently with live PXE work over an encrypted store. */
export const MAX_READER_DRAIN_MS = 35 * 60_000

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

/**
 * Read/write concurrency guard.
 *
 * - `read(fn)`: counts as a reader. Runs immediately if no writer is
 *   active or queued; otherwise waits for the writer to finish. Multiple
 *   concurrent reads proceed in parallel.
 * - `write(fn)`: waits for all active readers to drain, then runs
 *   exclusively. Other readers and writers queue behind it.
 * - `enterWrite()`/`leaveWrite()`: manual write-hold for destructive ops
 *   that span multiple awaits (profile switch/delete).
 *
 * Writers have FIFO priority: a reader arriving while a writer is queued
 * waits behind that writer. This prevents writer starvation under heavy
 * read load.
 *
 * Force-release: if readers don't drain within `MAX_READER_DRAIN_MS`,
 * the guard logs an error and force-unsticks queued writers. This is a
 * debuggability aid — it should never fire in practice.
 *
 * Reentry: calling `write()` from within a `read()` callback will
 * deadlock (the write waits for the read to finish; the read can't
 * finish until the write returns). The force-release unsticks this
 * after `MAX_READER_DRAIN_MS` (35 minutes). MV3 lacks
 * `AsyncLocalStorage`, so we don't detect reentry statically — the
 * sync-detector approach produces false positives under legitimate
 * concurrent reads vs. writes. Callers must not nest.
 */
export class ReadWriteGuard {
	/** Live readers, one token per `read()` in flight, mapped to entry timestamps.
	 *  A collection (not a counter) so a force-release can drop tokens without
	 *  skew: an orphaned reader's late `finally` delete is a no-op instead of
	 *  decrementing a fresh count to -1 (which let writers overlap later live
	 *  readers). PER-TOKEN ages matter: the force-release must expire only
	 *  readers INDIVIDUALLY stuck past the ceiling — serialized long readers
	 *  (queued proves) keep the guard continuously occupied far longer than any
	 *  single reader runs, and expiring ALL of them let a profile delete overlap
	 *  a mid-flight prove. */
	private readonly readerTokens = new Map<symbol, number>()
	private writeActive = false
	private readonly writeWaiters: Deferred<void>[] = []
	private readonly readWaiters: Deferred<void>[] = []
	private forceReleaseTimer?: ReturnType<typeof setTimeout>

	constructor(
		private readonly name?: string,
		private readonly logger?: ILogger,
	) {}

	private get readers(): number {
		return this.readerTokens.size
	}

	async read<T>(fn: () => Promise<T>): Promise<T> {
		// Re-check after every wake (condition-variable discipline): a writer can
		// acquire SYNCHRONOUSLY between releaseWrite's resolve loop and this
		// microtask resuming — installing the token unconditionally would run the
		// read concurrently with that writer.
		while (this.writeActive || this.writeWaiters.length > 0) {
			const d = deferred()
			this.readWaiters.push(d)
			await d.promise
		}

		if (this.readers === 0) this.startForceReleaseTimer()
		const token = Symbol("reader")
		this.readerTokens.set(token, Date.now())

		try {
			return await fn()
		} finally {
			this.readerTokens.delete(token)
			if (this.readers === 0) {
				this.stopForceReleaseTimer()
				this.drainWriteIfReady()
			}
		}
	}

	async write<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquireWrite()
		try {
			return await fn()
		} finally {
			this.releaseWrite()
		}
	}

	async enterWrite(): Promise<void> {
		await this.acquireWrite()
	}

	leaveWrite(): void {
		this.releaseWrite()
	}

	private async acquireWrite(): Promise<void> {
		if (this.writeActive || this.writeWaiters.length > 0 || this.readers > 0) {
			const d = deferred()
			this.writeWaiters.push(d)
			await d.promise
			// Baton-pass from releaseWrite / drainWriteIfReady: writeActive
			// is already set to true by the handoff. Nothing more to do.
			return
		}
		this.writeActive = true
	}

	private releaseWrite(): void {
		if (this.writeWaiters.length > 0) {
			// Hand the write slot to the next waiter directly. Keeping
			// writeActive=true through the handoff prevents a racing writer
			// from jumping the queue.
			this.writeWaiters.shift()!.resolve()
			return
		}
		this.writeActive = false
		if (this.readWaiters.length > 0) {
			const waiters = this.readWaiters.splice(0)
			for (const d of waiters) d.resolve()
		}
	}

	private drainWriteIfReady(): void {
		if (!this.writeActive && this.readers === 0 && this.writeWaiters.length > 0) {
			this.writeActive = true
			this.writeWaiters.shift()!.resolve()
		}
	}

	private startForceReleaseTimer(delay = MAX_READER_DRAIN_MS): void {
		this.forceReleaseTimer = setTimeout(() => {
			this.forceReleaseTimer = undefined
			if (this.readers === 0) return
			// Expire only tokens INDIVIDUALLY older than the ceiling — serialized
			// long readers (queued proves) keep the guard continuously occupied far
			// longer than any single reader runs, and expiring ALL of them would let
			// a profile delete overlap a mid-flight prove. Dropping a token orphans
			// it: the reader's `finally` delete becomes a no-op, so the count can
			// never go negative and later exclusion stays sound.
			const now = Date.now()
			let expired = 0
			let oldestRemaining = 0
			for (const [token, startedAt] of this.readerTokens) {
				if (now - startedAt >= MAX_READER_DRAIN_MS) {
					this.readerTokens.delete(token)
					expired++
				} else {
					oldestRemaining = Math.max(oldestRemaining, now - startedAt)
				}
			}
			if (expired > 0 && this.logger && this.name) {
				this.logger.log(
					this.name,
					LogLevel.Error,
					`ReadWriteGuard: force-released ${expired} stuck reader(s) after ${MAX_READER_DRAIN_MS}ms`,
				)
			}
			if (this.readers === 0) {
				this.drainWriteIfReady()
			} else {
				// Survivors: re-arm for the moment the OLDEST of them hits the ceiling.
				this.startForceReleaseTimer(Math.max(1_000, MAX_READER_DRAIN_MS - oldestRemaining))
			}
		}, delay)
	}

	private stopForceReleaseTimer(): void {
		if (this.forceReleaseTimer) {
			clearTimeout(this.forceReleaseTimer)
			this.forceReleaseTimer = undefined
		}
	}
}
