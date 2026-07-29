/**
 * Vocabulary for the durable causal protocol.
 *
 * Counters are decimal STRINGS, not `bigint` or `number`: they are persisted as
 * JSON (where `bigint` doesn't survive) and can exceed `Number.MAX_SAFE_INTEGER`
 * over a wallet's lifetime. They are compared through `BigInt` inside the
 * protocol only.
 */

import type { ActivityScope } from "./scope"

/** A non-negative integer serialized in base 10. */
export type DecimalCounter = string

/**
 * Identifies one incarnation of a scope's data.
 *
 * A scope can be reset in place — a chain purge, an account re-add at the same
 * address, or a backup restore that reuses the profile id — after which the
 * OLD incarnation's in-flight events must never land. `generation` is the
 * monotonic ordering key that makes "older" decidable; `nonce` is opaque
 * provenance (the profile's random pxeGeneration) that catches an accidentally
 * reused generation. Only `generation` is ever compared for ordering — the
 * nonce is random and carries no order.
 */
export interface ActivityIncarnation {
	generation: DecimalCounter
	nonce: string
}

/** A record version: which incarnation produced it, and its sequence within that incarnation. */
export interface ActivityRevision {
	incarnation: ActivityIncarnation
	seq: DecimalCounter
}

/** Independently sequenced producers. Each keeps its own counter per scope. */
export type DurableActivitySource = "transaction" | "journal" | "incoming"

/**
 * A single durable change, carrying the scope it belongs to.
 *
 * The envelope's `scope` is what routing uses. A consumer MUST also verify the
 * envelope agrees with the embedded record's own scope fields before trusting
 * it — types alone cannot stop a malformed producer from wrapping one scope's
 * record in another scope's envelope.
 */
export interface ActivityMutation<T> {
	source: DurableActivitySource
	scope: ActivityScope
	recordId: string
	revision: ActivityRevision
	kind: "upsert" | "remove"
	/** Present iff `kind === "upsert"`. */
	record?: T
}

/** Authoritative reset of a scope to a new incarnation. Not a mutation — it carries no record. */
export interface ActivityScopeReset {
	control: "scope-reset"
	scope: ActivityScope
	incarnation: ActivityIncarnation
}

export interface ActivitySnapshotRecord<T> {
	recordId: string
	revision: ActivityRevision
	record: T
}

export interface ActivityTombstone {
	recordId: string
	revision: ActivityRevision
}

/**
 * A complete, authoritative view of one `(source, scope)` at `watermark`.
 *
 * `watermark` MUST be the producer's committed-through checkpoint — the highest
 * sequence whose row is durably written — never its allocation counter. A
 * watermark that ran ahead of the committed rows would claim authority over a
 * record that has not been written yet, and the reducer would then discard that
 * record's own event as already-covered.
 */
export interface ActivitySnapshot<T> {
	source: DurableActivitySource
	scope: ActivityScope
	incarnation: ActivityIncarnation
	watermark: DecimalCounter
	records: ActivitySnapshotRecord<T>[]
	tombstones: ActivityTombstone[]
}

/** Why a mutation did or did not change state. Returned for observability and tests. */
export type ApplyDecision =
	| "applied"
	/** The scope's incarnation isn't established yet; held until a snapshot establishes it. */
	| "buffered"
	/** From a retired incarnation. */
	| "stale-incarnation"
	/** At or below the authoritative snapshot coverage. */
	| "covered"
	/** Not newer than the record's current revision. */
	| "stale-seq"
	/** Not newer than the record's tombstone. */
	| "tombstoned"

/** Per-`(source, scope)` state. */
export interface SourceState<T> {
	/**
	 * Established only by an authoritative snapshot or an explicit reset.
	 * `undefined` means cold: events are buffered rather than applied, because
	 * a delayed event from a RETIRED incarnation would otherwise be
	 * indistinguishable from a live one and would render before the snapshot
	 * that supersedes it.
	 */
	incarnation?: ActivityIncarnation
	records: Map<string, { payload: T; seq: DecimalCounter }>
	tombstones: Map<string, DecimalCounter>
	/** Highest sequence an authoritative snapshot has accounted for. */
	snapshotCoverage: DecimalCounter
	/** Diagnostic only — never a rejection threshold (it would drop out-of-order distinct records). */
	maxEventSeen: DecimalCounter
	/** Events awaiting an established incarnation, in arrival order. */
	buffered: ActivityMutation<T>[]
}
