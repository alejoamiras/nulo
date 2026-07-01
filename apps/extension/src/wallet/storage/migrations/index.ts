/**
 * The extension's numbered migration registry (the data door: extension update).
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

/** The current on-disk shape. Fresh installs stamp this and run nothing. */
export const BASELINE_VERSION = 1

/** Forward-only, ascending. Empty until the first real schema change ships. */
export const migrations: Migration[] = []

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
