/**
 * The data-preserving migration engine (pure, `chrome.*`-free).
 *
 * Applies numbered migrations where `version > persisted`, each guarded by a
 * durable crash-safe journal so a service-worker kill at ANY point converges on
 * the next boot:
 *
 *   1. set `running=N`            ← the barrier: UI blocks on this (§ Phase 3)
 *   2. set `backup={version,…}`   ← single atomic key = all-or-nothing snapshot
 *   3. run migration.up()         ← writes accumulate in a staging buffer
 *   4. commit staged diff         ← store.set(upserts) + store.remove(deletes)
 *   5. set `version=N`            ← checkpoint (1…N-1 stay durable)
 *   6. clear backup + running     ← done
 *
 * Resume on boot: `running=R` with a valid backup ⇒ restore the footprint, then
 * re-run; `running=R` with no backup ⇒ the crash predated any write ⇒ just clear
 * and re-run. A throw never advances `version`. Repeated failures increment a
 * durable, footprint-excluded attempt counter; past the bound the run reports a
 * terminal failure whose `breaking` flag drives block-vs-degrade in the host.
 */

import type { Migration, MigrationArea, MigrationContext, MigrationResult, MinimalStorageArea, StorageRef } from "./types"

/** The engine's own durable keys. Excluded from every footprint snapshot; added
 *  to the host's reset/uninstall wipe set (Phase 2). `nulo:schema:running` is the
 *  cross-context UI barrier. */
export const SCHEMA_VERSION_KEY = "nulo:schema:version"
export const SCHEMA_RUNNING_KEY = "nulo:schema:running"
const SCHEMA_BACKUP_KEY = "nulo:schema:backup"
const SCHEMA_ATTEMPTS_KEY = "nulo:schema:attempts"
/** The forked-app's legacy wipe marker. Its presence is positive evidence of a
 *  non-fresh install (the "reinstall fresh" assumption is violated) → fail closed. */
const LEGACY_VERSION_KEY = "nulo:core:storage-version"

export const RESERVED_KEYS: readonly string[] = [SCHEMA_VERSION_KEY, SCHEMA_RUNNING_KEY, SCHEMA_BACKUP_KEY, SCHEMA_ATTEMPTS_KEY]

const DEFAULT_MAX_RETRIES = 3

type BackupPayload = { version: number; entries: Record<string, unknown> }
type AttemptRecord = { version: number; count: number }

/** Accumulates a migration's writes so the engine commits them as ONE batched
 *  diff after `up()` succeeds. Reads overlay staged writes on the live store
 *  (read-your-writes). Malformed rows throw (fail-closed) — never silently
 *  dropped the way `EntityStorage` does on its read path. */
class StagingArea implements MigrationArea {
	private readonly staged = new Map<string, { op: "set"; raw: string } | { op: "remove" }>()

	constructor(private readonly store: MinimalStorageArea) {}

	private static parse(fullKey: string, raw: unknown): unknown {
		try {
			return JSON.parse(raw as string)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			throw new Error(`migration read: malformed row "${fullKey}" — ${msg}`)
		}
	}

	async rows(root: string): Promise<Array<[string, unknown]>> {
		const prefix = `${root}@`
		const live = await this.store.get()
		const merged = new Map<string, unknown>()
		for (const [k, v] of Object.entries(live)) if (k.startsWith(prefix)) merged.set(k, v)
		for (const [k, s] of this.staged) {
			if (!k.startsWith(prefix)) continue
			if (s.op === "remove") merged.delete(k)
			else merged.set(k, s.raw)
		}
		const out: Array<[string, unknown]> = []
		for (const [k, raw] of merged) out.push([k.substring(prefix.length), StagingArea.parse(k, raw)])
		return out
	}

	async setRows(root: string, upserts: Array<[string, unknown]>, deletes: string[] = []): Promise<void> {
		for (const [id, value] of upserts) this.staged.set(`${root}@${id}`, { op: "set", raw: JSON.stringify(value) })
		for (const id of deletes) this.staged.set(`${root}@${id}`, { op: "remove" })
	}

	async value(key: string): Promise<unknown> {
		const s = this.staged.get(key)
		if (s) return s.op === "remove" ? undefined : StagingArea.parse(key, s.raw)
		const live = await this.store.get(key)
		return key in live ? StagingArea.parse(key, live[key]) : undefined
	}

	async setValue(key: string, value: unknown): Promise<void> {
		this.staged.set(key, { op: "set", raw: JSON.stringify(value) })
	}

	async deleteValue(key: string): Promise<void> {
		this.staged.set(key, { op: "remove" })
	}

