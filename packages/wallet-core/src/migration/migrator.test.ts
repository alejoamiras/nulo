import { describe, expect, test } from "vitest"
import { Migrator, RESERVED_KEYS, SCHEMA_RUNNING_KEY, SCHEMA_VERSION_KEY } from "./migrator"
import { defineMigration, type Migration, type MinimalStorageArea } from "./types"

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

const ver = (n: number) => ({ [SCHEMA_VERSION_KEY]: n })
const row = (root: string, id: string, obj: unknown) => ({ [`${root}@${id}`]: JSON.stringify(obj) })

/** A migration that merges `patch` into every row of `root`. Idempotent. */
const patchRows = (version: number, root: string, patch: Record<string, unknown>): Migration =>
	defineMigration({
		version,
		description: `patch ${root}`,
		reads: [{ kind: "root", root }],
		writes: [{ kind: "root", root }],
		up: async (ctx) => {
			const rows = await ctx.local.rows(root)
			await ctx.local.setRows(
				root,
				rows.map(([id, v]) => [id, { ...(v as object), ...patch }]),
			)
		},
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

	test("corrupt marker over existing data → needs-recovery (never init-at-max)", async () => {
		const store = new MemStore().seed({ [SCHEMA_VERSION_KEY]: "garbage" }).seed(row("acct", "a", { n: 0 }))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r.kind).toBe("needs-recovery")
	})

	test("out-of-range marker → needs-recovery", async () => {
		const store = new MemStore().seed(ver(99))
		const r = await new Migrator({ store, migrations: [patchRows(1, "a", {})] }).run()
		expect(r.kind).toBe("needs-recovery")
	})

	test("stale legacy key without a schema version → needs-recovery", async () => {
		const store = new MemStore().seed({ "nulo:core:storage-version": 8 }).seed(row("acct", "a", { n: 0 }))
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r.kind).toBe("needs-recovery")
	})
})

describe("Migrator — sequential apply + checkpoint", () => {
	test("applies migrations in ascending order", async () => {
		const order: number[] = []
		const track = (v: number): Migration =>
			defineMigration({ version: v, description: `${v}`, reads: [], writes: [], up: async () => void order.push(v) })
		const store = new MemStore().seed(ver(0))
		const r = await new Migrator({ store, migrations: [track(2), track(1), track(3)] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 3 })
		expect(order).toEqual([1, 2, 3])
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(3)
	})

	test("from=1 runs only v2", async () => {
		const store = new MemStore().seed(ver(1)).seed(row("acct", "a", { n: 0 }))
		await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 }), patchRows(2, "acct", { y: 2 })] }).run()
		expect(store.obj("acct", "a")).toEqual({ n: 0, y: 2 }) // only v2's patch, not v1's
	})

	test("throw at N keeps 1…N-1 durable (per-migration checkpoint)", async () => {
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
		expect(r.kind).toBe("failed")
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(1) // v1 checkpointed
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		expect(store.has(SCHEMA_RUNNING_KEY)).toBe(true) // v2 left interrupted
	})
})

