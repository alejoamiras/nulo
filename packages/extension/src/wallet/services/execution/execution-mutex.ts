/**
 * Per-key FIFO mutex serializing dApp transaction EXECUTION within a
 * `(profileId, chainId)` scope.
 *
 * Why a bespoke primitive instead of `@nulo/wallet-core`'s `Lock`: that lock
 * force-releases after 5 minutes to avoid deadlocks. Proving on a slow runner
 * legitimately exceeds 5 minutes, and a force-release mid-prove would let the
 * next transaction start building against the PXE while the holder is still
 * proving — exactly the stale-private-note interleaving this mutex exists to
 * prevent. So: NO timeout, NO force-release.
 *
 * Correctness role (v3 — see implementations-plan/dapp-interaction-lock-fix-v3):
 * once the FIFO baton is released at popup approval, two approved sendTx can
 * both reach execution. `withPxeWrite` serializes individual PXE calls but NOT
 * the build→simulate→prove→submit lifecycle, so without this mutex T1 and T2
 * could simulate against the same private-note snapshot and T2's tx would be
 * rejected on-chain (double-spent nullifier). The NO_FROM path has no nonce at
 * all, so it relies entirely on this serialization. Hold the mutex from before
 * authwit discovery through submit, for both send paths.
 *
 * Keyed `(profileId, chainId)` to match PXE's own `chainGuard` (one PXE runtime
 * per profile+chain). Per-account would under-serialize: two accounts on one
 * chain share the runtime and the chainGuard.
 *
 * Abort: `acquire` accepts an `AbortSignal` so a queued waiter (a "Queued"
 * journal record the user can cancel) can be released from the wait. Aborting
 * while waiting splices the waiter out WITHOUT breaking FIFO ordering for
 * everyone behind it (the successor still waits for the real prior holder).
 */

/** Thrown from `acquire` when the provided `AbortSignal` fires before the slot
 *  is granted. Distinct class so callers can map it onto their cancel pipeline
 *  (→ `JobCancelledSentinel` → EIP-1193 4001) rather than treating it as a
 *  generic failure. */
export class ExecutionMutexAbortError extends Error {
	public constructor(key: string) {
		super(`ExecutionMutex acquire aborted while waiting on key "${key}"`)
		this.name = "ExecutionMutexAbortError"
	}
}

/** Thrown from `acquire` when a backpressure cap is hit BEFORE enqueue — either
 *  the per-origin contribution cap or the coarse total-lane cap. Distinct class
 *  so the caller can map it onto the dApp-facing `TooManyPendingError` (→ -32005)
 *  rather than a generic failure. The `key` is the internal lane key
 *  (profileId:chainId); it is NOT surfaced to the dApp (no origin/profile oracle). */
export class ExecutionMutexCapacityError extends Error {
	public constructor(key: string) {
		super(`ExecutionMutex capacity reached for key "${key}"`)
		this.name = "ExecutionMutexCapacityError"
	}
}

/** Backpressure caps for a capped `acquire`. When present, the per-origin and
 *  total-lane depths are tracked and enforced. `originKey` MUST be the canonical
 *  browser origin (NOT a display name or sessionId — both are spoofable/multipliable). */
export type AcquireCaps = {
	originKey: string
	maxOriginDepth: number
	maxLaneDepth: number
}

/** Release callback returned by `acquire`. Idempotent — calling it more than
 *  once is a no-op. MUST be called (use `try/finally`) or the key stays locked
 *  forever. */
export type ExecutionMutexRelease = () => void

export class ExecutionMutex {
	/** Per-key tail of the FIFO chain. The promise stored here resolves when the
	 *  most-recently-enqueued waiter for the key releases. A fresh acquirer
	 *  awaits the current tail, then installs its own promise as the new tail. */
	private readonly tails = new Map<string, Promise<void>>()

	/** Per-lane depth (waiting + holding). Tracked ONLY for capped acquires, so
	 *  uncapped callers (and the FIFO-mechanics unit tests) are unaffected. */
	private readonly laneDepth = new Map<string, number>()
	/** Per-(lane, origin) depth, keyed `${laneKey}|${originKey}` (a lane key
	 *  `profileId:chainId` and a browser origin both exclude `|`, so the join is
	 *  unambiguous — and ASCII, unlike a NUL separator which makes git treat the
	 *  source as binary). */
	private readonly originDepth = new Map<string, number>()

