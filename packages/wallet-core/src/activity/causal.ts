/**
 * The durable causal reducer.
 *
 * Decides, for one `(source, scope)`, whether an arriving mutation or snapshot
 * changes state. Pure and synchronous: no storage, no clock, no framework. The
 * wiring layer owns persistence and routing; this owns ordering.
 *
 * Three separate notions of "how far along are we" are deliberately kept apart:
 *
 *   - `snapshotCoverage` — authoritative. A snapshot proved it accounted for
 *     every committed revision at or below this sequence, so anything at or
 *     below it is already reflected and can be ignored.
 *   - per-record `seq` / tombstone `seq` — the ordering for anything NEWER than
 *     coverage, compared per record.
 *   - `maxEventSeen` — diagnostic only. Using a source-wide maximum as a
 *     rejection threshold loses records: if record B at seq 12 arrives before
 *     record A at seq 11, a global threshold would reject A even though nothing
 *     ever accounted for it.
 */

import type { ActivityIncarnation, ActivityMutation, ActivitySnapshot, ApplyDecision, DecimalCounter, SourceState } from "./model"

const ZERO: DecimalCounter = "0"

/** Compare two decimal counters. Negative / zero / positive, like a comparator. */
export function compareCounter(a: DecimalCounter, b: DecimalCounter): number {
	const left = BigInt(a)
	const right = BigInt(b)
	return left < right ? -1 : left > right ? 1 : 0
}

/** Order two incarnations. Only `generation` carries order; `nonce` is provenance. */
export function compareIncarnation(a: ActivityIncarnation, b: ActivityIncarnation): number {
	return compareCounter(a.generation, b.generation)
}

/** Same generation AND same nonce — a generation reused with a different nonce is a different incarnation. */
export function sameIncarnation(a: ActivityIncarnation, b: ActivityIncarnation): boolean {
	return a.generation === b.generation && a.nonce === b.nonce
}

export function emptySourceState<T>(): SourceState<T> {
	return {
		incarnation: undefined,
		records: new Map(),
		tombstones: new Map(),
		snapshotCoverage: ZERO,
		maxEventSeen: ZERO,
		buffered: [],
	}
}

function cloneState<T>(state: SourceState<T>): SourceState<T> {
	return {
		incarnation: state.incarnation,
		records: new Map(state.records),
		tombstones: new Map(state.tombstones),
		snapshotCoverage: state.snapshotCoverage,
		maxEventSeen: state.maxEventSeen,
		buffered: [...state.buffered],
	}
}

function maxCounter(a: DecimalCounter, b: DecimalCounter): DecimalCounter {
	return compareCounter(a, b) >= 0 ? a : b
}

/** Apply a mutation whose incarnation is already known to match `state.incarnation`. */
function applyCurrent<T>(state: SourceState<T>, mutation: ActivityMutation<T>): { state: SourceState<T>; decision: ApplyDecision } {
	const seq = mutation.revision.seq
	const next = cloneState(state)
	next.maxEventSeen = maxCounter(next.maxEventSeen, seq)

	// An authoritative snapshot already accounted for everything at or below its
	// watermark, so re-applying this could only move state backwards.
	if (compareCounter(seq, state.snapshotCoverage) <= 0) {
		return { state: next, decision: "covered" }
	}

	const existing = state.records.get(mutation.recordId)
	if (existing && compareCounter(seq, existing.seq) <= 0) {
		return { state: next, decision: "stale-seq" }
	}

	const tombstone = state.tombstones.get(mutation.recordId)
	if (tombstone !== undefined && compareCounter(seq, tombstone) <= 0) {
		// A record legitimately re-observed later (a higher sequence) is allowed
		// back; only a revision at or below the deletion is refused.
		return { state: next, decision: "tombstoned" }
	}

	if (mutation.kind === "remove") {
		next.records.delete(mutation.recordId)
		next.tombstones.set(mutation.recordId, seq)
	} else {
		if (mutation.record === undefined) {
			throw new Error(`upsert mutation for ${mutation.recordId} carries no record`)
		}
		next.records.set(mutation.recordId, { payload: mutation.record, seq })
		next.tombstones.delete(mutation.recordId)
	}
	return { state: next, decision: "applied" }
}

