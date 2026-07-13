/**
 * Shared, in-memory deletion state for profiles — the single source of truth for
 * "which profile ids are tombstoned (reserved)" and the per-profile deletion
 * EPOCH used to fence already-running writes (D13).
 *
 * ONE instance is constructed at runtime wiring and injected into ProfileService
 * (which owns the tombstone lifecycle) + every leaf whose `purgeForProfile` runs
 * (so a worker that captured an epoch before the purge is rejected when it tries
 * to persist afterward). Kept deliberately tiny + synchronous — the reserved set
 * is loaded ONCE from the tombstone raw keys at startup and mutated only by the
 * sole tombstone writer under the facade lock.
 */
/** Binds a tx write to the profile + deletion-epoch that AUTHORIZED the
 *  execution, captured at op-start (before the slow prove). `addTransaction`
 *  asserts it's still current under the tx lock, so a purge that began mid-prove
 *  can't be out-raced by a completing execution recreating a pending tx (D13). */
export type ExecutionFence = { profileId: string; epoch: number }

export class ProfileDeletionState {
	private readonly reserved = new Set<string>()
	private readonly epochs = new Map<string, number>()

	/** Seed the reserved set from the durable tombstone raw keys at startup —
	 *  BEFORE the session is restored / any profile becomes visible. */
	public initReserved(ids: Iterable<string>): void {
		for (const id of ids) this.reserved.add(id)
	}

	/** Restore a pending deletion's EPOCH from its durable tombstone at startup —
	 *  set it to AT LEAST the persisted epoch (never below) + reserve the id. Do
	 *  NOT `beginDeletion()` on resume: blindly incrementing would diverge from the
	 *  tombstone epoch a pre-crash write may have captured (D13, codex). Called
	 *  from ProfileService.init BEFORE execution is exposed. */
	public hydrateDeletion(id: string, storedEpoch: number): void {
		this.epochs.set(id, Math.max(this.capture(id), storedEpoch))
		this.reserved.add(id)
	}

	/** A tombstoned id must be treated as ABSENT by every profile read + unlock. */
	public isReserved(id: string): boolean {
		return this.reserved.has(id)
	}

	/** Release the reservation once cleanup fully succeeds + the tombstone clears. */
	public release(id: string): void {
		this.reserved.delete(id)
	}

	/** Current deletion epoch for a profile (0 if none started). A leaf CAPTURES
	 *  this before external work, then re-checks after acquiring its own lock. */
	public capture(id: string): number {
		return this.epochs.get(id) ?? 0
	}

	/** Begin deleting a profile: reserve its id + bump the epoch so any write that
	 *  captured the prior epoch is fenced. Called under the facade lock. */
	public beginDeletion(id: string): number {
		const next = this.capture(id) + 1
		this.epochs.set(id, next)
		this.reserved.add(id)
		return next
	}

	/** Reject a persist whose captured epoch is stale (a deletion began meanwhile).
	 *  Leaves call this AFTER acquiring the same lock their `purgeForProfile` uses,
	 *  so the write either lands before the purge or is rejected after it. */
	public assertCurrent(id: string, captured: number): void {
		if (this.capture(id) !== captured) {
			throw new Error(`profile ${id} is being deleted — write rejected (epoch ${captured} → ${this.capture(id)})`)
		}
	}

	/** Non-throwing variant for best-effort worker loops that prefer to skip. */
	public isCurrent(id: string, captured: number): boolean {
		return this.capture(id) === captured
	}
}
