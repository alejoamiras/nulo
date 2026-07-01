import { describe, expect, test } from "vitest"
import { EntityStorage } from "../storage/entity_storage"
import { Migrator, RESERVED_KEYS, SCHEMA_RUNNING_KEY, SCHEMA_VERSION_KEY } from "./migrator"
import { defineMigration, type Migration, type MinimalStorageArea, type StorageRef } from "./types"

/** In-memory `MinimalStorageArea` with optional fault injection, for engine tests. */
class MemStore implements MinimalStorageArea {
	readonly data = new Map<string, unknown>()
	/** If set, `set()` throws when it would write any of these keys (simulates a
	 *  storage failure mid-restore). */
	failSetKeys?: Set<string>

	async get(keys?: string | string[]): Promise<Record<string, unknown>> {
		if (keys === undefined) return Object.fromEntries(this.data)
		const arr = Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of arr) if (this.data.has(k)) out[k] = this.data.get(k)
		return out
	}
	async set(items: Record<string, unknown>): Promise<void> {
		if (this.failSetKeys) for (const k of Object.keys(items)) if (this.failSetKeys.has(k)) throw new Error(`injected set failure: ${k}`)
		for (const [k, v] of Object.entries(items)) this.data.set(k, v)
	}
	async remove(keys: string | string[]): Promise<void> {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k)
	}
	seed(entries: Record<string, unknown>): this {
		for (const [k, v] of Object.entries(entries)) this.data.set(k, v)
		return this
	}
	obj(root: string, id: string): unknown {
		const raw = this.data.get(`${root}@${id}`)
		return raw === undefined ? undefined : JSON.parse(raw as string)
	}
	has(key: string): boolean {
		return this.data.has(key)
	}
}

const BACKUP_KEY = "nulo:schema:backup"
const ATTEMPTS_KEY = "nulo:schema:attempts"

const ver = (n: number) => ({ [SCHEMA_VERSION_KEY]: n })
const row = (root: string, id: string, obj: unknown) => ({ [`${root}@${id}`]: JSON.stringify(obj) })
const rootRef = (root: string): StorageRef => ({ kind: "root", root })
/** A journal as `applyOne` persists it (backup payloads carry the declared refs). */
const journal = (version: number, refs: StorageRef[], entries: Record<string, unknown>) => ({
	[SCHEMA_RUNNING_KEY]: 99,
	[BACKUP_KEY]: { version, refs, entries },
})

/** A migration that merges `patch` into every row of `root`. Idempotent. */
const patchRows = (version: number, root: string, patch: Record<string, unknown>): Migration =>
	defineMigration({
		version,
		description: `patch ${root}`,
		reads: [rootRef(root)],
		writes: [rootRef(root)],
		up: async (ctx) => {
			const rows = await ctx.local.rows<Record<string, unknown>>(root)
			await ctx.local.setRows(
				root,
				rows.map(([id, v]) => [id, { ...v, ...patch }]),
			)
		},
	})

const expectJournalClear = (store: MemStore) => {
	expect(store.has(SCHEMA_RUNNING_KEY)).toBe(false)
	expect(store.has(BACKUP_KEY)).toBe(false)
}

describe("Migrator — construction", () => {
	test("rejects non-positive and non-integer versions", () => {
		const store = new MemStore()
		const bad = (version: number) => defineMigration({ version, description: "x", reads: [], writes: [], up: async () => {} })
		expect(() => new Migrator({ store, migrations: [bad(0)] })).toThrow(/positive integer/)
		expect(() => new Migrator({ store, migrations: [bad(1.5)] })).toThrow(/positive integer/)
	})

	test("rejects duplicate versions", () => {
		const store = new MemStore()
		expect(() => new Migrator({ store, migrations: [patchRows(1, "a", {}), patchRows(1, "b", {})] })).toThrow(/duplicate/)
	})
})

