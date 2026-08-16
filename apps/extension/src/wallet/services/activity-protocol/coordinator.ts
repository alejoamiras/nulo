/**
 * Durable sequencing for activity records.
 *
 * Producers (transactions, journal, incoming) don't invent their own ordering:
 * they allocate a sequence here, write their row, then report the sequence
 * settled. That split is what lets a snapshot publish a watermark it can
 * actually stand behind — see `ActivityCounterRow`.
 *
 * Lock order, top to bottom, is fixed and must not be inverted:
 *
 *     profile facade  →  activity scope/incarnation  →  activity source  →  storage
 *
 * A caller already holding a source lock must never reach back for a scope
 * lock. Multi-scope work sorts scope keys before acquiring, so two callers
 * touching the same pair can't deadlock head-on.
 */

import {
	type ActivityIncarnation,
	type ActivityScope,
	type DurableActivitySource,
	activityScopeKey,
	compareCounter,
} from "@nulo/wallet-core/activity"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { EntityStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import {
	ACTIVITY_COUNTER_STORAGE_ROOT,
	ACTIVITY_INCARNATION_STORAGE_ROOT,
	ACTIVITY_TOMBSTONE_STORAGE_ROOT,
	type ActivityCounterRow,
	ActivityCounterRowSchema,
	type ActivityIncarnationRow,
	ActivityIncarnationRowSchema,
	type ActivityTombstoneRow,
	ActivityTombstoneRowSchema,
	sourceRowId,
} from "./spec"

const ZERO = "0"
const FIRST_GENERATION = "1"

function increment(counter: string): string {
	return (BigInt(counter) + 1n).toString()
}

/** 128 bits of provenance, so a generation can never be silently reused. */
function mintNonce(): string {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const EMPTY_COUNTER: ActivityCounterRow = { allocated: ZERO, committed: ZERO, settled: [] }

/**
 * Walk `committed` forward through the settled set.
 *
 * Settling is out-of-order: sequence 7 can finish before 6. The watermark may
 * only advance across an unbroken run, so this consumes `committed + 1`,
 * `committed + 2`, … for as long as they are present, and drops anything at or
 * below the new watermark (it is now implied, and keeping it would grow the row
 * without bound).
 */
function advance(row: ActivityCounterRow): ActivityCounterRow {
	const settled = new Set(row.settled)
	let committed = row.committed
	while (settled.has(increment(committed))) {
		committed = increment(committed)
		settled.delete(committed)
	}
	const remaining = [...settled].filter((seq) => compareCounter(seq, committed) > 0).sort((a, b) => compareCounter(a, b))
	return { allocated: row.allocated, committed, settled: remaining }
}

export class ActivityProtocolCoordinator {
	private readonly incarnations: EntityStorage<ActivityIncarnationRow>
	private readonly counters: EntityStorage<ActivityCounterRow>
	private readonly tombstones: EntityStorage<ActivityTombstoneRow>

	/** One lock per scope, guarding incarnation reads/writes. */
	private readonly scopeLocks = new Map<string, Lock>()
	/** One lock per (scope, source), guarding sequence bookkeeping. */
	private readonly sourceLocks = new Map<string, Lock>()

	public constructor(browserApi: BrowserApi) {
		const area = browserApi.storage.local
		this.incarnations = new EntityStorage(ACTIVITY_INCARNATION_STORAGE_ROOT, area, (raw) => ActivityIncarnationRowSchema.parse(raw))
		this.counters = new EntityStorage(ACTIVITY_COUNTER_STORAGE_ROOT, area, (raw) => ActivityCounterRowSchema.parse(raw))
		this.tombstones = new EntityStorage(ACTIVITY_TOMBSTONE_STORAGE_ROOT, area, (raw) => ActivityTombstoneRowSchema.parse(raw))
	}

	private lockFor(map: Map<string, Lock>, key: string): Lock {
		let lock = map.get(key)
		if (!lock) {
			lock = new Lock()
			map.set(key, lock)
		}
		return lock
	}

	private async withScope<T>(scopeKey: string, op: () => Promise<T>): Promise<T> {
		return this.lockFor(this.scopeLocks, scopeKey).withLock(op)
	}

	private async withSource<T>(scopeKey: string, source: DurableActivitySource, op: () => Promise<T>): Promise<T> {
		return this.lockFor(this.sourceLocks, sourceRowId(scopeKey, source)).withLock(op)
	}

	/** The scope's live incarnation, minted on first use. */
	public async currentIncarnation(scope: ActivityScope): Promise<ActivityIncarnation> {
		const scopeKey = activityScopeKey(scope)
		return this.withScope(scopeKey, async () => {
			const existing = await this.incarnations.get(scopeKey)
			if (existing) return { generation: existing.generation, nonce: existing.nonce }
			const minted: ActivityIncarnationRow = { generation: FIRST_GENERATION, nonce: mintNonce() }
			await this.incarnations.set(scopeKey, minted)
			return { generation: minted.generation, nonce: minted.nonce }
		})
	}

	/**
	 * Retire this scope's data and start a new incarnation.
	 *
	 * For an in-place reset — a chain purge, an account re-added at the same
	 * address, a restore that reuses the profile id — where the scope key stays
	 * the same but everything under it is now a different dataset. Sequences and
	 * tombstones restart, because they only have meaning within one incarnation.
	 */
	public async retireScope(scope: ActivityScope): Promise<ActivityIncarnation> {
		const scopeKey = activityScopeKey(scope)
		return this.withScope(scopeKey, async () => {
			const existing = await this.incarnations.get(scopeKey)
			const next: ActivityIncarnationRow = {
				generation: existing ? increment(existing.generation) : FIRST_GENERATION,
				nonce: mintNonce(),
			}
			await this.incarnations.set(scopeKey, next)
			for (const source of ["transaction", "journal", "incoming"] as const) {
				await this.counters.delete(sourceRowId(scopeKey, source))
				await this.tombstones.delete(sourceRowId(scopeKey, source))
			}
			return { generation: next.generation, nonce: next.nonce }
		})
	}

	/**
	 * Reserve the next sequence for a write that is about to happen.
	 *
	 * The reservation is durable before the caller writes its row, so a crash
	 * mid-write can never hand the same sequence out twice. The caller MUST
	 * follow up with `settle` (on success) or `abandon` (on failure), or the
	 * watermark stalls at the gap.
	 */
	public async allocate(scope: ActivityScope, source: DurableActivitySource): Promise<string> {
		const scopeKey = activityScopeKey(scope)
		return this.withSource(scopeKey, source, async () => {
			const id = sourceRowId(scopeKey, source)
			const row = (await this.counters.get(id)) ?? EMPTY_COUNTER
			const allocated = increment(row.allocated)
			await this.counters.set(id, { ...row, allocated })
			return allocated
		})
	}

	/** Report a sequence's row durably written. Advances the watermark when it can. */
	public async settle(scope: ActivityScope, source: DurableActivitySource, seq: string): Promise<void> {
		await this.record(scope, source, seq)
	}

	/**
	 * Report a sequence that will never be written (its write failed).
	 *
	 * Identical bookkeeping to `settle`: the point is only to fill the hole so
	 * the watermark can move past it. Without this an abandoned allocation would
	 * pin the watermark below every later record, forever.
	 */
	public async abandon(scope: ActivityScope, source: DurableActivitySource, seq: string): Promise<void> {
		await this.record(scope, source, seq)
	}

	private async record(scope: ActivityScope, source: DurableActivitySource, seq: string): Promise<void> {
		const scopeKey = activityScopeKey(scope)
		await this.withSource(scopeKey, source, async () => {
			const id = sourceRowId(scopeKey, source)
			const row = (await this.counters.get(id)) ?? EMPTY_COUNTER
			if (compareCounter(seq, row.committed) <= 0) return // already implied by the watermark
			const next = advance({ ...row, settled: [...new Set([...row.settled, seq])] })
			await this.counters.set(id, next)
		})
	}

	/** The watermark a snapshot of this `(scope, source)` may publish. */
	public async watermark(scope: ActivityScope, source: DurableActivitySource): Promise<string> {
		const scopeKey = activityScopeKey(scope)
		const row = await this.counters.get(sourceRowId(scopeKey, source))
		return row?.committed ?? ZERO
	}

	/** Record a deletion so a late write can't bring the row back. */
	public async tombstone(scope: ActivityScope, source: DurableActivitySource, recordId: string, seq: string): Promise<void> {
		const scopeKey = activityScopeKey(scope)
		await this.withSource(scopeKey, source, async () => {
			const id = sourceRowId(scopeKey, source)
			const row = (await this.tombstones.get(id)) ?? { tombstones: {} }
			const held = row.tombstones[recordId]
			if (held !== undefined && compareCounter(held, seq) >= 0) return
			await this.tombstones.set(id, { tombstones: { ...row.tombstones, [recordId]: seq } })
		})
	}

	public async tombstonesFor(scope: ActivityScope, source: DurableActivitySource): Promise<Record<string, string>> {
		const scopeKey = activityScopeKey(scope)
		const row = await this.tombstones.get(sourceRowId(scopeKey, source))
		return row?.tombstones ?? {}
	}

	/**
	 * Drop every trace of a scope.
	 *
	 * Used when the scope itself is gone (its profile was deleted), as opposed
	 * to `retireScope`, which keeps the scope and starts it over.
	 */
	public async purgeScope(scope: ActivityScope): Promise<void> {
		const scopeKey = activityScopeKey(scope)
		await this.withScope(scopeKey, async () => {
			await this.incarnations.delete(scopeKey)
			for (const source of ["transaction", "journal", "incoming"] as const) {
				await this.counters.delete(sourceRowId(scopeKey, source))
				await this.tombstones.delete(sourceRowId(scopeKey, source))
			}
		})
	}

	/**
	 * Drop every scope belonging to a profile.
	 *
	 * Scope keys embed the profile id, so this matches on the encoded key rather
	 * than requiring the caller to enumerate the profile's networks and accounts
	 * — a list that is already being torn down when this runs.
	 */
	public async purgeProfile(profileId: string): Promise<void> {
		const prefix = JSON.stringify(profileId)
		const belongs = (key: string) => key.startsWith(`[${prefix},`)

		for (const [key] of await this.incarnations.getAll()) {
			if (belongs(key)) await this.incarnations.delete(key)
		}
		for (const store of [this.counters, this.tombstones]) {
			for (const [key] of await store.getAll()) {
				if (belongs(key)) await store.delete(key)
			}
		}
	}
}
