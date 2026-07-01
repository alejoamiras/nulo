/**
 * The data-preserving migration engine (pure, `chrome.*`-free).
 *
 * Applies numbered migrations where `version > persisted`, under a durable
 * crash-safe journal so a service-worker kill at ANY point converges on the
 * next boot:
 *
 *   1. set `running`               ← run-scoped UI barrier (whole run, no gaps)
 *   2. per migration N:
 *      a. set `backup={version,refs,entries}` ← single atomic key: all-or-nothing
 *      b. run migration.up()       ← writes accumulate in a staging buffer
 *      c. guard + commit the diff  ← staged keys must be inside declared writes
 *      d. set `version=N`          ← checkpoint (1…N-1 stay durable)
 *      e. clear backup
 *   3. stamp max, clear `running`
 *
 * Resume on boot with `running` set:
 *   - valid backup + `version >= backup.version` ⇒ the commit+stamp completed;
 *     clear the journal WITHOUT restoring (restoring here would silently revert
 *     committed data underneath the new version marker).
 *   - valid backup + `version < backup.version` ⇒ interrupted mid-migration;
 *     restore the declared footprint from the backup, then clear + re-run.
 *   - no backup ⇒ the crash predated any write; clear + proceed.
 *   - PRESENT-but-invalid backup ⇒ tampering/corruption (the backup is written
 *     as one atomic set, so a prep-crash cannot produce a partial one); fail
 *     closed to `needs-recovery`, journal kept.
 *
 * A failure inside a migration restores + clears the journal IMMEDIATELY (not
 * just on the next boot): the boot that continues past a non-breaking failure
 * must not leave `running` set, or every UI storage access would park on the
 * barrier forever. A throw never advances `version`. Durable attempt counters
 * (stored under the engine's own reserved namespace, never inside a footprint)
 * bound both the up() retries and the restore retries across boots.
 */

import type { Migration, MigrationContext, MigrationResult, MinimalStorageArea, StorageRef } from "./types"
import { StagingArea } from "./staging"

/** The engine's own durable keys. The whole `nulo:schema:` prefix is reserved:
 *  footprints never include it and migrations may not write into it. */
export const SCHEMA_VERSION_KEY = "nulo:schema:version"
export const SCHEMA_RUNNING_KEY = "nulo:schema:running"
const SCHEMA_BACKUP_KEY = "nulo:schema:backup"
const SCHEMA_ATTEMPTS_KEY = "nulo:schema:attempts"
const RESERVED_PREFIX = "nulo:schema:"
/** The forked-app's legacy wipe marker. Its presence is positive evidence of a
 *  non-fresh install (the "reinstall fresh" assumption is violated) → fail closed. */
const LEGACY_VERSION_KEY = "nulo:core:storage-version"

export const RESERVED_KEYS: readonly string[] = [SCHEMA_VERSION_KEY, SCHEMA_RUNNING_KEY, SCHEMA_BACKUP_KEY, SCHEMA_ATTEMPTS_KEY]

const DEFAULT_MAX_RETRIES = 3

type BackupPayload = { version: number; refs: StorageRef[]; entries: Record<string, unknown> }
type AttemptRecord = { version: number; phase: "up" | "restore"; count: number }

function isValidRef(r: unknown): r is StorageRef {
	if (typeof r !== "object" || r === null) return false
	const ref = r as { kind?: unknown; root?: unknown; key?: unknown }
	if (ref.kind === "root") return typeof ref.root === "string" && ref.root.length > 0
	if (ref.kind === "value") return typeof ref.key === "string" && ref.key.length > 0
	return false
}

/** Full shape validation: `restore()` trusts these refs to tombstone live keys,
 *  so a malformed ref array from hostile persisted state must never reach it. */
function isValidBackup(v: unknown): v is BackupPayload {
	if (typeof v !== "object" || v === null) return false
	const b = v as Partial<BackupPayload>
	return (
		Number.isInteger(b.version) &&
		Array.isArray(b.refs) &&
		b.refs.every(isValidRef) &&
		typeof b.entries === "object" &&
		b.entries !== null &&
		!Array.isArray(b.entries)
	)
}