describe("Migrator — marker decision table", () => {
	test("fresh install (no marker, no legacy) → init at max, runs nothing", async () => {
		const store = new MemStore()
		let ran = false
		const m = defineMigration({
			version: 1,
			description: "x",
			reads: [],
			writes: [],
			up: async () => {
				ran = true
			},
		})
		const r = await new Migrator({ store, migrations: [m] }).run()
		expect(r).toEqual({ kind: "fresh", version: 1 })
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1)
		expect(ran).toBe(false)
	})

	test("already at max → noop", async () => {
		const store = new MemStore().seed(ver(2))
		const r = await new Migrator({ store, migrations: [patchRows(1, "a", {}), patchRows(2, "a", {})] }).run()
		expect(r).toEqual({ kind: "noop", version: 2 })
	})

	test("baseline floor: fresh install stamps the baseline with an empty registry", async () => {
		const store = new MemStore()
		const r = await new Migrator({ store, migrations: [], baselineVersion: 1 }).run()
		expect(r).toEqual({ kind: "fresh", version: 1 })
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1)
	})

	test("baseline floor: an install below the baseline is stamped up to it (no bridging migration, data untouched)", async () => {
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		const r = await new Migrator({ store, migrations: [], baselineVersion: 1 }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1)
		expect(store.obj("acct", "a")).toEqual({ n: 0 })
		expectJournalClear(store)
	})

	test("baseline is a floor — a higher migration version wins", async () => {
		const store = new MemStore().seed(ver(1)).seed(row("acct", "a", { n: 0 }))
		await new Migrator({ store, migrations: [patchRows(2, "acct", { x: 1 })], baselineVersion: 1 }).run()
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(2)
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
	})

	test("corrupt marker over existing data → needs-recovery, terminal (never init-at-max)", async () => {
		const store = new MemStore().seed({ [SCHEMA_VERSION_KEY]: "garbage" }).seed(row("acct", "a", { n: 0 }))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
	})

	test("out-of-range marker → needs-recovery", async () => {
		const store = new MemStore().seed(ver(99))
		const r = await new Migrator({ store, migrations: [patchRows(1, "a", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
	})

	test("stale legacy key without a schema version → needs-recovery", async () => {
		const store = new MemStore().seed({ "nulo:core:storage-version": 8 }).seed(row("acct", "a", { n: 0 }))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
	})
})

describe("Migrator — sequential apply + checkpoint", () => {
	test("applies migrations in ascending order and clears the run-scoped barrier", async () => {
		const order: number[] = []
		const track = (v: number): Migration =>
			defineMigration({ version: v, description: `${v}`, reads: [], writes: [], up: async () => void order.push(v) })
		const store = new MemStore().seed(ver(0))
		const r = await new Migrator({ store, migrations: [track(2), track(1), track(3)] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 3 })
		expect(order).toEqual([1, 2, 3])
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(3)
		expectJournalClear(store)
	})

	test("from=1 runs only v2", async () => {
		const store = new MemStore().seed(ver(1)).seed(row("acct", "a", { n: 0 }))
		await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 }), patchRows(2, "acct", { y: 2 })] }).run()
		expect(store.obj("acct", "a")).toEqual({ n: 0, y: 2 }) // only v2's patch, not v1's
	})

	test("throw at N keeps 1…N-1 durable AND clears the journal (no wedged barrier)", async () => {
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		const boom = defineMigration({
			version: 2,
			description: "boom",
			reads: [],
			writes: [],
			up: async () => {
				throw new Error("kaboom")
			},
		})
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 }), boom] }).run()
		expect(r).toMatchObject({ kind: "failed", version: 2, reason: "kaboom" })
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1) // v1 checkpointed
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		// The barrier must NOT stay set: a degraded boot continues, and a wedged
		// `running` would park every UI storage access forever.
		expectJournalClear(store)
	})
})

