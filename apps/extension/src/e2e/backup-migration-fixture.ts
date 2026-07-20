/**
 * E2E fixture BACKUP migration — proves the backup-import migration machinery
 * end-to-end (smoke: `tests/e2e/backup-migration.test.ts`; network:
 * `tests/e2e/network/backup-migration-roundtrip.test.ts`).
 *
 * Registered into `backupMigrations` ONLY on builds stamped with
 * `VITE_NULO_E2E_MIGRATION_FIXTURE=1` (same proof-gate as the live fixture:
 * the registry spreads it behind a static-false constant, production builds
 * tree-shake it, and the `_build-extension.yml` negative grep asserts the
 * marker below never ships). Unlike the live fixture it MUST transform a real
 * registry root — the point is migrating a genuine backup slice forward — so
 * inertness comes from the build stamp alone, plus the rename's idempotence
 * (a current-shape contact has no `legacyName`, so the row passes through).
 */
import { CONTACT_STORAGE_ROOT } from "@/wallet/services/contact/spec"
import { defineRowMapMigration } from "@/wallet/services/backup/row-map-migration"

/** Negative-grep marker for prod bundles (`_build-extension.yml`). */
export const BACKUP_MIGRATION_FIXTURE_MARKER = "nulo:e2e:backup-mig-fixture"

/** Same HIGH sentinel rationale as the live fixture: far above any real
 *  migration so a stamped build can never collide with a template-following
 *  author's next real version. */
export const BACKUP_MIGRATION_FIXTURE_VERSION = 9001

/** v(N-1) → 9001: rename each contact row's `legacyName` → `name` — the
 *  representative field-rename in the backup-safe declarative form. */
export const backupMigrationFixture = /* @__PURE__ */ defineRowMapMigration({
	version: BACKUP_MIGRATION_FIXTURE_VERSION,
	description: `e2e backup fixture (${BACKUP_MIGRATION_FIXTURE_MARKER}): rename contact legacyName → name`,
	rowMaps: {
		[CONTACT_STORAGE_ROOT]: { rename: { legacyName: "name" } },
	},
})