	/** The batched diff to commit. */
	diff(): { sets: Record<string, unknown>; removes: string[] } {
		const sets: Record<string, unknown> = {}
		const removes: string[] = []
		for (const [k, s] of this.staged) {
			if (s.op === "set") sets[k] = s.raw
			else removes.push(k)
		}
		return { sets, removes }
	}
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
				}
			}
			await this.store.set({ [SCHEMA_VERSION_KEY]: this.maxVersion })
			return { kind: "fresh", version: this.maxVersion }
		}

		if (!this.isValidMarker(rawVersion)) {
			return {
				kind: "needs-recovery",
				reason: `corrupt or out-of-range schema version ${JSON.stringify(rawVersion)} (expected 0..${this.maxVersion})`,
			}
		}
		const from = rawVersion as number
		if (from === this.maxVersion) return { kind: "noop", version: from }

		for (const m of this.migrations) {
			if (m.version <= from) continue
			const failure = await this.applyWithRetry(m)
			if (failure) return failure
		}
		// Reach maxVersion even if the last migration's version is below it (a
		// baseline floor with no bridging migration). Idempotent if already stamped.
		await this.store.set({ [SCHEMA_VERSION_KEY]: this.maxVersion })
		return { kind: "migrated", from, to: this.maxVersion }
	}

	private isValidMarker(v: unknown): boolean {
		return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= this.maxVersion
	}

	/** One attempt at `m`, wrapped in the durable attempt counter. Returns a
	 *  failure result (to stop the run) or `undefined` on success. */
	private async applyWithRetry(m: Migration): Promise<MigrationResult | undefined> {
		try {
			await this.applyMigration(m)
			await this.store.remove(SCHEMA_ATTEMPTS_KEY)
			return undefined
		} catch (err) {
			const attempts = await this.bumpAttempts(m.version)
			return {
				kind: "failed",
				version: m.version,
				breaking: m.breaking,
				error: err instanceof Error ? err.message : String(err),
				attempts,
				terminal: attempts >= this.maxRetries,
			}
		}
	}

	/** The per-migration journal sequence (see file header). Any throw leaves the
	 *  journal so the next boot's `resumeIfInterrupted` converges. */
	private async applyMigration(m: Migration): Promise<void> {
		await this.store.set({ [SCHEMA_RUNNING_KEY]: m.version })

		const footprintKeys = await this.footprintKeys(m)
		const snapshot = await this.snapshot(footprintKeys)
		const backup: BackupPayload = { version: m.version, entries: snapshot }
		await this.store.set({ [SCHEMA_BACKUP_KEY]: backup })

		const staging = new StagingArea(this.store)
		await m.up({ local: staging } satisfies MigrationContext)

		const { sets, removes } = staging.diff()
		if (Object.keys(sets).length) await this.store.set(sets)
		if (removes.length) await this.store.remove(removes)

		await this.store.set({ [SCHEMA_VERSION_KEY]: m.version })
		await this.store.remove([SCHEMA_BACKUP_KEY, SCHEMA_RUNNING_KEY])
	}

	/** If a prior run was interrupted, restore + clear so the caller re-runs from a
	 *  clean, pre-migration footprint. Returns `needs-recovery` only if restore
	 *  itself fails (backup is then KEPT for forensic/retry). */
	private async resumeIfInterrupted(): Promise<MigrationResult | undefined> {
		const j = await this.store.get([SCHEMA_RUNNING_KEY, SCHEMA_BACKUP_KEY])
		if (!(SCHEMA_RUNNING_KEY in j)) return undefined

		const backup = j[SCHEMA_BACKUP_KEY] as BackupPayload | undefined
		const running = j[SCHEMA_RUNNING_KEY]
		if (backup && typeof backup === "object" && backup.version === running) {
			try {
				await this.restore(backup)
			} catch (err) {
				return {
					kind: "needs-recovery",
					reason: `failed to restore backup for interrupted migration ${running}: ${err instanceof Error ? err.message : String(err)}`,
				}
			}
		}
		// backup absent (crash predated any write) OR restore done → clear the barrier.
		await this.store.remove([SCHEMA_BACKUP_KEY, SCHEMA_RUNNING_KEY])
		return undefined
	}

	/** Bring the footprint back to its pre-migration state: re-set the snapshot,
	 *  and remove any footprint keys the failed migration created. */
	private async restore(backup: BackupPayload): Promise<void> {
		const roots = this.rootsFromKeys(Object.keys(backup.entries))
		const nowKeys = await this.footprintKeysFor(roots.refs)
		const keep = new Set(Object.keys(backup.entries))
		const toRemove = nowKeys.filter((k) => !keep.has(k))
		if (Object.keys(backup.entries).length) await this.store.set(backup.entries)
		if (toRemove.length) await this.store.remove(toRemove)
	}

	private async bumpAttempts(version: number): Promise<number> {
		const cur = (await this.store.get(SCHEMA_ATTEMPTS_KEY))[SCHEMA_ATTEMPTS_KEY] as AttemptRecord | undefined
		const count = cur && cur.version === version ? cur.count + 1 : 1
		await this.store.set({ [SCHEMA_ATTEMPTS_KEY]: { version, count } satisfies AttemptRecord })
		return count
	}

	/** Every live key covered by a migration's declared footprint. */
	private async footprintKeys(m: Migration): Promise<string[]> {
		return this.footprintKeysFor([...m.reads, ...m.writes])
	}

	private async footprintKeysFor(refs: StorageRef[]): Promise<string[]> {
		const roots = refs.filter((r) => r.kind === "root").map((r) => `${(r as { root: string }).root}@`)
		const values = new Set(refs.filter((r) => r.kind === "value").map((r) => (r as { key: string }).key))
		const all = await this.store.get()
		const out: string[] = []
		for (const k of Object.keys(all)) {
			if (RESERVED_KEYS.includes(k)) continue
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

	/** Reconstruct the root refs a restore must scan from the backed-up keys. */
	private rootsFromKeys(keys: string[]): { refs: StorageRef[] } {
		const refs: StorageRef[] = []
		const seen = new Set<string>()
		for (const k of keys) {
			const at = k.indexOf("@")
			if (at > 0) {
				const root = k.slice(0, at)
				if (!seen.has(root)) {
					seen.add(root)
					refs.push({ kind: "root", root })
				}
			} else {
				refs.push({ kind: "value", key: k })
			}
		}
		return { refs }
	}
}
