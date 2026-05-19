import { type ILogger, LogLevel } from "../logger/interfaces"

/** Force-release timeout for stuck readers (ms). Mirrors `Lock.MAX_HOLD_MS`.
 *  Converts a deadlock into a loud log + forced drain so the wallet
 *  recovers on its own instead of hanging forever. */
const MAX_READER_DRAIN_MS = 5 * 60_000

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
 * after 5 minutes. MV3 lacks `AsyncLocalStorage`, so we don't detect
 * reentry statically — the sync-detector approach produces false
 * positives under legitimate concurrent reads vs. writes. Callers must
 * not nest.
 */
export class ReadWriteGuard {
	private readers = 0
	private writeActive = false
	private readonly writeWaiters: Deferred<void>[] = []
	private readonly readWaiters: Deferred<void>[] = []
	private forceReleaseTimer?: ReturnType<typeof setTimeout>

	constructor(
		private readonly name?: string,
		private readonly logger?: ILogger,
	) {}

	async read<T>(fn: () => Promise<T>): Promise<T> {
		if (this.writeActive || this.writeWaiters.length > 0) {
			const d = deferred()
			this.readWaiters.push(d)
			await d.promise
		}

		if (this.readers === 0) this.startForceReleaseTimer()
		this.readers++

		try {
			return await fn()
		} finally {
			this.readers--
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

	private startForceReleaseTimer(): void {
		this.forceReleaseTimer = setTimeout(() => {
			if (this.readers > 0) {
				if (this.logger && this.name) {
					this.logger.log(
						this.name,
						LogLevel.Error,
						`ReadWriteGuard: force-released ${this.readers} stuck reader(s) after ${MAX_READER_DRAIN_MS}ms`,
					)
				}
				this.readers = 0
				this.drainWriteIfReady()
			}
			this.forceReleaseTimer = undefined
		}, MAX_READER_DRAIN_MS)
	}

	private stopForceReleaseTimer(): void {
		if (this.forceReleaseTimer) {
			clearTimeout(this.forceReleaseTimer)
			this.forceReleaseTimer = undefined
		}
	}
}
