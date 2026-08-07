/**
 * EstimateCancelRegistry — cancellation + admission control for fee estimates.
 *
 * Estimates have no journal record, so `ExecutionLane.cancelJob` cannot cover
 * them; this registry is the estimate-side equivalent, keyed by a caller-minted
 * token instead of a journal id. Its contract (audit-pinned, see
 * implementations-plan/fee-estimation-speedup/plan.md architecture §4):
 *
 * - **Admission is atomic against real work, not bookkeeping.** At most
 *   `MAX_ACTIVE_ESTIMATES_PER_PROFILE` UNSETTLED underlying jobs per profile.
 *   A cancelled job does NOT free capacity — the underlying simulation is
 *   non-preemptible and keeps its queue slot until it settles — so admission
 *   counts entries until `settle()`, never until cancel.
 * - **Overflow = cancel-oldest + coalesce-newest.** The newcomer parks in a
 *   single latest-wins pending slot per (profile, flowKey) and is admitted
 *   only when a job actually settles. A newer arrival on the same slot
 *   rejects the parked one with `JobCancelledSentinel`.
 * - **Duplicate tokens are rejected loudly** (a second estimate must never be
 *   able to clear the first one's entry by completing).
 * - **cancel = abort-if-running AND evict-if-stashed**, including after the
 *   job settled: `settle()` moves the token → estimateId mapping into a
 *   TTL-bounded settled map so a cancel racing completion still evicts the
 *   stashed signed tx request. `settle()` itself evicts instead of recording
 *   when the entry was aborted mid-flight — closing the stash-then-settle
 *   race window entirely.
 * - **Foreign/unknown tokens no-op silently** (existence non-disclosure,
 *   matching `cancelJob`).
 * - **TTL sweep** reaps entries whose runner died without settling (dead RPC,
 *   SW hiccup) so controllers can't leak until restart.
 */

import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"

export const MAX_ACTIVE_ESTIMATES_PER_PROFILE = 4
/** Parked admissions beyond this per profile are rejected outright — a
 *  many-operation dApp interaction must not mint unbounded parked promises. */
export const MAX_PENDING_ESTIMATES_PER_PROFILE = 8
/** A runner that hasn't settled after this long is presumed dead and reaped.
 *  MUST stay comfortably above the worst-case estimate transport chain
 *  (~5 sequential PXE RPCs × their 90 s timeouts): every RPC rejection
 *  reaches `withEstimateAdmission`'s finally → settle, so by this horizon a
 *  reaped entry's underlying job has provably settled or died at the
 *  transport layer — freeing its slot then cannot over-admit past the cap
 *  while non-preemptible ACVM work still runs. */
export const ESTIMATE_JOB_TTL_MS = 15 * 60 * 1000
/** How long a settled token can still evict its stash — mirrors the reuse TTL. */
export const SETTLED_STASH_TTL_MS = 120_000

interface ActiveEntry {
	readonly profileId: string
	readonly flowKey: string
	readonly controller: AbortController
	readonly startedAt: number
}

interface PendingEntry {
	readonly token: string
	readonly profileId: string
	readonly flowKey: string
	readonly parkedAt: number
	readonly resolve: (signal: AbortSignal) => void
	readonly reject: (err: unknown) => void
}

interface SettledStash {
	readonly profileId: string
	readonly estimateId: string
	readonly settledAt: number
}

export interface EstimateCancelRegistryDeps {
	/** Evict a stashed reuse entry by its estimateId. Must be idempotent. */
	evictStash(estimateId: string): void
	logDebug(msg: string): void
	/** Injectable clock for tests. */
	now?(): number
}

export class EstimateCancelRegistry {
	private readonly active = new Map<string, ActiveEntry>()
	private readonly pending = new Map<string, PendingEntry>()
	private readonly settled = new Map<string, SettledStash>()

	public constructor(private readonly deps: EstimateCancelRegistryDeps) {}

	private now(): number {
		return this.deps.now?.() ?? Date.now()
	}

	private pendingKey(profileId: string, flowKey: string): string {
		return `${profileId}|${flowKey}`
	}

	private activeCount(profileId: string): number {
		let n = 0
		for (const entry of this.active.values()) if (entry.profileId === profileId) n++
		return n
	}

	/** Test/introspection surface: unsettled underlying jobs for a profile. */
	public unsettledCount(profileId: string): number {
		return this.activeCount(profileId)
	}

	/**
	 * Request admission for a new estimate job. Resolves with the job's
	 * AbortSignal — immediately under capacity, or after another job settles
	 * when parked. Throws on duplicate tokens; a parked entry superseded by a
	 * newer same-slot arrival rejects with `JobCancelledSentinel`.
	 */
	public admit(token: string, profileId: string, flowKey: string): Promise<AbortSignal> {
		this.sweep()
		if (this.active.has(token) || this.settled.has(token)) {
			throw new Error("duplicate estimate token")
		}
		for (const parked of this.pending.values()) {
			if (parked.token === token) throw new Error("duplicate estimate token")
		}

		if (this.activeCount(profileId) < MAX_ACTIVE_ESTIMATES_PER_PROFILE) {
			return Promise.resolve(this.activate(token, profileId, flowKey))
		}

		// Over capacity. Latest-intent-wins applies WITHIN a flow slot only:
		// a newer arrival for the SAME slot supersedes its predecessor (that
		// is the newer intent for that operation), but a different slot's job
		// must survive — aborting it would silently destroy an estimate the
		// user still needs, and no path ever refires it (a 5-operation
		// approval window would lose operation #1's estimate outright).
		const oldest = this.oldestActive(profileId, flowKey)
		if (oldest) this.abortEntry(oldest.token, oldest.entry)

		const key = this.pendingKey(profileId, flowKey)
		const superseded = this.pending.get(key)
		if (superseded) {
			superseded.reject(new JobCancelledSentinel(superseded.token))
		} else {
			// Bound the parked set: distinct flow slots each hold one promise,
			// so without a cap a many-op interaction mints unbounded parked
			// work. Reject-newcomer (not evict-oldest): the oldest parked ops
			// are the ones the user has been waiting on longest.
			let parkedForProfile = 0
			for (const entry of this.pending.values()) {
				if (entry.profileId === profileId) parkedForProfile++
			}
			if (parkedForProfile >= MAX_PENDING_ESTIMATES_PER_PROFILE) {
				throw new JobCancelledSentinel(token)
			}
		}
		return new Promise<AbortSignal>((resolve, reject) => {
			this.pending.set(key, { token, profileId, flowKey, parkedAt: this.now(), resolve, reject })
			this.deps.logDebug(`estimate admission parked (${flowKey}): profile at capacity`)
		})
	}

