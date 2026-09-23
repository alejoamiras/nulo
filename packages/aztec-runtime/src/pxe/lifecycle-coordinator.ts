/**
 * Q-01: the per-chain purge-epoch fence, extracted from `PxeService`'s
 * god-class. Owns the epoch counter and the fence operations that were
 * duplicated byte-for-byte across `withPxeRead` and `withPxeWrite` — the
 * self-documented "concurrency audit MED #4" recurring bug class (the read path
 * fenced chain-resurrection first; the write path grew the same fence later).
 * Centralizing it gives that fence one home, so a third op path can't
 * re-introduce the bug by forgetting to copy the check.
 *
 * The invariant (issue #281 review): `clearChainState` {@link bump}s a chain's
 * epoch at BOTH ends of its destructive section (B-18), so an in-flight op that
 * captured the prior value via {@link current} cannot RESURRECT a just-purged
 * chain — its write-rebind step would otherwise re-create the runtime + a fresh
 * OPFS store dir for a chain whose network row is gone (nothing ever removes
 * that dir again). A read that entered BEFORE the purge refuses to rebind (its
 * {@link assertUnchanged} throws); a new op after the purge sees the new epoch
 * at entry and may legitimately re-create.
 */
export class PxeLifecycleCoordinator {
	readonly #epochs = new Map<string, number>()

	/** Monotonically advance a chain's purge epoch. Called at both ends of
	 *  `clearChainState`'s destructive section. */
	public bump(key: string): void {
		this.#epochs.set(key, (this.#epochs.get(key) ?? 0) + 1)
	}

	/** A chain's current purge epoch (0 if unseen). Read synchronously at op
	 *  entry — BEFORE the first await — to capture the value to fence against. */
	public current(key: string): number {
		return this.#epochs.get(key) ?? 0
	}

	/**
	 * Throw if the chain's purge epoch advanced since `captured` — an op that
	 * captured the prior value must NOT re-create the runtime/store for a chain
	 * that was purged mid-operation. The message is stable (callers/tests match
	 * on "purged mid-operation").
	 */
	public assertUnchanged(key: string, captured: number, label: string): void {
		if (this.current(key) !== captured) {
			throw new Error(`${label}: chain was purged mid-operation — refusing to re-create its runtime/store`)
		}
	}
}