	/**
	 * Acquire the lock for `key`, FIFO. Resolves with a release callback once
	 * the slot is granted. If `signal` fires before the grant, rejects with
	 * `ExecutionMutexAbortError` and removes this waiter from the chain without
	 * disturbing FIFO order for successors.
	 *
	 * When `caps` is given, a backpressure cap is enforced BEFORE enqueue: reject
	 * with `ExecutionMutexCapacityError` if the per-origin OR total-lane depth is
	 * already at its limit. A capacity reject mutates nothing. Depth is
	 * incremented only after passing both caps, and decremented exactly once in
	 * `release` (the sole decrement path) — an aborted waiter's slot is freed when
	 * its chained release fires (conservative over-count; never an under-count, so
	 * the cap cannot be bypassed).
	 */
	public async acquire(key: string, signal?: AbortSignal, caps?: AcquireCaps): Promise<ExecutionMutexRelease> {
		// Fast reject: already aborted before we even enqueue.
		if (signal?.aborted) throw new ExecutionMutexAbortError(key)

		// Backpressure cap — checked + applied atomically before enqueue.
		const originDepthKey = caps ? `${key}|${caps.originKey}` : undefined
		if (caps && originDepthKey) {
			const laneNow = this.laneDepth.get(key) ?? 0
			const originNow = this.originDepth.get(originDepthKey) ?? 0
			if (laneNow >= caps.maxLaneDepth || originNow >= caps.maxOriginDepth) {
				throw new ExecutionMutexCapacityError(key)
			}
			this.laneDepth.set(key, laneNow + 1)
			this.originDepth.set(originDepthKey, originNow + 1)
		}

		const prior = this.tails.get(key) ?? Promise.resolve()

		// `mine` resolves when WE release. The next acquirer will await it.
		let resolveMine!: () => void
		const mine = new Promise<void>((resolve) => {
			resolveMine = resolve
		})
		this.tails.set(key, mine)

		let released = false
		const release: ExecutionMutexRelease = () => {
			if (released) return
			released = true
			// GC the key if no one enqueued behind us (tail still points at mine).
			if (this.tails.get(key) === mine) this.tails.delete(key)
			// Sole decrement path for the depth counters (idempotent via `released`).
			if (originDepthKey) {
				const lane = (this.laneDepth.get(key) ?? 1) - 1
				if (lane <= 0) this.laneDepth.delete(key)
				else this.laneDepth.set(key, lane)
				const origin = (this.originDepth.get(originDepthKey) ?? 1) - 1
				if (origin <= 0) this.originDepth.delete(originDepthKey)
				else this.originDepth.set(originDepthKey, origin)
			}
			resolveMine()
		}

		if (!signal) {
			// No abort: simple — wait for the prior holder, then we hold it.
			await prior
			return release
		}

		// Abortable wait. We race `prior` against the abort signal.
		try {
			await this.waitForPriorOrAbort(prior, signal, key)
		} catch (err) {
			// Aborted while waiting. We must NOT strand successors: anyone who
			// enqueued behind us is awaiting `mine`. Chain `mine`'s resolution to
			// the REAL prior holder so the successor still serializes correctly
			// (it proceeds only after `prior` actually completes), and so the key
			// is GC'd if we were the tail. The chained release also decrements the
			// depth counters (conservative over-count until `prior` settles).
			//
			// `released` guard makes this safe even if a (buggy) double-fire of the
			// signal occurs — only the first resolves.
			void prior.finally(release)
			throw err
		}

		return release
	}

	/** Resolve when `prior` settles; reject with `ExecutionMutexAbortError` if
	 *  `signal` fires first. Detaches its own listener either way. */
	private waitForPriorOrAbort(prior: Promise<void>, signal: AbortSignal, key: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const onAbort = () => {
				cleanup()
				reject(new ExecutionMutexAbortError(key))
			}
			const cleanup = () => signal.removeEventListener("abort", onAbort)
			signal.addEventListener("abort", onAbort, { once: true })
			// `prior` never rejects (release callbacks only resolve), but `.then`
			// with both arms keeps us robust if that ever changes.
			prior.then(
				() => {
					cleanup()
					resolve()
				},
				() => {
					cleanup()
					resolve()
				},
			)
		})
	}

	/** Test/diagnostic: is `key` currently held or has waiters enqueued. */
	public isLocked(key: string): boolean {
		return this.tails.has(key)
	}
}
