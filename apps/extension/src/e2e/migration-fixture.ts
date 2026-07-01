/**
 * E2E fixture migration — proves the migration machinery end-to-end through
 * the real boot path (smoke suite: `tests/e2e/migration.test.ts`).
 *
 * Registered ONLY when the build was stamped with
 * `VITE_NULO_E2E_MIGRATION_FIXTURE=1` (see `./config.ts`): the registry
 * spreads it behind the static-false constant, so production builds
 * tree-shake this module and the `_build-extension.yml` negative grep asserts
 * its marker never ships. It transforms only rows under its own test-only
 * root, which no real install has — inert even if it somehow ran.
 *
 * Test controls (both OUTSIDE the declared footprint, deliberately — a
 * footprint key would be snapshotted into the pre-migration backup and
 * restored on failure, resurrecting a "throw" toggle forever; these are
 * read-only test knobs, never written by the migration):
 * - `nulo:e2e:migration-boom` present ⇒ `up()` throws (exercises fail-closed
 *   → blocked UX → clear the key → next boot retries forward).
 * - `nulo:e2e:migration-hold` present ⇒ `up()` waits until it clears
 *   (safety-capped), letting a test observe the mid-migration barrier or kill
 *   the SW mid-flight.
 */
import { defineMigration } from "@nulo/wallet-core/migration"

/** The test-only EntityStorage root the fixture transforms. Also the
 *  negative-grep marker (`_build-extension.yml`). */
export const MIGRATION_FIXTURE_ROOT = "nulo:e2e:mig-fixture"
export const MIGRATION_FIXTURE_BOOM_KEY = "nulo:e2e:migration-boom"
export const MIGRATION_FIXTURE_HOLD_KEY = "nulo:e2e:migration-hold"
export const MIGRATION_FIXTURE_VERSION = 2

/** Must stay under the smoke vitest testTimeout (60s) so a forgotten hold
 *  fails the test's own assertion, not the generic timeout — but long enough
 *  that page-open latency can't self-release a hold a test is observing. */
const HOLD_SAFETY_TIMEOUT_MS = 30_000
const HOLD_POLL_MS = 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** v1 → v2: rename each row's `legacyName` field to `name` (a representative
 *  data-preserving transform). Idempotent: already-renamed rows pass through.
 *  The `@__PURE__` annotation is LOAD-BEARING: without it the bundler keeps the
 *  `defineMigration(...)` call as a possible side effect even after the
 *  registry's static-false spread drops the binding — leaking the fixture (and
 *  its grep marker) into production bundles. */
export const migrationFixture = /* @__PURE__ */ defineMigration({
	version: MIGRATION_FIXTURE_VERSION,
	description: "e2e fixture: rename legacyName → name on the test-only root",
	reads: [{ kind: "root", root: MIGRATION_FIXTURE_ROOT }],
	writes: [{ kind: "root", root: MIGRATION_FIXTURE_ROOT }],
	up: async (ctx) => {
		const start = Date.now()
		while ((await ctx.local.value(MIGRATION_FIXTURE_HOLD_KEY)) !== undefined) {
			if (Date.now() - start > HOLD_SAFETY_TIMEOUT_MS) {
				console.warn(`[e2e-migration-fixture] hold safety timeout after ${HOLD_SAFETY_TIMEOUT_MS}ms — proceeding.`)
				break
			}
			await sleep(HOLD_POLL_MS)
		}
		if ((await ctx.local.value(MIGRATION_FIXTURE_BOOM_KEY)) !== undefined) {
			throw new Error("e2e fixture migration: boom key present")
		}
		type FixtureRow = { legacyName?: string; name?: string; [k: string]: unknown }
		const rows = await ctx.local.rows<FixtureRow>(MIGRATION_FIXTURE_ROOT)
		await ctx.local.setRows<FixtureRow>(
			MIGRATION_FIXTURE_ROOT,
			rows.map(([id, row]) => {
				if (row.legacyName === undefined) return [id, row]
				const { legacyName, ...rest } = row
				return [id, { ...rest, name: legacyName }]
			}),
		)
	},
})