	/**
	 * Record that the runner finished (success, failure, or cancel). Frees the
	 * capacity slot and admits the oldest parked job that now fits. When the
	 * runner produced a stashed reuse entry, the token→estimateId mapping is
	 * retained for post-completion eviction — unless the job was aborted
	 * mid-flight (the runner's stash may have landed before its next
	 * cancellation checkpoint) or already TTL-reaped, in which cases the
	 * stash is evicted right here.
	 */
	public settle(token: string, estimateId?: string): void {
		const entry = this.active.get(token)
		if (!entry) {
			// A TTL-reaped runner completing late: its slot is long gone and no
			// caller can cancel it anymore, so its stash must not outlive it.
			if (estimateId) this.deps.evictStash(estimateId)
			return
		}
		this.active.delete(token)
		if (estimateId) {
			if (entry.controller.signal.aborted) {
				this.deps.evictStash(estimateId)
			} else {
				this.settled.set(token, { profileId: entry.profileId, estimateId, settledAt: this.now() })
			}
		}
		this.admitNext()
	}

	/**
	 * Cancel by token, gated on the caller's active profile. Silent no-op for
	 * unknown or foreign tokens.
	 */
	public cancel(token: string, activeProfileId: string): void {
		const parked = this.findPending(token)
		if (parked) {
			if (parked.entry.profileId !== activeProfileId) return
			this.pending.delete(parked.key)
			parked.entry.reject(new JobCancelledSentinel(token))
			return
		}
		const entry = this.active.get(token)
		if (entry) {
			if (entry.profileId !== activeProfileId) return
			this.abortEntry(token, entry)
			return
		}
		const done = this.settled.get(token)
		if (done) {
			if (done.profileId !== activeProfileId) return
			this.settled.delete(token)
			this.deps.evictStash(done.estimateId)
		}
	}

	private activate(token: string, profileId: string, flowKey: string): AbortSignal {
		const controller = new AbortController()
		this.active.set(token, { profileId, flowKey, controller, startedAt: this.now() })
		return controller.signal
	}

	private abortEntry(token: string, entry: ActiveEntry): void {
		if (!entry.controller.signal.aborted) entry.controller.abort()
		this.deps.logDebug(`estimate ${token.slice(0, 8)}… aborted (${entry.flowKey})`)
	}

	private oldestActive(profileId: string, flowKey: string): { token: string; entry: ActiveEntry } | undefined {
		let found: { token: string; entry: ActiveEntry } | undefined
		for (const [token, entry] of this.active) {
			if (entry.profileId !== profileId || entry.flowKey !== flowKey) continue
			// Skip already-aborted jobs — re-aborting frees nothing, and the
			// point of overflow-abort is to stop the oldest STILL-LIVE job.
			if (entry.controller.signal.aborted) continue
			if (!found || entry.startedAt < found.entry.startedAt) found = { token, entry }
		}
		return found
	}

	private findPending(token: string): { key: string; entry: PendingEntry } | undefined {
		for (const [key, entry] of this.pending) {
			if (entry.token === token) return { key, entry }
		}
		return undefined
	}

	private admitNext(): void {
		// Reap dead parked entries HERE, not only in sweep(): settle() calls
		// admitNext directly, and admitting a caller that gave up long ago
		// would run a full pipeline for nobody.
		const now = this.now()
		for (const [key, entry] of this.pending) {
			if (now - entry.parkedAt <= ESTIMATE_JOB_TTL_MS) continue
			this.pending.delete(key)
			entry.reject(new JobCancelledSentinel(entry.token))
			this.deps.logDebug(`estimate ${entry.token.slice(0, 8)}… reaped: parked past TTL`)
		}
		let oldest: { key: string; entry: PendingEntry } | undefined
		for (const [key, entry] of this.pending) {
			if (this.activeCount(entry.profileId) >= MAX_ACTIVE_ESTIMATES_PER_PROFILE) continue
			if (!oldest || entry.parkedAt < oldest.entry.parkedAt) oldest = { key, entry }
		}
		if (!oldest) return
		this.pending.delete(oldest.key)
		oldest.entry.resolve(this.activate(oldest.entry.token, oldest.entry.profileId, oldest.entry.flowKey))
	}

	private sweep(): void {
		const now = this.now()
		for (const [token, entry] of this.active) {
			if (now - entry.startedAt <= ESTIMATE_JOB_TTL_MS) continue
			this.abortEntry(token, entry)
			this.active.delete(token)
			this.deps.logDebug(`estimate ${token.slice(0, 8)}… reaped: runner never settled`)
		}
		for (const [token, done] of this.settled) {
			if (now - done.settledAt <= SETTLED_STASH_TTL_MS) continue
			this.settled.delete(token)
			// Expiring the eviction handle must not strand the stash itself.
			this.deps.evictStash(done.estimateId)
		}
		this.admitNext()
	}
}
