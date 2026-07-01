/**
 * TEMPLATE for a new data-preserving migration. To add one:
 *   1. Copy this file to `NNN-short-description.ts` (NNN = current max + 1).
 *   2. Set `version` to that number and describe the shape change.
 *   3. Declare the EXACT roots + value keys you read and write — the engine
 *      snapshots ONLY that footprint into the pre-migration backup, so an
 *      undeclared read/write is a data-loss risk.
 *   4. Keep `up` IDEMPOTENT (guard with `hasProperty`/presence checks) — the
 *      test harness runs it twice and asserts equality.
 *   5. Import it into `index.ts`'s `migrations` array.
 *   6. Add a colocated `*.test.ts` with before→after fixtures.
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

export const exampleMigration = defineMigration({
	version: 2,
	description: "example: add a default `pinned` flag to every account row",
	reads: [{ kind: "root", root: "nulo:core:accounts" }],
	writes: [{ kind: "root", root: "nulo:core:accounts" }],
	up: async (ctx) => {
		const rows = await ctx.local.rows("nulo:core:accounts")
		await ctx.local.setRows(
			"nulo:core:accounts",
			rows.map(([id, v]) => [id, { pinned: false, ...(v as object) }]),
		)
	},
})
