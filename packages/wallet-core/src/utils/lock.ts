import { type ILogger, LogLevel } from "../logger/interfaces"

/** Maximum time a lock can be held before being force-released (ms). */
const MAX_HOLD_MS = 5 * 60_000 // 5 minutes

export class Lock {
	private readonly queue: (() => void)[] = []
	private locked = false
	private readonly name?: string
	private readonly logger?: ILogger
	private acquiredAt = 0
	private forceReleaseTimer?: ReturnType<typeof setTimeout>
	private readonly maxHoldMs: number | null

	/**
	 * @param maxHoldMs force-release the lock if the holder never calls
	 *   `leave()` within this many ms (best-effort safety net). Defaults to
	 *   {@link MAX_HOLD_MS}; pass `null` to disable the watchdog entirely — for
	 *   a caller that previously hand-rolled a watchdog-less serialization and
	 *   must stay byte-for-byte equivalent (a wedged op then blocks its queue
	 *   until the SW dies, exactly as before).
	 */
	constructor(name?: string, logger?: ILogger, maxHoldMs: number | null = MAX_HOLD_MS) {
		this.name = name
		this.logger = logger
		this.maxHoldMs = maxHoldMs
	}

	public async enter() {
		// INVARIANT (hardened): once enter()'s promise resolves, ownership HAS
		// transferred — that equivalence is what withLock's leave-iff-entered
		// contract depends on. Logging and timer-arming are best-effort: a
		// throwing logger or setTimeout must never reject enter() (before
		// hardening, a post-acquisition logger throw rejected enter() with the
		// lock held and NO timer armed: stranded forever), release a lock it
		// doesn't own, or block leave(). A swallowed setTimeout failure leaves
		// the lock untimed — accepted: strictly better than a rejected enter()
		// while holding. Delimitation: Date.now()/clearTimeout are assumed
		// non-throwing platform built-ins; they are outside this guarantee.
		const waiting = this.locked
		const start = this.logger ? Date.now() : 0
		if (waiting && this.logger) {
			this.tryLog(LogLevel.Debug, `Lock: waiting (queue: ${this.queue.length})`)
		}
		await new Promise<void>((resolve) => {
			this.queue.push(resolve)
			this.dispatch()
		})
		if (this.logger) {
			const waited = Date.now() - start
			if (waited > 50) {
				this.tryLog(LogLevel.Debug, `Lock: acquired (waited ${waited}ms)`)
			}
			this.acquiredAt = Date.now()
		}
		// Safety net: force-release if holder never calls leave(). Arming is
		// best-effort under the same never-reject invariant — a throwing
		// setTimeout must not reject enter() after ownership transferred.
		// Skipped entirely when the watchdog is disabled (maxHoldMs === null).
		if (this.maxHoldMs !== null) {
			const maxHoldMs = this.maxHoldMs
			try {
				this.forceReleaseTimer = setTimeout(() => {
					if (this.locked) {
						this.tryLog(LogLevel.Error, `Lock: force-released after ${maxHoldMs}ms (holder did not call leave)`)
						this.leave()
					}
				}, maxHoldMs)
			} catch {
				// Swallowed by design: an unarmed safety timer is strictly better
				// than a rejected enter() while holding the lock.
			}
		}
	}

	/**
	 * Run `fn` under the lock. INVARIANT: `leave()` fires iff `enter()`
	 * resolved, on every exit path (return, throw, early return inside `fn`) —
	 * the contract every hand-rolled `try { enter() } finally { leave() }`
	 * frame encoded, made unforgettable. `enter()`/`leave()` stay public for
	 * callers that genuinely need split acquisition.
	 */
	public async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
		await this.enter()
		try {
			return await fn()
		} finally {
			this.leave()
		}
	}

	public leave() {
		if (this.forceReleaseTimer) {
			clearTimeout(this.forceReleaseTimer)
			this.forceReleaseTimer = undefined
		}
		if (this.logger && this.acquiredAt) {
			const held = Date.now() - this.acquiredAt
			if (held > 100) {
				this.tryLog(LogLevel.Debug, `Lock: released (held ${held}ms)`)
			}
			this.acquiredAt = 0
		}
		this.locked = false
		this.dispatch()
	}

	/** Best-effort log: a throwing logger must never affect the mutex. */
	private tryLog(level: LogLevel, message: string) {
		try {
			this.logger?.log(this.name!, level, message)
		} catch {
			// Swallowed by design — see the enter() invariant comment.
		}
	}

	private dispatch() {
		if (!this.locked && this.queue.length) {
			this.locked = true
			this.queue.shift()!()
		}
	}
}