describe("Migrator — crash-safe journal", () => {
	test("failed migration leaves data untouched and retries forward on the next run", async () => {
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		let attempt = 0
		const flaky = defineMigration({
			version: 1,
			description: "flaky",
			reads: [rootRef("acct")],
			writes: [rootRef("acct")],
			up: async (ctx) => {
				if (attempt++ === 0) throw new Error("transient")
				const rows = await ctx.local.rows<Record<string, unknown>>("acct")
				await ctx.local.setRows(
					"acct",
					rows.map(([id, v]) => [id, { ...v, x: 1 }]),
				)
			},
		})
		const mk = () => new Migrator({ store, migrations: [flaky] })

		const r1 = await mk().run()
		expect(r1).toMatchObject({ kind: "failed", attempts: 1, terminal: false })
		expect(store.obj("acct", "a")).toEqual({ n: 0 }) // unchanged — nothing committed
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(0)
		expectJournalClear(store)

		const r2 = await mk().run()
		expect(r2).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		expect(store.has(ATTEMPTS_KEY)).toBe(false) // cleared on success
	})

	test("crash mid-commit → resume restores the declared footprint (incl. tombstoning created rows) + re-runs", async () => {
		// Torn state: committed writes present, journal interrupted, version unstamped.
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0, x: 1 })) // committed write from the interrupted run
			.seed(row("acct", "b", { n: 9 })) // a row the interrupted migration CREATED
			.seed(journal(1, [rootRef("acct")], row("acct", "a", { n: 0 })))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 }) // re-derived cleanly
		expect(store.obj("acct", "b")).toBeUndefined() // created row was tombstoned by restore
		expectJournalClear(store)
	})

	test("crash AFTER stamp but BEFORE journal-clear → resume clears WITHOUT restoring (committed data survives)", async () => {
		// The completed-migration crash window: version already stamped to the
		// backup's version; restoring here would silently revert committed data
		// underneath the new marker.
		const store = new MemStore()
			.seed(ver(1)) // stamped
			.seed(row("acct", "a", { n: 0, x: 1 })) // committed post-shape
			.seed(journal(1, [rootRef("acct")], row("acct", "a", { n: 0 }))) // pre-shape backup
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r).toEqual({ kind: "noop", version: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 }) // NOT reverted
		expectJournalClear(store)
	})

	test("restore scans the DECLARED refs: rows created under a root that was EMPTY at backup time are tombstoned", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("newroot", "orphan", { half: true })) // created by the interrupted run
			.seed(journal(1, [rootRef("acct"), rootRef("newroot")], {})) // newroot had NO rows pre-migration
		const noop = defineMigration({ version: 1, description: "n", reads: [], writes: [], up: async () => {} })
		await new Migrator({ store, migrations: [noop] }).run()
		expect(store.obj("newroot", "orphan")).toBeUndefined()
	})

	test("an @-bearing VALUE key in the footprint never tombstones sibling keys", async () => {
		// Per-profile value keys look like `prefix@profileId`; restore must treat
		// them as exact keys, not as an EntityStorage root prefix.
		const store = new MemStore()
			.seed(ver(0))
			.seed({ "nulo:ui:pref@p1": JSON.stringify({ v: "post" }) })
			.seed({ "nulo:ui:pref@p2": JSON.stringify({ v: "sibling" }) })
			.seed(journal(1, [{ kind: "value", key: "nulo:ui:pref@p1" }], { "nulo:ui:pref@p1": JSON.stringify({ v: "pre" }) }))
		const noop = defineMigration({ version: 1, description: "n", reads: [], writes: [], up: async () => {} })
		await new Migrator({ store, migrations: [noop] }).run()
		expect(JSON.parse(store.data.get("nulo:ui:pref@p1") as string)).toEqual({ v: "pre" }) // restored
		expect(JSON.parse(store.data.get("nulo:ui:pref@p2") as string)).toEqual({ v: "sibling" }) // untouched
	})

	test("resume on prep-crash (running set, no backup) → clear + run normally", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0 }))
			.seed({ [SCHEMA_RUNNING_KEY]: 1 })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		expectJournalClear(store)
	})

	test("an INVALID backup payload fails closed (tampering/corruption — never written partially)", async () => {
		const store = new MemStore().seed(ver(0)).seed({ [SCHEMA_RUNNING_KEY]: 1, [BACKUP_KEY]: "garbage" })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
		expect(store.has(BACKUP_KEY)).toBe(true) // kept for forensics
	})

	test("a backup with MALFORMED refs fails closed (restore would trust them to tombstone)", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed({ [SCHEMA_RUNNING_KEY]: 1, [BACKUP_KEY]: { version: 1, refs: [{ kind: "root" }], entries: {} } })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
	})

	test("an armed journal with a NUMERIC-but-invalid version fails closed BEFORE any restore/clear", async () => {
		// `-1` passes a typeof check and compares `< backup.version` — without
		// full marker validation the engine would restore + clear (mutating
		// hostile state) before the marker table rejects it.
		for (const bad of [-1, 1.5, 999, Number.NaN]) {
			const store = new MemStore()
				.seed({ [SCHEMA_VERSION_KEY]: bad })
				.seed(row("acct", "a", { n: 5 }))
				.seed(journal(1, [rootRef("acct")], row("acct", "a", { n: 0 })))
			const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
			expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
			expect(store.obj("acct", "a")).toEqual({ n: 5 }) // NOT restored
			expect(store.has(BACKUP_KEY)).toBe(true) // journal kept
		}
	})

	test("a backup carrying an UNREGISTERED version fails closed before its refs are trusted", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 5 }))
			.seed(journal(42, [rootRef("acct")], row("acct", "a", { n: 0 }))) // max is 1
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
		expect(store.obj("acct", "a")).toEqual({ n: 5 }) // NOT restored/tombstoned
	})

	test("an armed journal with a MISSING version fails closed (never restore-then-fresh-stamp)", async () => {
		// No nulo:schema:version at all, but running + a valid backup: external
		// mutation. Restoring and falling through would end at the fresh-install
		// stamp, laundering the state past the marker decision table.
		const store = new MemStore().seed(row("acct", "a", { n: 5 })).seed(journal(1, [rootRef("acct")], row("acct", "a", { n: 0 })))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "needs-recovery", retryable: false })
		expect(store.obj("acct", "a")).toEqual({ n: 5 }) // NOT restored
		expect(store.has(SCHEMA_VERSION_KEY)).toBe(false) // NOT fresh-stamped
		expect(store.has(BACKUP_KEY)).toBe(true) // journal kept
	})

	test("restore failure → needs-recovery with BOUNDED retries across boots", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 5 }))
			.seed(journal(1, [rootRef("acct")], row("acct", "a", { n: 0 })))
		store.failSetKeys = new Set(["acct@a"]) // restore's set() will throw
		const mk = () => new Migrator({ store, migrations: [patchRows(1, "acct", {})], maxRetries: 2 })

		const r1 = await mk().run()
		expect(r1).toMatchObject({ kind: "needs-recovery", retryable: true }) // boot 1: retry
		expect(store.has(BACKUP_KEY)).toBe(true) // journal kept → next boot retries
		const r2 = await mk().run()
		expect(r2).toMatchObject({ kind: "needs-recovery", retryable: false }) // bound hit: terminal
	})

	test("restore does not write engine-namespace keys from a crafted backup", async () => {
		const store = new MemStore().seed(ver(0)).seed(
			journal(1, [rootRef("acct")], {
				...row("acct", "a", { n: 0 }),
				"nulo:schema:version": 99, // crafted: must be filtered, never restored
			}),
		)
		const noop = defineMigration({ version: 1, description: "n", reads: [], writes: [], up: async () => {} })
		await new Migrator({ store, migrations: [noop] }).run()
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1) // stamped by the run, not the crafted 99
	})
})