export interface MigratorOptions {
	store: MinimalStorageArea
	migrations: Migration[]
	maxRetries?: number
	/** The store's current shape is already at this version (the launch baseline).
	 *  The effective max is `max(baselineVersion, …migration versions)`; fresh
	 *  installs stamp it and run nothing. Default 0. */
	baselineVersion?: number
}

export class Migrator {
	private readonly store: MinimalStorageArea
	private readonly migrations: Migration[]
	private readonly maxRetries: number
	private readonly maxVersion: number

	constructor({ store, migrations, maxRetries = DEFAULT_MAX_RETRIES, baselineVersion = 0 }: MigratorOptions) {
		this.store = store
		this.maxRetries = maxRetries
		this.migrations = [...migrations].sort((a, b) => a.version - b.version)
		for (let i = 0; i < this.migrations.length; i++) {
			const v = this.migrations[i].version
			if (!Number.isInteger(v) || v < 1) throw new Error(`migration version must be a positive integer, got ${v}`)
			if (i > 0 && v === this.migrations[i - 1].version) throw new Error(`duplicate migration version ${v}`)
		}
		const migMax = this.migrations.length ? this.migrations[this.migrations.length - 1].version : 0
		this.maxVersion = Math.max(baselineVersion, migMax)
	}

	/** Drive persisted storage to the current max version. Idempotent + crash-safe. */
	async run(): Promise<MigrationResult> {
		const resumed = await this.resumeIfInterrupted()
		if (resumed) return resumed

		const all = await this.store.get()
		const rawVersion = all[SCHEMA_VERSION_KEY]

		if (!(SCHEMA_VERSION_KEY in all)) {
			// No marker. A stale legacy key means a non-fresh install → fail closed.
			if (LEGACY_VERSION_KEY in all) {
				return {
					kind: "needs-recovery",
					reason: `legacy "${LEGACY_VERSION_KEY}" present without a schema version — reinstall for a clean dev state`,
					retryable: false,
				}
			}
			await this.store.set({ [SCHEMA_VERSION_KEY]: this.maxVersion })
			return { kind: "fresh", version: this.maxVersion }
		}

		if (!this.isValidMarker(rawVersion)) {
			return {
				kind: "needs-recovery",
				reason: `corrupt or out-of-range schema version ${JSON.stringify(rawVersion)} (expected 0..${this.maxVersion})`,
				retryable: false,
			}
		}
		const from = rawVersion
		if (from === this.maxVersion) return { kind: "noop", version: from }

		// The barrier spans the WHOLE run: per-migration set/clear would open
		// gaps where a queued UI write lands between two migrations' snapshots.
		await this.store.set({ [SCHEMA_RUNNING_KEY]: this.maxVersion })
		for (const m of this.migrations) {
			if (m.version <= from) continue
			const failure = await this.applyOne(m)
			if (failure) return this.escalateIfLaterPending(failure, m)
		}
		// Reach maxVersion even when a baseline floor sits above the last
		// migration (no bridging migration). Idempotent if already stamped.
		await this.store.set({ [SCHEMA_VERSION_KEY]: this.maxVersion })
		await this.store.remove([SCHEMA_ATTEMPTS_KEY, SCHEMA_RUNNING_KEY])
		return { kind: "migrated", from, to: this.maxVersion }
	}

	/** `breaking: false` promises the code tolerates THAT migration's old shape —
	 *  it says nothing about the LATER migrations a failure would leave
	 *  unapplied (and sequential migrations may depend on the failed one's
	 *  output). A degraded boot is only sound when the failure is the tail. */
	private escalateIfLaterPending(failure: MigrationResult, m: Migration): MigrationResult {
		if (failure.kind !== "failed" || failure.breaking) return failure
		if (!this.migrations.some((x) => x.version > m.version)) return failure
		return {
			...failure,
			breaking: true,
			reason: `${failure.reason} (escalated: later migrations remain unapplied behind the failure)`,
		}
	}

