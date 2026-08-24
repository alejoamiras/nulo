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
/** One-shot user-gesture retry request, written by the MigrationBarrier's
 *  Retry button through its allowlisted raw-storage channel and CONSUMED by
 *  the boot gate before it authorizes an engine run. */
export const SCHEMA_RETRY_REQUESTED_KEY = "nulo:schema:retry-requested"

/** Shape persisted under `SCHEMA_BLOCKED_KEY`. */
export type MigrationBlockedStatus = {
	kind: "needs-recovery" | "failed"
	detail: string
	/** `false` ⇒ retryable (via the barrier's Retry button or the one-shot
	 *  autonomous backstop); `true` ⇒ retries exhausted. */
	terminal: boolean
	/** Manifest version that produced this verdict. A mismatch at boot means
	 *  an update shipped since — the verdict (terminal INCLUDED) is voided so
	 *  a fixed migration can run; a terminal block must never outlive the
	 *  build that produced it. */
	atExtensionVersion: string
	/** When the engine last actually ran (gates the autonomous backstop). */
	lastAttemptAt: number
	/** Autonomous (non-gesture) engine runs spent in this blocked episode —
	 *  capped at 1, and only allowed BEFORE any gesture run, so the
	 *  terminalizing attempt is always gesture-initiated. */
	backstopRuns: number
	/** Gesture-authorized engine runs spent in this episode. Once > 0 the
	 *  autonomous backstop is disabled: a user who has already retried owns
	 *  the remaining budget (this is what makes "terminal only by gesture"
	 *  airtight even across killed gesture runs). */
	gestureRuns: number
	/** Set by the gate's claim writes when it authorizes a run; every run-end
	 *  persist rewrites the status WITHOUT it. Present ⟺ an authorized run may
	 *  still be in flight — the barrier holds its Retry button on it so an
	 *  impatient second tap can't kill the run mid-write and spend another
	 *  attempt. (The `running` marker can't serve here: the restore-failure
	 *  state persists running + blocked together with no run in flight.) */
	claimedAt?: number
}

/** Per-FIELD tolerant decode of a persisted blocked status. Contract:
 *  - no decodable boolean `terminal` ⇒ the blob is garbage ⇒ `absent`
 *    (the engine runs as on any unblocked boot and rewrites a valid status);
 *  - an undecodable or MISMATCHED `atExtensionVersion` ⇒ `invalidated` even
 *    beside a valid `terminal: true` (we cannot prove the verdict matches
 *    this build — recovery over wedging);
 *  - malformed `lastAttemptAt` decodes to 0 (backstop-age-eligible) and
 *    malformed `backstopRuns` decodes to 1 (already spent) — each field
 *    degrades in its own conservative direction, and none can void a valid
 *    same-version terminal verdict. */
export function decodeBlockedStatus(
	raw: unknown,
	currentExtensionVersion: string,
	now: number,
): { kind: "absent" } | { kind: "invalidated" } | { kind: "blocked"; status: MigrationBlockedStatus } {
	if (typeof raw !== "object" || raw === null) return { kind: "absent" }
	const b = raw as Partial<MigrationBlockedStatus>
	if (typeof b.terminal !== "boolean") return { kind: "absent" }
	if (typeof b.atExtensionVersion !== "string" || b.atExtensionVersion.length === 0 || b.atExtensionVersion !== currentExtensionVersion) {
		return { kind: "invalidated" }
	}
	const lastAttemptAt =
		typeof b.lastAttemptAt === "number" && Number.isFinite(b.lastAttemptAt) && b.lastAttemptAt <= now ? b.lastAttemptAt : 0
	const backstopRuns = typeof b.backstopRuns === "number" && Number.isInteger(b.backstopRuns) && b.backstopRuns >= 0 ? b.backstopRuns : 1
	const gestureRuns = typeof b.gestureRuns === "number" && Number.isInteger(b.gestureRuns) && b.gestureRuns >= 0 ? b.gestureRuns : 1
	const claimedAt = typeof b.claimedAt === "number" && Number.isFinite(b.claimedAt) && b.claimedAt <= now ? b.claimedAt : undefined
	return {
		kind: "blocked",
		status: {
			kind: b.kind === "failed" ? "failed" : "needs-recovery",
			detail: typeof b.detail === "string" ? b.detail : "",
			terminal: b.terminal,
			atExtensionVersion: b.atExtensionVersion,
			lastAttemptAt,
			backstopRuns,
			gestureRuns,
			...(claimedAt !== undefined ? { claimedAt } : {}),
		},
	}
}

/** The retry request is a gesture token, not data — any object with a finite
 *  numeric `requestedAt` counts; anything else is ignored (and consumed). */
export function isValidRetryRequest(raw: unknown): boolean {
	return typeof raw === "object" && raw !== null && Number.isFinite((raw as { requestedAt?: unknown }).requestedAt as number)
}

/** Shape persisted under `SCHEMA_DEGRADED_KEY` (additive migration failed;
 *  the app runs with the old shape for that slice). */
export type MigrationDegradedStatus = { version: number; error: string }