/**
 * Apply one mutation.
 *
 * Mutates nothing: the caller replaces its reference with the returned state.
 * Only the passed state is ever touched, which is what keeps a mutation from
 * reaching a scope other than its own.
 */
export function applyMutation<T>(state: SourceState<T>, mutation: ActivityMutation<T>): { state: SourceState<T>; decision: ApplyDecision } {
	const current = state.incarnation

	// Cold: nothing has established which incarnation is live, so an event from
	// a retired one is indistinguishable from a live one. Hold it until a
	// snapshot (or reset) says which is which.
	if (!current) {
		const next = cloneState(state)
		next.buffered.push(mutation)
		next.maxEventSeen = maxCounter(next.maxEventSeen, mutation.revision.seq)
		return { state: next, decision: "buffered" }
	}

	const order = compareIncarnation(mutation.revision.incarnation, current)
	if (order < 0) {
		const next = cloneState(state)
		next.maxEventSeen = maxCounter(next.maxEventSeen, mutation.revision.seq)
		return { state: next, decision: "stale-incarnation" }
	}
	if (order > 0 || !sameIncarnation(mutation.revision.incarnation, current)) {
		// Newer (or a same-generation/different-nonce fork). A bare event must not
		// silently redefine the live incarnation — that authority belongs to a
		// snapshot or an explicit reset — so hold it until one arrives.
		const next = cloneState(state)
		next.buffered.push(mutation)
		next.maxEventSeen = maxCounter(next.maxEventSeen, mutation.revision.seq)
		return { state: next, decision: "buffered" }
	}

	return applyCurrent(state, mutation)
}

/** Drain buffered events that belong to the established incarnation. */
function replayBuffered<T>(state: SourceState<T>): SourceState<T> {
	const current = state.incarnation
	if (!current || state.buffered.length === 0) return state

	let next = cloneState(state)
	const pending = next.buffered
	next.buffered = []
	for (const mutation of pending) {
		const order = compareIncarnation(mutation.revision.incarnation, current)
		if (order < 0) continue // retired — drop
		if (order > 0 || !sameIncarnation(mutation.revision.incarnation, current)) {
			// Still ahead of what's established; keep holding.
			next.buffered.push(mutation)
			continue
		}
		next = applyCurrent(next, mutation).state
	}
	return next
}

/**
 * Merge an authoritative snapshot.
 *
 * A snapshot is authority AT its watermark and nothing beyond it: anything the
 * client already holds above the watermark came from an event the snapshot
 * could not have seen, so it survives untouched.
 *
 * KNOWN GAP — a COLD slice accepts whichever snapshot arrives first, and takes
 * its incarnation as authoritative. A delayed snapshot from a retired
 * incarnation therefore establishes that retired one and renders its rows until
 * a newer snapshot supersedes it. Events are already buffered against this
 * (`applyMutation`), but a snapshot cannot judge its own authority: that has to
 * come from outside, as the coordinator's persisted current-incarnation read,
 * subscribed before hydration. Buffering snapshots without that independent
 * authority only postpones trusting an untrusted first one. Close this when the
 * coordinator is wired into production — see the plan's §5.2.
 */
