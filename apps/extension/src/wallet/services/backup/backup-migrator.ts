/**
 * BackupMigrator — drives an imported full-backup's `data` slices forward to
 * the current storage schema BEFORE the service-by-service restore runs.
 *
 * Shape: normalize slices into a fresh in-memory scratch store (exact live
 * key/value format), seed `nulo:schema:version` with the blob's
 * `backup-schema-version`, run the REAL `Migrator` (same class, same real
 * migrations the live boot applies) over the scratch, read back, denormalize.
 * Backup migrations and live migrations are therefore the SAME objects —
 * never a divergent second copy — and the engine's sequencing, staging,
 * `guardCommit` footprint enforcement and run-twice idempotency apply
 * unchanged.
 *
 * Pure + in-memory: touches no live chrome.storage, no PXE, no network, no
 * secrets. `master-key` is a top-level blob field, not a slice — it never
 * enters the scratch store, results, or error reasons. A mid-migration
 * failure mutates ZERO live state; the caller simply rejects the import.
 *
 * Trust: the blob is attacker-controlled. Checksum verification (over the
 * ORIGINAL bytes) happens BEFORE this runs and is the sole integrity gate —
 * migration is a pure function of already-verified bytes, so its output is
 * covered transitively and no post-migration checksum is ever recomputed or
 * trusted.
 */
import type { Migration, StorageRef } from "@nulo/wallet-core/migration"
import { Migrator, SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import { MemoryStorageArea } from "@nulo/wallet-core/storage"
import { backupMigrations, realMigrations } from "@/wallet/storage/migrations"
import {
	BACKUP_BLOCKED_ROOTS,
	BACKUP_SCHEMA_BASELINE,
	BACKUP_SLICE_REGISTRY,
	denormalizeBackupData,
	normalizeBackupData,
} from "./backup-migration-registry"
import { isBackupSafeMigration } from "./row-map-migration"

/** Mirrors `MigrationResult`, specialized for the backup path:
 *  - `noop` / `migrated` carry the (validated, possibly transformed) data —
 *    the ONLY success kinds; hand `data` to the unchanged restore pipeline.
 *  - `incompatible` = this build cannot migrate the blob by design (a
 *    non-backup-safe or block-listed migration in range, an out-of-range
 *    version) — the fix is re-exporting from a current wallet.
 *  - `failed` = the blob itself is malformed/hostile or a migration failed —
 *    reject the import outright. */
export type BackupMigrationResult =
	| { kind: "noop"; version: number; data: Record<string, unknown> }
	| { kind: "migrated"; from: number; to: number; data: Record<string, unknown> }
	| { kind: "incompatible"; reason: string }
	| { kind: "failed"; reason: string }

export interface MigrateBackupOptions {
	/** The blob's `data` object (untrusted). */
	data: unknown
	/** The blob's `backup-schema-version` (untrusted — re-validated here). */
	backupSchemaVersion: unknown
	/** Test seams; default to the real registry wiring. */
	migrations?: Migration[]
	baselineVersion?: number
}

/** Highest schema version this build can accept in a backup. */
export function maxBackupSchemaVersion(
	migrations: Migration[] = backupMigrations,
	baselineVersion: number = BACKUP_SCHEMA_BASELINE,
): number {
	return Math.max(baselineVersion, ...migrations.map((m) => m.version))
}

/** What a NEW export stamps as `backup-schema-version`: the version the REAL
 *  migration line puts live data at. Deliberately excludes the e2e fixtures'
 *  9001 sentinel — a stamped test build must not mint backups a production
 *  build would reject as from-the-future. */
export const CURRENT_BACKUP_SCHEMA_VERSION = maxBackupSchemaVersion(realMigrations)

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 16) — refactor when touched, never raise
export async function migrateBackupData(opts: MigrateBackupOptions): Promise<BackupMigrationResult> {
	const migrations = opts.migrations ?? backupMigrations
	const baselineVersion = opts.baselineVersion ?? BACKUP_SCHEMA_BASELINE
	const maxVersion = maxBackupSchemaVersion(migrations, baselineVersion)

	const from = opts.backupSchemaVersion
	if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
		return { kind: "failed", reason: `malformed backup-schema-version ${JSON.stringify(from)}` }
	}
	if (from > maxVersion) {
		return { kind: "incompatible", reason: `backup schema version ${from} is newer than this build supports (${maxVersion})` }
	}

	const normalized = normalizeBackupData(opts.data)
	if (!normalized.ok) return { kind: "failed", reason: normalized.reason }
	const { entries, absentRequired, passThrough, present } = normalized.normalized

	const pending = migrations.filter((m) => m.version > from)
	const preflight = preflightPending(pending, absentRequired)
	if (preflight) return preflight

	const scratch = new MemoryStorageArea().seed(entries)
	await scratch.set({ [SCHEMA_VERSION_KEY]: from })

	const result = await new Migrator({ store: scratch, migrations, baselineVersion }).run()
	if (result.kind !== "noop" && result.kind !== "migrated") {
		const reason =
			result.kind === "failed"
				? result.reason
				: result.kind === "needs-recovery"
					? result.reason
					: `unexpected engine result "${result.kind}"`
		return { kind: "failed", reason: `backup migration failed: ${reason}` }
	}

	const denormalized = denormalizeBackupData(await scratch.get(), { passThrough, present })
	if (!denormalized.ok) return { kind: "failed", reason: denormalized.reason }

	return result.kind === "noop"
		? { kind: "noop", version: result.version, data: denormalized.data }
		: { kind: "migrated", from: result.from, to: result.to, data: denormalized.data }
}