	private isValidMarker(v: unknown): v is number {
		return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= this.maxVersion
	}

	/** One migration under the journal. On failure: restore + clear NOW (this
	 *  boot must not stay barrier-wedged), report with the durable attempt count.
	 *  Returns `undefined` on success. */
	private async applyOne(m: Migration): Promise<MigrationResult | undefined> {
		const refs = [...m.reads, ...m.writes]
		const snapshot = await this.snapshot(await this.footprintKeysFor(refs))
		const backup: BackupPayload = { version: m.version, refs, entries: snapshot }
		await this.store.set({ [SCHEMA_BACKUP_KEY]: backup })

		try {
			const staging = new StagingArea(this.store)
			await m.up({ local: staging } satisfies MigrationContext)

			const { sets, removes } = staging.diff()
			this.guardCommit(m, Object.keys(sets).concat(removes))
			if (Object.keys(sets).length) await this.store.set(sets)
			if (removes.length) await this.store.remove(removes)

			await this.store.set({ [SCHEMA_VERSION_KEY]: m.version })
			await this.store.remove(SCHEMA_BACKUP_KEY)
			return undefined
		} catch (err) {
			try {
				await this.restore(backup)
			} catch (restoreErr) {
				// Journal kept: the next boot retries the restore (bounded).
				const attempts = await this.bumpAttempts(m.version, "restore")
				return {
					kind: "needs-recovery",
					reason: `failed to restore after migration ${m.version} failed: ${message(restoreErr)} (migration error: ${message(err)})`,
					retryable: attempts < this.maxRetries,
				}
			}
			// Attempts bump BEFORE the journal clear: a kill between the two must
			// lose the (idempotently re-doable) clear, never the durable count
			// that bounds retries.
			const attempts = await this.bumpAttempts(m.version, "up")
			await this.store.remove([SCHEMA_BACKUP_KEY, SCHEMA_RUNNING_KEY])
			return {
				kind: "failed",
				version: m.version,
				breaking: m.breaking,
				reason: message(err),
				attempts,
				terminal: attempts >= this.maxRetries,
			}
		}
	}

	/** Enforce the declared footprint at commit time: an undeclared write is not
	 *  in the backup and therefore cannot be restored — reject it fail-closed.
	 *  The engine's own namespace is never writable from a migration. */
	private guardCommit(m: Migration, stagedKeys: string[]): void {
		const roots = m.writes.filter((r) => r.kind === "root").map((r) => `${r.root}@`)
		const values = new Set(m.writes.filter((r) => r.kind === "value").map((r) => r.key))
		const offenders = stagedKeys.filter((k) => {
			if (k.startsWith(RESERVED_PREFIX) || k === LEGACY_VERSION_KEY) return true
			return !(values.has(k) || roots.some((p) => k.startsWith(p)))
		})
		if (offenders.length) {
			throw new Error(`migration ${m.version} staged writes outside its declared footprint: ${offenders.join(", ")}`)
		}
	}