export function applySnapshot<T>(state: SourceState<T>, snapshot: ActivitySnapshot<T>): { state: SourceState<T>; accepted: boolean } {
	const current = state.incarnation

	if (current) {
		const order = compareIncarnation(snapshot.incarnation, current)
		if (order < 0) return { state, accepted: false }
		if (order === 0 && !sameIncarnation(snapshot.incarnation, current)) {
			// Same generation, different nonce: a reused generation. Refuse rather
			// than silently merging two different incarnations' rows together.
			return { state, accepted: false }
		}
		if (order > 0) {
			// A newer incarnation supersedes everything: the previous incarnation's
			// records are gone, not merged.
			const reset = emptySourceState<T>()
			reset.incarnation = snapshot.incarnation
			reset.buffered = [...state.buffered]
			return { state: replayBuffered(installSnapshot(reset, snapshot)), accepted: true }
		}
		// Same incarnation: a snapshot older than our coverage adds nothing.
		if (compareCounter(snapshot.watermark, state.snapshotCoverage) < 0) {
			return { state, accepted: false }
		}
	}

	const base = current ? cloneState(state) : { ...emptySourceState<T>(), buffered: [...state.buffered], maxEventSeen: state.maxEventSeen }
	base.incarnation = snapshot.incarnation
	return { state: replayBuffered(installSnapshot(base, snapshot)), accepted: true }
}

/** Merge snapshot rows/tombstones into `base`, which is already on the snapshot's incarnation. */
function installSnapshot<T>(base: SourceState<T>, snapshot: ActivitySnapshot<T>): SourceState<T> {
	const watermark = snapshot.watermark
	const next = cloneState(base)

	applySnapshotTombstones(next, snapshot.tombstones)
	const inSnapshot = applySnapshotRows(next, snapshot.records)

	// Absence is authoritative at the watermark: a record the client holds at or
	// below the watermark that the snapshot does not list has been deleted.
	for (const [recordId, held] of [...next.records]) {
		if (inSnapshot.has(recordId)) continue
		if (compareCounter(held.seq, watermark) <= 0) next.records.delete(recordId)
	}

	next.snapshotCoverage = maxCounter(next.snapshotCoverage, watermark)
	return next
}

/** Merge tombstones in place: a client record newer than the tombstone survives; an
 *  already-known same-or-newer tombstone stays. */
function applySnapshotTombstones<T>(next: SourceState<T>, tombstones: ActivitySnapshot<T>["tombstones"]): void {
	for (const tombstone of tombstones) {
		const seq = tombstone.revision.seq
		const existing = next.records.get(tombstone.recordId)
		if (existing && compareCounter(existing.seq, seq) > 0) continue // client has something newer
		const known = next.tombstones.get(tombstone.recordId)
		if (known !== undefined && compareCounter(known, seq) >= 0) continue
		next.records.delete(tombstone.recordId)
		next.tombstones.set(tombstone.recordId, seq)
	}
}

/** Merge rows in place; returns the id set the snapshot listed (the absence-authority
 *  sweep needs it). A same-or-newer client copy wins; a later tombstone wins. */
function applySnapshotRows<T>(next: SourceState<T>, records: ActivitySnapshot<T>["records"]): Set<string> {
	const inSnapshot = new Set<string>()
	for (const row of records) {
		inSnapshot.add(row.recordId)
		const seq = row.revision.seq
		const existing = next.records.get(row.recordId)
		if (existing && compareCounter(existing.seq, seq) >= 0) continue // client has it, same or newer
		const tombstone = next.tombstones.get(row.recordId)
		if (tombstone !== undefined && compareCounter(seq, tombstone) <= 0) continue // deleted after this revision
		next.records.set(row.recordId, { payload: row.record, seq })
		next.tombstones.delete(row.recordId)
	}
	return inSnapshot
}

/**
 * Explicitly retire a scope and start a new incarnation.
 *
 * Used when the reset is known locally (chain purge, account re-add) rather
 * than learned from a snapshot. Refuses to move backwards.
 */
export function resetScope<T>(state: SourceState<T>, incarnation: ActivityIncarnation): SourceState<T> {
	if (state.incarnation && compareIncarnation(incarnation, state.incarnation) <= 0) return state
	const next = emptySourceState<T>()
	next.incarnation = incarnation
	next.buffered = [...state.buffered]
	return replayBuffered(next)
}

/** The visible records: tombstoned and superseded revisions are already excluded. */
export function liveRecords<T>(state: SourceState<T>): T[] {
	return [...state.records.values()].map((entry) => entry.payload)
}
