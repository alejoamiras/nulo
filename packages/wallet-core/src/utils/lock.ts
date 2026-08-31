import { type ILogger, LogLevel } from "../logger/interfaces"

/** Maximum time a lock can be held before being force-released (ms). */
const MAX_HOLD_MS = 5 * 60_000 // 5 minutes

declare const LOCK_TICKET_BRAND: unique symbol

/**
 * Opaque per-acquisition ownership proof. Minted at HANDOFF (never at
 * enqueue), so a queued waiter can only ever observe a ticket that is
 * current the instant it is granted. Runtime-unforgeable (per-grant symbol
 * identity) AND type-branded — a bare `symbol` variable does not typecheck,
 * so a wrong-symbol `leave()` is a compile error, not just a runtime no-op.
 */
export type LockTicket = symbol & { readonly [LOCK_TICKET_BRAND]: never }

export class Lock {
	private readonly queue: ((ticket: LockTicket) => void)[] = []
	private locked = false
	private currentTicket: LockTicket | null = null
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
	 *   must stay byte-for-byte equivalent, or one whose long holds are BY
	 *   DESIGN (a force-release there would admit a second critical section
	 *   into a legitimately-running one; queueing is the correct semantic).
	 */
	constructor(name?: string, logger?: ILogger, maxHoldMs: number | null = MAX_HOLD_MS) {
		this.name = name
		this.logger = logger
		this.maxHoldMs = maxHoldMs
	}

	public async enter(): Promise<LockTicket> {
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
		const ticket = await new Promise<LockTicket>((resolve) => {
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
		return ticket
	}

	/**
	 * Run `fn` under the lock. INVARIANT: `leave()` fires iff `enter()`
	 * resolved, on every exit path (return, throw, early return inside `fn`) —
	 * the contract every hand-rolled `try { enter() } finally { leave() }`
	 * frame encoded, made unforgettable. `enter()`/`leave()` stay public for
	 * callers that genuinely need split acquisition.
	 *
	 * `fn` receives `isCurrent` — true while this acquisition still owns the
	 * lock. After a watchdog force-release admits a successor, the displaced
	 * critical section keeps RUNNING (see the dispatch() limitation note);
	 * checking `isCurrent()` immediately before a write is how such a section
	 * declines to clobber state a successor may have advanced.
	 */
	public async withLock<T>(fn: (isCurrent: () => boolean) => Promise<T> | T): Promise<T> {
		const ticket = await this.enter()
		try {
			return await fn(() => ticket === this.currentTicket)
		} finally {
			this.leave(ticket)
		}
	}

	/**
	 * Release the lock — but ONLY for its current owner. A stale ticket (the
	 * holder was force-released and the lock has moved on) is a logged no-op:
	 * anything else would let the displaced holder's late `finally` release
	 * the CURRENT holder's acquisition, collapsing mutual exclusion. The
	 * ticket check MUST stay the first statement — clearing the timer before
	 * it would let a stale leave disarm the current holder's watchdog while
	 * every ownership assertion still passes.
	 */
	public leave(ticket: LockTicket) {
		if (ticket !== this.currentTicket) {
			this.tryLog(LogLevel.Warn, "Lock: stale leave() ignored (holder was force-released; lock has moved on)")
			return
		}
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
		this.currentTicket = null
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
			// The one trusted mint site — the only place the brand is applied.
			const ticket = Symbol("lock-ticket") as LockTicket
			this.currentTicket = ticket
			// Safety net: force-release if the holder never calls leave(). The
			// callback guards on ITS OWN ticket (not just `locked`) so a timer
			// whose grant was already superseded can never force-release the
			// successor. Arming is best-effort under enter()'s never-reject
			// invariant (dispatch runs inside the enter() promise executor).
			// LIMITATION (accepted, documented): a force-release admits the next
			// waiter while the displaced holder's critical section may still be
			// RUNNING — tickets stop the displaced holder from releasing anyone
			// else's turn, they cannot un-run its remaining code. Locks whose
			// long holds are by design must pass `maxHoldMs: null` instead.
			if (this.maxHoldMs !== null) {
				const maxHoldMs = this.maxHoldMs
				try {
					this.forceReleaseTimer = setTimeout(() => {
						if (this.currentTicket === ticket) {
							this.tryLog(LogLevel.Error, `Lock: force-released after ${maxHoldMs}ms (holder did not call leave)`)
							this.forceReleaseTimer = undefined
							this.currentTicket = null
							this.locked = false
							this.dispatch()
						}
					}, maxHoldMs)
				} catch {
					// Swallowed by design: an unarmed safety timer is strictly better
					// than a rejected enter() while holding the lock.
				}
			}
			this.queue.shift()!(ticket)
		}
	}
}