	/** Converge an interrupted journal (see the file header for the matrix). */
	private async resumeIfInterrupted(): Promise<MigrationResult | undefined> {
		const j = await this.store.get([SCHEMA_RUNNING_KEY, SCHEMA_BACKUP_KEY, SCHEMA_VERSION_KEY])
		if (!(SCHEMA_RUNNING_KEY in j)) return undefined

		if (!(SCHEMA_BACKUP_KEY in j)) {
			// Crash predated any backup write — nothing was touched.
			await this.store.remove(SCHEMA_RUNNING_KEY)
			return undefined
		}
		const backup = j[SCHEMA_BACKUP_KEY]
		if (!isValidBackup(backup)) {
			// The backup is written atomically, so partial-from-crash is impossible;
			// an invalid one means tampering or corruption. Keep it, fail closed.
			return { kind: "needs-recovery", reason: "interrupted migration journal has an invalid backup payload", retryable: false }
		}
		// An armed journal REQUIRES a valid marker AND an in-range backup version
		// (every path that writes the journal starts from a validated marker and
		// a registered migration). Anything else is external mutation — a restore
		// or clear here would mutate hostile state BEFORE the marker table gets
		// to fail closed (e.g. `-1`, `1.5`, `NaN`, or an impossible backup
		// version whose refs restore would trust to tombstone live keys).
		const version = j[SCHEMA_VERSION_KEY]
		if (!this.isValidMarker(version)) {
			return {
				kind: "needs-recovery",
				reason: `interrupted migration journal with a ${version === undefined ? "missing" : "corrupt"} schema version`,
				retryable: false,
			}
		}
		if (backup.version < 1 || backup.version > this.maxVersion) {
			return {
				kind: "needs-recovery",
				reason: `interrupted migration journal backup carries an unregistered version ${backup.version} (expected 1..${this.maxVersion})`,
				retryable: false,
			}
		}
		if (version >= backup.version) {
			// The migration committed + stamped before the crash — restoring now
			// would revert committed data underneath the new version marker.
			await this.store.remove([SCHEMA_BACKUP_KEY, SCHEMA_RUNNING_KEY])
			return undefined
		}
		try {
			await this.restore(backup)
		} catch (err) {
			const attempts = await this.bumpAttempts(backup.version, "restore")
			return {
				kind: "needs-recovery",
				reason: `failed to restore backup for interrupted migration ${backup.version}: ${message(err)}`,
				retryable: attempts < this.maxRetries,
			}
		}
		await this.store.remove([SCHEMA_BACKUP_KEY, SCHEMA_RUNNING_KEY])
		return undefined
	}

	/** Bring the DECLARED footprint back to its pre-migration state: re-set the
	 *  snapshot, remove footprint keys the interrupted run created. Scanning the
	 *  declared refs (not keys re-inferred from the snapshot) is what catches
	 *  rows created under a root that was EMPTY at backup time, and keeps
	 *  `@`-bearing value keys from being misread as roots. Defense-in-depth: a
	 *  backup entry can never write into the engine's namespace. */
	private async restore(backup: BackupPayload): Promise<void> {
		const entries: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(backup.entries)) {
			if (k.startsWith(RESERVED_PREFIX) || k === LEGACY_VERSION_KEY) continue
			entries[k] = v
		}
		const nowKeys = await this.footprintKeysFor(backup.refs)
		const keep = new Set(Object.keys(entries))
		const toRemove = nowKeys.filter((k) => !keep.has(k))
		if (Object.keys(entries).length) await this.store.set(entries)
		if (toRemove.length) await this.store.remove(toRemove)
	}

	private async bumpAttempts(version: number, phase: AttemptRecord["phase"]): Promise<number> {
		const cur = (await this.store.get(SCHEMA_ATTEMPTS_KEY))[SCHEMA_ATTEMPTS_KEY] as AttemptRecord | undefined
		const count = cur && cur.version === version && cur.phase === phase ? cur.count + 1 : 1
		await this.store.set({ [SCHEMA_ATTEMPTS_KEY]: { version, phase, count } satisfies AttemptRecord })
		return count
	}

	/** Every live key covered by the refs. The engine's namespace is excluded
	 *  unconditionally — a migration cannot footprint the journal itself. */
	private async footprintKeysFor(refs: StorageRef[]): Promise<string[]> {
		const roots = refs.flatMap((r) => (r.kind === "root" ? [`${r.root}@`] : []))
		const values = new Set(refs.flatMap((r) => (r.kind === "value" ? [r.key] : [])))
		const all = await this.store.get()
		const out: string[] = []
		for (const k of Object.keys(all)) {
			if (k.startsWith(RESERVED_PREFIX)) continue
			if (values.has(k) || roots.some((p) => k.startsWith(p))) out.push(k)
		}
		return out
	}

	private async snapshot(keys: string[]): Promise<Record<string, unknown>> {
		if (!keys.length) return {}
		const got = await this.store.get(keys)
		const out: Record<string, unknown> = {}
		for (const k of keys) if (k in got) out[k] = got[k]
		return out
	}
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
