/**
 * Data-preserving storage-migration engine — public types.
 *
 * Pure + `chrome.*`-free: the engine operates on an injected `MinimalStorageArea`
 * (live `chrome.storage.local` in the extension, an in-memory fake in tests, and
 * — later — a backup-blob adapter via the same seam). See `migrator.ts` for the
 * crash-safe journal that drives these.
 */

/** The minimal storage surface the engine needs — the same contract
 *  `EntityStorage` runs on, re-exported so the two cannot drift. */
export type { MinimalStorageArea } from "../storage/entity_storage"

/** A location a migration reads or writes. `root` = an EntityStorage namespace
 *  (rows keyed `${root}@${id}`); `value` = a single ValueStorage key. The engine
 *  snapshots exactly the union of a migration's `reads` + `writes` before running
 *  it, so the footprint must be declared accurately. */
export type StorageRef = { kind: "root"; root: string } | { kind: "value"; key: string }

/** The staged data surface a migration's `up()` operates on. Reads see the
 *  pre-migration store overlaid with the migration's own staged writes
 *  (read-your-writes); writes accumulate in a staging buffer that the engine
 *  commits as one batched diff AFTER `up()` succeeds — never mid-migration.
 *
 *  The type parameters are call-site ASSERTIONS, not validations — persisted
 *  rows are untrusted input, and the engine cannot know their shape. Declare
 *  the shape you expect (typically the PRE-migration shape for reads), then
 *  still guard field access (`hasProperty`-style presence checks) exactly as
 *  `template.ts` shows: a hostile or half-written row must fail the migration
 *  (fail-closed), not silently produce garbage. */
export interface MigrationArea {
	/** All rows of an EntityStorage `root` as `[id, value]`. Raw read — unlike
	 *  `EntityStorage.getAll`, a malformed row THROWS (fail-closed) rather than
	 *  being silently dropped, so a migration never loses data unnoticed. */
	rows<T = unknown>(root: string): Promise<Array<[string, T]>>
	/** Stage upserts (`[id, value]`) and deletes (ids) for a `root`. */
	setRows<T = unknown>(root: string, upserts: Array<[string, T]>, deletes?: string[]): Promise<void>
	/** A single value key (parsed), or `undefined` if absent. */
	value<T = unknown>(key: string): Promise<T | undefined>
	/** Stage a single value write. */
	setValue<T = unknown>(key: string, value: T): Promise<void>
	/** Stage a single value delete. */
	deleteValue(key: string): Promise<void>
}

/** What a migration's `up()` receives. `session` is intentionally absent in v1
 *  (ephemeral storage can't be tracked by a durable version marker). */
export interface MigrationContext {
	local: MigrationArea
}

/** One numbered, forward-only, idempotent migration. */
export interface Migration {
	/** Strictly-increasing integer. Applied when `version > persisted`. */
	version: number
	/** Human summary (documentation only). */
	description: string
	/** `true` ⇒ the new code REQUIRES this shape; on repeated failure the wallet
	 *  blocks with a recovery path. `false` ⇒ the code tolerates the old shape; on
	 *  repeated failure it boots degraded. Default `true` — see `defineMigration`. */
	breaking: boolean
	/** Roots + value keys read (snapshotted into the pre-migration backup). */
	reads: StorageRef[]
	/** Roots + value keys written/deleted (snapshotted into the backup). */
	writes: StorageRef[]
	/** The transform. Must be idempotent (the harness runs it twice). */
	up(ctx: MigrationContext): Promise<void>
}

/** Author a migration with `breaking` defaulting to `true` (the safe default —
 *  never assume the new code tolerates un-migrated data). */
export function defineMigration(m: Omit<Migration, "breaking"> & { breaking?: boolean }): Migration {
	return { breaking: true, ...m }
}

/** A migration failure. `terminal` distinguishes "will retry next boot" from
 *  "retry bound exhausted" (the host then blocks vs degrades per `breaking`). */
export type MigrationFailure = {
	kind: "failed"
	version: number
	/** Mirrors the failed migration's `breaking` flag → block (true) vs degrade (false). */
	breaking: boolean
	reason: string
	/** Durable attempt count across boots. */
	attempts: number
	/** `attempts >= maxRetries` — switch from retry to block-vs-degrade. */
	terminal: boolean
}

/** Result of a `Migrator.run()`. `from`/`to` are the version before/after. */
export type MigrationResult =
	| { kind: "noop"; version: number }
	| { kind: "migrated"; from: number; to: number }
	| { kind: "fresh"; version: number }
	| MigrationFailure
	/** The engine refuses to guess: a stale legacy marker, a corrupt/out-of-range
	 *  version, an invalid journal backup, or a failing restore. `retryable`
	 *  distinguishes "the next boot retries this automatically" (transient
	 *  restore failure) from a genuinely terminal state (reinstall guidance). */
	| { kind: "needs-recovery"; reason: string; retryable: boolean }