describe("Migrator — commit-time footprint enforcement", () => {
	test("a staged write OUTSIDE the declared footprint fails the migration and restores", async () => {
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		const sneaky = defineMigration({
			version: 1,
			description: "writes an undeclared root",
			reads: [rootRef("acct")],
			writes: [rootRef("acct")],
			up: async (ctx) => {
				await ctx.local.setValue("nulo:ui:undeclared", 1)
			},
		})
		const r = await new Migrator({ store, migrations: [sneaky] }).run()
		expect(r).toMatchObject({ kind: "failed" })
		expect((r as { reason: string }).reason).toContain("outside its declared footprint")
		expect(store.has("nulo:ui:undeclared")).toBe(false)
		expectJournalClear(store)
	})

	test("a staged write into the engine namespace fails the migration", async () => {
		const store = new MemStore().seed(ver(0))
		const hostile = defineMigration({
			version: 1,
			description: "tries to stamp itself",
			reads: [],
			writes: [{ kind: "value", key: "nulo:schema:version" }],
			up: async (ctx) => {
				await ctx.local.setValue("nulo:schema:version", 99)
			},
		})
		const r = await new Migrator({ store, migrations: [hostile] }).run()
		expect(r).toMatchObject({ kind: "failed" })
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(0)
	})
})

