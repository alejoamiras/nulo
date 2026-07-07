/**
 * TEMPLATE for a new data-preserving migration. To add one:
 *   1. Copy this file to `NNN-short-description.ts` (NNN = current max REAL
 *      migration + 1 — the e2e fixtures' 9001 sentinel doesn't count).
 *   2. Set `version` to that number and describe the shape change.
 *   3. **Prefer the BACKUP-SAFE declarative form** (`defineRowMapMigration`,
 *      example below): pure data, so it also migrates imported full-backups.
 *      Fall back to imperative `defineMigration` ONLY when the transform
 *      doesn't fit the finite DSL — an imperative migration is NOT
 *      backup-safe and BLOCKS backup import at every version it covers
 *      (users must re-export; `footprint-coverage.test.ts` makes you
 *      acknowledge that explicitly). Do NOT try to widen the DSL with
 *      callback fields — arbitrary code cannot be proven row-local, which is
 *      the property the backup path depends on (rejected 4× in audit).
 *   4. Declare the EXACT roots + value keys you read and write — the engine
 *      snapshots ONLY that footprint into the pre-migration backup, so an
 *      undeclared read/write is a data-loss risk. (The declarative form
 *      derives its footprint from `rowMaps`/`valueMaps` automatically.)
 *   5. Keep `up` IDEMPOTENT (guard with `hasProperty`/presence checks) — the
 *      test harness runs it twice and asserts equality.
 *   6. **HOSTILE-INPUT RULE (standing):** `up()` input is UNTRUSTED. The
 *      migration engine also runs over imported backup blobs, whose bytes an
 *      attacker fully controls (a plain-backup checksum is not
 *      authentication) — and even live rows can be half-written. No unguarded
 *      `JSON.parse`, no trusting a field's type or presence: the
 *      `MigrationArea` type params are call-site assertions, not validation.
 *      Presence-guard every access and THROW on anything malformed
 *      (fail-closed) — a migration that trusts its input is a vulnerability,
 *      not just a bug.
 *   7. Import it into `index.ts`'s `realMigrations` array.
 *   8. Add a colocated `*.test.ts` with before→after fixtures.
 *
 * `breaking` defaults to `true` (the new code REQUIRES this shape; a failed
 * migration blocks with recovery). Set `false` ONLY if the code genuinely
 * tolerates the un-migrated shape (a failed migration then boots degraded).
 *
 * A `root` is an EntityStorage namespace (rows keyed `${root}@${id}`); a `value`
 * is a single ValueStorage key. NEVER migrate the encrypted secret / KDF here —
 * the migrator runs pre-unlock and has no password (see wallet-crypto/README.md).
 */
import { defineMigration } from "@nulo/wallet-core/migration"
import { defineRowMapMigration } from "@/wallet/services/backup/row-map-migration"
import { ACCOUNT_STORAGE_ROOT } from "@/wallet/services/account/spec"

/** PREFERRED: the backup-safe declarative form. Finite data-only clauses
 *  (`rename` / `drop` / `retype` / `remapValues` / `addDefault`), applied per
 *  row in that fixed order — structurally row-local, so the SAME object
 *  migrates live storage at boot AND imported backups. Footprint is derived;
 *  idempotency is inherent (and still harness-verified). */
export const exampleRowMapMigration = defineRowMapMigration({
	version: 2,
	description: "example: add a default `pinned` flag to every account row",
	rowMaps: {
		[ACCOUNT_STORAGE_ROOT]: { addDefault: { pinned: false } },
	},
})

/** FALLBACK: the imperative form — full power, NOT backup-safe (blocks backup
 *  import at this version; see the header). Note the presence-guarded access
 *  per the hostile-input rule. */
export const exampleMigration = defineMigration({
	version: 2,
	description: "example: add a default `pinned` flag to every account row",
	reads: [{ kind: "root", root: "nulo:core:accounts" }],
	writes: [{ kind: "root", root: "nulo:core:accounts" }],
	up: async (ctx) => {
		// Declare the PRE-migration shape once via the type parameter. It is an
		// assertion over untrusted JSON, not a validation — keep field access
		// guarded (spread + default below is presence-safe and idempotent).
		type AccountRow = { pinned?: boolean; [k: string]: unknown }
		const rows = await ctx.local.rows<AccountRow>("nulo:core:accounts")
		await ctx.local.setRows<AccountRow>(
			"nulo:core:accounts",
			rows.map(([id, row]) => [id, { pinned: false, ...row }]),
		)
	},
})
