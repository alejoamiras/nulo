/**
 * BUG PROOF — C3-1: migration retry budget is spent by AMBIENT service-worker
 * wakes, auto-escalating a recoverable block to terminal.
 *
 * Every MV3 wake (dApp tab reload, popup open, price alarm) runs module-level
 * `runtime.start()` → `Migrator.run()`. On a transiently-failing migration each
 * run bumps the DURABLE per-(version,phase) attempt counter and nothing
 * short-circuits on the persisted blocked status. After `maxRetries` ambient
 * wakes the result flips `terminal: true` and MigrationBarrier instructs
 * "Reinstall the extension" for a condition one manual retry could have
 * survived.
 *
 * This proof simulates three ordinary SW wakes (three `run()` calls against a
 * fresh Migrator over the SAME durable store) with a transient storage failure
 * and asserts the CORRECT behavior: the block must still be retryable.
 *
 * RED today = third wake returns terminal:true (budget burned by wakes that
 * were not user-consented retries). GREEN after fix = blocked status is
 * honored / attempts are not spent by non-deliberate boots.
 */
import { defineMigration } from "@nulo/wallet-core/migration"
import { MemoryStorageArea } from "@nulo/wallet-core/storage"
import { describe, expect, test } from "vitest"
import { Migrator } from "../../../../packages/wallet-core/src/migration/migrator"

class FlakySetStore extends MemoryStorageArea {
	failNextSetFor: string | undefined
	override async set(items: Record<string, unknown>): Promise<void> {
		if (this.failNextSetFor) {
			for (const k of Object.keys(items)) {
				if (k === this.failNextSetFor || k.startsWith("data@")) {
					this.failNextSetFor = undefined
					throw new Error("injected transient storage failure (quota/disk)")
				}
			}
		}
		return super.set(items)
	}
}

const migration = defineMigration({
	id: "900-proof-ambient-burn",
	version: 2,
	breaking: true,
	reads: [{ kind: "root", root: "data" }],
	writes: [{ kind: "root", root: "data" }],
	async up(ctx) {
		const rows = await ctx.local.rows<{ v?: number }>("data")
		await ctx.local.setRows(
			"data",
			rows.map(([id, row]) => [id, { ...row, v: 2 }]),
		)
	},
})

describe("C3-1: ambient SW wakes must not exhaust the migration retry budget", () => {
	test("three ambient boots of a transiently-failing migration keep the block RETRYABLE", async () => {
		const store = new FlakySetStore()
		await store.set({ "nulo:schema:version": 1 })
		await store.set({ "data@a": JSON.stringify({ v: 1 }) })

		const mkMigrator = () =>
			new Migrator({
				store,
				migrations: [migration],
				baselineVersion: 1,
				maxRetries: 3,
			})

		// Wake 1 — dApp tab reloads. up()'s commit hits the injected storage failure.
		store.failNextSetFor = "data@"
		const r1 = await mkMigrator().run()
		expect(r1.kind === "failed" || r1.kind === "needs-recovery").toBe(true)

		// Wake 2 — user opens the popup. Same transient failure.
		store.failNextSetFor = "data@"
		const r2 = await mkMigrator().run()

		// Wake 3 — price alarm fires. The failure was environmental; no user has
		// consented to giving up on this migration.
		store.failNextSetFor = "data@"
		const r3 = await mkMigrator().run()

		const terminal =
			(r1.kind === "failed" ? r1.terminal : false) ||
			(r2.kind === "failed" ? r2.terminal : false) ||
			(r3.kind === "failed" ? r3.terminal : false)

		// CORRECT behavior: ambient wakes must not flip a recoverable block to
		// terminal ("Reinstall the extension"). RED today: attempts >= maxRetries
		// makes an early wake already terminal — the budget was spent by traffic
		// the user never directed.
		expect(terminal).toBe(false)
	})
})
