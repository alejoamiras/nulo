import { z } from "zod"
import type { DurableActivitySource } from "@nulo/wallet-core/activity"

export const ACTIVITY_PROTOCOL_SERVICE_NAME = "activity-protocol"

/** Per-scope incarnation. Keyed by `ActivityScopeKey`. */
export const ACTIVITY_INCARNATION_STORAGE_ROOT = "nulo:core:activity-incarnations"
/** Per-(scope, source) sequence bookkeeping. Keyed by `${scopeKey}::${source}`. */
export const ACTIVITY_COUNTER_STORAGE_ROOT = "nulo:core:activity-counters"
/** Per-(scope, source) tombstones. Keyed by `${scopeKey}::${source}`. */
export const ACTIVITY_TOMBSTONE_STORAGE_ROOT = "nulo:core:activity-tombstones"

/** A decimal, non-negative integer counter. */
const DecimalCounterSchema = z.string().regex(/^\d+$/, "expected a decimal counter")

export interface ActivityIncarnationRow {
	/** Monotonic ordering key for this scope's incarnations. */
	generation: string
	/** Opaque provenance, so a reused generation is still detectable. */
	nonce: string
}

export const ActivityIncarnationRowSchema: z.ZodType<ActivityIncarnationRow> = z.object({
	generation: DecimalCounterSchema,
	nonce: z.string().min(1),
})

/**
 * Sequence bookkeeping for one `(scope, source)`.
 *
 * Two numbers, deliberately distinct:
 *
 *   - `allocated` — the highest sequence handed out. May run ahead of what is
 *     durably written, and may gap (an allocation whose write never landed).
 *   - `committed` — the highest CONTIGUOUS sequence that is fully accounted
 *     for, i.e. every sequence at or below it has either been written or
 *     explicitly abandoned. This is the only value a snapshot may publish as
 *     its watermark: publishing `allocated` would claim authority over a row
 *     that does not exist yet, and the reducer would then discard that row's
 *     own event as already-covered.
 *
 * `settled` holds sequences accounted for ABOVE `committed` — completions that
 * arrived out of order. Each update walks `committed` forward through them, so
 * an abandoned allocation cannot wedge the watermark permanently.
 */
export interface ActivityCounterRow {
	allocated: string
	committed: string
	settled: string[]
}

export const ActivityCounterRowSchema: z.ZodType<ActivityCounterRow> = z.object({
	allocated: DecimalCounterSchema,
	committed: DecimalCounterSchema,
	settled: z.array(DecimalCounterSchema),
})

/** Deletions for one `(scope, source)`: recordId → the sequence it was removed at. */
export interface ActivityTombstoneRow {
	tombstones: Record<string, string>
}

export const ActivityTombstoneRowSchema: z.ZodType<ActivityTombstoneRow> = z.object({
	tombstones: z.record(z.string(), DecimalCounterSchema),
})

/** Storage id for the per-(scope, source) rows. */
export function sourceRowId(scopeKey: string, source: DurableActivitySource): string {
	return `${scopeKey}::${source}`
}
