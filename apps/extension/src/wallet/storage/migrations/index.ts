/**
 * The extension's numbered migration registry, applied at SW boot when a
 * release changes a persisted storage shape.
 *
 * The launch shape is version 1. Forward migrations are v2, v3, … — one file
 * each (copy `template.ts`), imported into the `migrations` array below. The
 * `version` inside each migration is the source of truth; nothing else to bump.
 *
 * The pure engine + its crash-safe journal live in `@nulo/wallet-core/migration`;
 * this only supplies the ordered list + the baseline. Wired at boot in
 * `../../runtime.ts` (before `config.load()`), driven against `chrome.storage.local`.
 */
import type { Migration } from "@nulo/wallet-core/migration"
import { E2E_MIGRATION_FIXTURE } from "@/e2e/config"
import { backupMigrationFixture } from "@/e2e/backup-migration-fixture"
import { migrationFixture } from "@/e2e/migration-fixture"

/** The current on-disk shape. Fresh installs stamp this and run nothing. */
export const BASELINE_VERSION = 1

/** REAL migrations only — forward-only, ascending, empty until the first real
 *  schema change ships. This is the array the backup-import migrator runs: the
 *  e2e fixture's 9001 sentinel must never be reachable from an on-disk
 *  `backup-schema-version`, so the fixture is spread into `migrations` (the
 *  live-boot array) separately below. */
export const realMigrations: Migration[] = []

/** The live-boot array: real migrations + the e2e fixture. The fixture spreads
 *  in ONLY on builds stamped with `VITE_NULO_E2E_MIGRATION_FIXTURE=1` —
 *  `E2E_MIGRATION_FIXTURE` is a static-false constant otherwise, so prod
 *  builds tree-shake the fixture (proof-gate pattern; enforced by the
 *  `_build-extension.yml` grep). */
export const migrations: Migration[] = [...realMigrations, ...(E2E_MIGRATION_FIXTURE ? [migrationFixture] : [])]

/** The backup-import array: real migrations + (on stamped builds only) the
 *  DECLARATIVE backup fixture, which transforms a real registry root so the
 *  e2e suites can drive a vN backup through the whole import path. On prod
 *  builds this is exactly `realMigrations` — the 9001 sentinel is unreachable
 *  from any on-disk `backup-schema-version`. */
export const backupMigrations: Migration[] = [...realMigrations, ...(E2E_MIGRATION_FIXTURE ? [backupMigrationFixture] : [])]

/** Host-level status keys the boot path writes for the UI shells (the engine
 *  doesn't know these). `blocked` ⇒ the shell renders the recovery screen
 *  instead of the app; `degraded` ⇒ the shell boots with a warning banner. */
export const SCHEMA_BLOCKED_KEY = "nulo:schema:blocked"
export const SCHEMA_DEGRADED_KEY = "nulo:schema:degraded"

/** Shape persisted under `SCHEMA_BLOCKED_KEY`. */
export type MigrationBlockedStatus = {
	kind: "needs-recovery" | "failed"
	detail: string
	/** `false` ⇒ the engine will retry on the next boot (recovery copy says
	 *  "restart to retry"); `true` ⇒ retries exhausted. */
	terminal: boolean
}

/** Shape persisted under `SCHEMA_DEGRADED_KEY` (additive migration failed;
 *  the app runs with the old shape for that slice). */
export type MigrationDegradedStatus = { version: number; error: string }