describe("Migrator — batched diff", () => {
	test("commits upserts + deletes inside the declared footprint", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0 }))
			.seed(row("acct", "b", { n: 9 }))
		const m = defineMigration({
			version: 1,
			description: "upsert a, delete b",
			reads: [rootRef("acct")],
			writes: [rootRef("acct")],
			up: async (ctx) => {
				await ctx.local.setRows("acct", [["a", { n: 1 }]], ["b"])
			},
		})
		await new Migrator({ store, migrations: [m] }).run()
		expect(store.obj("acct", "a")).toEqual({ n: 1 })
		expect(store.obj("acct", "b")).toBeUndefined()
		for (const k of RESERVED_KEYS) if (k !== SCHEMA_VERSION_KEY) expect(store.has(k)).toBe(false)
	})

	test("value refs: read-your-writes within a migration", async () => {
		const store = new MemStore().seed(ver(0)).seed({ "nulo:ui:pref": JSON.stringify({ theme: "dark" }) })
		let readBack: unknown
		const m = defineMigration({
			version: 1,
			description: "rename value field",
			reads: [{ kind: "value", key: "nulo:ui:pref" }],
			writes: [{ kind: "value", key: "nulo:ui:pref" }],
			up: async (ctx) => {
				const cur = await ctx.local.value<{ theme: string }>("nulo:ui:pref")
				if (cur === undefined) throw new Error("expected seeded pref")
				await ctx.local.setValue("nulo:ui:pref", { colorScheme: cur.theme })
				readBack = await ctx.local.value("nulo:ui:pref")
			},
		})
		const r = await new Migrator({ store, migrations: [m] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(readBack).toEqual({ colorScheme: "dark" }) // staged write visible to reads
		expect(JSON.parse(store.data.get("nulo:ui:pref") as string)).toEqual({ colorScheme: "dark" })
	})

	test("a malformed row throws (fail-closed) rather than being silently dropped", async () => {
		const store = new MemStore().seed(ver(0)).seed({ "acct@a": "{not json" })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r).toMatchObject({ kind: "failed" })
		expect(store.has("acct@a")).toBe(true) // NOT dropped
	})

	test("ctx.local.rows(root) matches EntityStorage.getAll for well-formed data", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 1 }))
			.seed(row("acct", "b", { n: 2 }))
		const byId = (rows: Array<[string, unknown]>) => rows.slice().sort((x, y) => x[0].localeCompare(y[0]))
		const viaEntity = byId(await new EntityStorage<{ n: number }>("acct", store).getAll())

		let viaCtx: Array<[string, unknown]> = []
		const capture = defineMigration({
			version: 1,
			description: "capture rows",
			reads: [rootRef("acct")],
			writes: [],
			up: async (ctx) => {
				viaCtx = byId(await ctx.local.rows("acct"))
			},
		})
		await new Migrator({ store, migrations: [capture] }).run()
		expect(viaCtx).toEqual(viaEntity)
	})
})