/** Fail-closed preflight over every migration that would run:
 *  1. only branded (frozen, factory-built) backup-safe migrations may touch a
 *     backup — an imperative `defineMigration` in range blocks import;
 *  2. block-listed roots (`profile`, `auth-registry-enabled`) block import —
 *     their live state is not representable in a backup;
 *  3. every footprint ref must be registry-covered (a migration over a root
 *     no slice maps to cannot be replayed here);
 *  4. a read of a NON-optional slice the blob doesn't carry rejects (an
 *     optional absent slice already normalized as empty). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 36) — refactor when touched, never raise
function preflightPending(pending: Migration[], absentRequired: StorageRef[]): BackupMigrationResult | undefined {
	const coveredRoots = new Set<string>()
	const coveredValueKeys = new Set<string>()
	for (const desc of Object.values(BACKUP_SLICE_REGISTRY)) {
		if (desc.kind === "root") coveredRoots.add(desc.root)
		if (desc.kind === "value-projection") coveredValueKeys.add(desc.key)
	}
	const blocked = new Set(BACKUP_BLOCKED_ROOTS)
	const absentRoots = new Set(absentRequired.filter((r) => r.kind === "root").map((r) => r.root))
	const absentKeys = new Set(absentRequired.filter((r) => r.kind === "value").map((r) => r.key))

	for (const m of pending) {
		if (!isBackupSafeMigration(m)) {
			return {
				kind: "incompatible",
				reason: `this wallet version can't upgrade old backups: migration ${m.version} is not backup-safe — re-export a fresh backup from a current wallet`,
			}
		}
		for (const ref of [...m.reads, ...m.writes]) {
			if (ref.kind === "root" && blocked.has(ref.root)) {
				return {
					kind: "incompatible",
					reason: `migration ${m.version} touches "${ref.root}", which backups cannot represent — re-export a fresh backup from a current wallet`,
				}
			}
			const covered = ref.kind === "root" ? coveredRoots.has(ref.root) : coveredValueKeys.has(ref.key)
			if (!covered) {
				const target = ref.kind === "root" ? ref.root : ref.key
				return { kind: "incompatible", reason: `migration ${m.version} touches "${target}", which no backup slice maps to` }
			}
		}
		for (const ref of m.reads) {
			const missing = ref.kind === "root" ? absentRoots.has(ref.root) : absentKeys.has(ref.key)
			if (missing) {
				const target = ref.kind === "root" ? ref.root : ref.key
				return { kind: "failed", reason: `backup is missing a required slice for "${target}" that migration ${m.version} reads` }
			}
		}
	}
	return undefined
}