describe("Migrator — crash-safe journal", () => {
	test("failed migration restores + retries forward across runs", async () => {
		const store = new MemStore().seed(ver(0)).seed(row("acct", "a", { n: 0 }))
		let attempt = 0
		const flaky = defineMigration({
			version: 1,
			description: "flaky",
			reads: [{ kind: "root", root: "acct" }],
			writes: [{ kind: "root", root: "acct" }],
			up: async (ctx) => {
				if (attempt++ === 0) throw new Error("transient")
				const rows = await ctx.local.rows("acct")
				await ctx.local.setRows(
					"acct",
					rows.map(([id, v]) => [id, { ...(v as object), x: 1 }]),
				)
			},
		})
		const mk = () => new Migrator({ store, migrations: [flaky] })

		const r1 = await mk().run()
		expect(r1.kind).toBe("failed")
		expect(store.obj("acct", "a")).toEqual({ n: 0 }) // unchanged — nothing committed
		expect(store.data.get(SCHEMA_VERSION_KEY)).toBe(0)

		const r2 = await mk().run() // resumes, restores, retries
		expect(r2).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		expect(store.has(SCHEMA_RUNNING_KEY)).toBe(false)
		expect(store.has("nulo:schema:backup")).toBe(false)
		expect(store.has("nulo:schema:attempts")).toBe(false) // cleared on success
	})

	test("crash AFTER commit → resume restores the footprint (incl. tombstoning created rows) + re-runs", async () => {
		// Simulate an SW kill between commit and clear: post-migration data present,
		// journal still interrupted, version not yet stamped.
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0, x: 1 })) // committed write from the interrupted run
			.seed(row("acct", "b", { n: 9 })) // a row the interrupted migration CREATED
			.seed({ [SCHEMA_RUNNING_KEY]: 1 })
			.seed({ "nulo:schema:backup": { version: 1, entries: row("acct", "a", { n: 0 }) } })
		const m = patchRows(1, "acct", { x: 1 })
		const r = await new Migrator({ store, migrations: [m] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 }) // re-derived cleanly
		expect(store.obj("acct", "b")).toBeUndefined() // created row was tombstoned by restore
		expect(store.has(SCHEMA_RUNNING_KEY)).toBe(false)
	})

	test("resume on prep-crash (running set, no backup) → clear + run normally", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0 }))
			.seed({ [SCHEMA_RUNNING_KEY]: 1 })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r).toEqual({ kind: "migrated", from: 0, to: 1 })
		expect(store.obj("acct", "a")).toEqual({ n: 0, x: 1 })
		expect(store.has(SCHEMA_RUNNING_KEY)).toBe(false)
	})

	test("restore failure → needs-recovery, backup KEPT (fail closed)", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 5 }))
			.seed({ [SCHEMA_RUNNING_KEY]: 1 })
			.seed({ "nulo:schema:backup": { version: 1, entries: row("acct", "a", { n: 0 }) } })
		store.failSetKeys = new Set(["acct@a"]) // restore's set() will throw
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", {})] }).run()
		expect(r.kind).toBe("needs-recovery")
		expect(store.has("nulo:schema:backup")).toBe(true) // kept for forensics/retry
	})
})

describe("Migrator — batched diff", () => {
	test("commits upserts + deletes; a migration never touches reserved keys", async () => {
		const store = new MemStore()
			.seed(ver(0))
			.seed(row("acct", "a", { n: 0 }))
			.seed(row("acct", "b", { n: 9 }))
		const m = defineMigration({
			version: 1,
			description: "upsert a, delete b",
			reads: [{ kind: "root", root: "acct" }],
			writes: [{ kind: "root", root: "acct" }],
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
		const m = defineMigration({
			version: 1,
			description: "rename value field",
			reads: [{ kind: "value", key: "nulo:ui:pref" }],
			writes: [{ kind: "value", key: "nulo:ui:pref" }],
			up: async (ctx) => {
				const cur = (await ctx.local.value("nulo:ui:pref")) as { theme: string }
				await ctx.local.setValue("nulo:ui:pref", { colorScheme: cur.theme })
				const readBack = await ctx.local.value("nulo:ui:pref") // read-your-writes
				expect(readBack).toEqual({ colorScheme: "dark" })
			},
		})
		await new Migrator({ store, migrations: [m] }).run()
		expect(JSON.parse(store.data.get("nulo:ui:pref") as string)).toEqual({ colorScheme: "dark" })
	})

	test("a malformed row throws (fail-closed) rather than being silently dropped", async () => {
		const store = new MemStore().seed(ver(0)).seed({ "acct@a": "{not json" })
		const r = await new Migrator({ store, migrations: [patchRows(1, "acct", { x: 1 })] }).run()
		expect(r.kind).toBe("failed")
		expect(store.has("acct@a")).toBe(true) // NOT dropped
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
		// The counter is durable + reserved (never inside a migration's footprint).
		expect(store.data.get("nulo:schema:attempts")).toEqual({ version: 1, count: 2 })
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
})

describe("Migrator — idempotency (run twice ≡ once)", () => {
	/** Apply a migration through the engine twice (resetting the version between)
	 *  and assert the non-reserved state is identical. Phase 2 migrations reuse
	 *  this shape in their own tests. */
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
			reads: [{ kind: "root", root: "acct" }],
			writes: [{ kind: "root", root: "acct" }],
			up: async (ctx) => {
				const rows = await ctx.local.rows("acct")
				await ctx.local.setRows(
					"acct",
					rows.map(([id, v]) => [id, { ...(v as { tags: number[] }), tags: [...(v as { tags: number[] }).tags, 1] }]),
				)
			},
		})
		expect(await runTwiceEqualsOnce(append, row("acct", "a", { tags: [] }))).toBe(false)
	})
})