describe("Migrator — retry counter", () => {
	test("increments a durable counter and reports terminal past the bound", async () => {
		const boom = defineMigration({
			version: 1,
			description: "always throws",
			reads: [],
			writes: [],
			up: async () => {
				throw new Error("x")
			},
		})
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		const mk = () => new Migrator({ store, migrations: [boom], maxRetries: 2 })

		const r1 = await mk().run()
		expect(r1).toMatchObject({ kind: "failed", version: 1, attempts: 1, terminal: false, breaking: true })
		const r2 = await mk().run()
		expect(r2).toMatchObject({ kind: "failed", attempts: 2, terminal: true })
		expect(store.data.get(ATTEMPTS_KEY)).toEqual({ version: 1, phase: "up", count: 2 })
	})

	test("breaking flag propagates to the failure (drives block-vs-degrade)", async () => {
		const additive = defineMigration({
			version: 1,
			description: "additive",
			breaking: false,
			reads: [],
			writes: [],
			up: async () => {
				throw new Error("x")
			},
		})
		const store = new MemStore().seed(ver(0))
		const r = await new Migrator({ store, migrations: [additive], maxRetries: 1 }).run()
		expect(r).toMatchObject({ kind: "failed", breaking: false, terminal: true })
	})

	test("a non-breaking failure ESCALATES to breaking when later migrations remain pending", async () => {
		// breaking:false promises tolerance of THIS migration's old shape — not
		// that v2 (which may depend on v1's output) is safe to leave unapplied.
		const boom = defineMigration({
			version: 1,
			description: "non-breaking fail",
			breaking: false,
			reads: [],
			writes: [],
			up: async () => {
				throw new Error("x")
			},
		})
		const store = new MemStore().seed(ver(0))
		const r = await new Migrator({ store, migrations: [boom, patchRows(2, "acct", {})] }).run()
		expect(r).toMatchObject({ kind: "failed", breaking: true })
		expect((r as { reason: string }).reason).toContain("escalated")
	})
})

describe("Migrator — idempotency (run twice ≡ once)", () => {
	/** Apply a migration through the engine twice (resetting the version between)
	 *  and assert the non-reserved state is identical. Real migrations reuse
	 *  this shape in their own colocated tests. */
	async function runTwiceEqualsOnce(m: Migration, seed: Record<string, unknown>): Promise<boolean> {
		const nonReserved = (s: MemStore) => Object.fromEntries([...s.data].filter(([k]) => !RESERVED_KEYS.includes(k)))
		const store = new MemStore().seed({ [SCHEMA_VERSION_KEY]: m.version - 1 }).seed(seed)
		await new Migrator({ store, migrations: [m] }).run()
		const once = JSON.stringify(nonReserved(store))
		await store.set({ [SCHEMA_VERSION_KEY]: m.version - 1 }) // rewind, re-run the same migration
		await new Migrator({ store, migrations: [m] }).run()
		const twice = JSON.stringify(nonReserved(store))
		return once === twice
	}

	test("an idempotent migration: twice ≡ once", async () => {
		expect(await runTwiceEqualsOnce(patchRows(1, "acct", { x: 1 }), row("acct", "a", { n: 0 }))).toBe(true)
	})

	test("the harness CATCHES a non-idempotent migration (append)", async () => {
		const append = defineMigration({
			version: 1,
			description: "non-idempotent append",
			reads: [rootRef("acct")],
			writes: [rootRef("acct")],
			up: async (ctx) => {
				const rows = await ctx.local.rows<{ tags: number[] }>("acct")
				await ctx.local.setRows(
					"acct",
					rows.map(([id, v]) => [id, { ...v, tags: [...v.tags, 1] }]),
				)
			},
		})
		expect(await runTwiceEqualsOnce(append, row("acct", "a", { tags: [] }))).toBe(false)
	})
})
