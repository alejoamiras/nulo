/**
 * The cross-system anti-drift guardrails for backup-import migrations:
 *
 * 1. FOOTPRINT COVERAGE — every backup-facing migration's read/write refs must
 *    be registry-covered; anything touching a block-listed root, an unmapped
 *    root, or authored imperatively (non-backup-safe) BLOCKS backup import and
 *    must be explicitly acknowledged below — an explicit release decision,
 *    never silent drift.
 * 2. METAMORPHIC GUARDRAIL (defense-in-depth behind the structural DSL) —
 *    every backup-safe migration's per-row output is byte-identical across
 *    single-row-subset × permutation × duplication runs through the REAL
 *    engine: catches any interpreter/descriptor bug that reintroduces
 *    sibling/order dependence.
 * 3. NON-FORGEABLE BRAND — `backupSafe` membership is factory-private and the
 *    branded migration is deep-frozen; brand-then-mutate is impossible.
 */
import { describe, expect, test } from "vitest"
import { defineMigration, type Migration, Migrator, SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import { MemoryStorageArea } from "@nulo/wallet-core/storage"
import { backupMigrationFixture } from "@/e2e/backup-migration-fixture"
import { backupMigrations, migrations, realMigrations } from "@/wallet/storage/migrations"
import { CONTACT_STORAGE_ROOT, ContactSchema } from "@/wallet/services/contact/spec"
import type { z } from "zod"
import { BACKUP_BLOCKED_ROOTS, BACKUP_SLICE_REGISTRY } from "./backup-migration-registry"
import { applyRowTransform, defineRowMapMigration, isBackupSafeMigration, rowMapDefOf, type RowMapTransform } from "./row-map-migration"

/** ⚠ EXPLICIT RELEASE DECISIONS ONLY. A version listed here ships knowing it
 *  BLOCKS backup import for every older backup it covers (users must
 *  re-export). Adding an entry requires the release notes to say so. */
const IMPORT_BLOCKING_ACK: ReadonlySet<number> = new Set([])

const coveredRoots = new Set<string>()
const coveredValueKeys = new Set<string>()
for (const desc of Object.values(BACKUP_SLICE_REGISTRY)) {
	if (desc.kind === "root") coveredRoots.add(desc.root)
	if (desc.kind === "value-projection") coveredValueKeys.add(desc.key)
}
const blocked = new Set(BACKUP_BLOCKED_ROOTS)

/** Everything that can ever reach the backup path (the stamped fixture is
 *  asserted explicitly since unit builds don't register it). */
const backupFacing: Migration[] = [...new Set([...backupMigrations, backupMigrationFixture])]

describe("footprint coverage (anti-drift keystone)", () => {
	test("the live array is exactly the real migrations in unstamped builds; backup array matches", () => {
		expect(migrations).toEqual(realMigrations)
		expect(backupMigrations).toEqual(realMigrations)
	})

	test("every backup-facing migration is backup-safe with a fully registry-covered footprint, or explicitly acknowledged as import-blocking", () => {
		for (const m of backupFacing) {
			const refs = [...m.reads, ...m.writes]
			const touchesBlocked = refs.some((r) => r.kind === "root" && blocked.has(r.root))
			const unmapped = refs.filter((r) => (r.kind === "root" ? !coveredRoots.has(r.root) : !coveredValueKeys.has(r.key)))
			const blocksImport = !isBackupSafeMigration(m) || touchesBlocked || unmapped.length > 0
			if (blocksImport) {
				expect(
					IMPORT_BLOCKING_ACK.has(m.version),
					`migration ${m.version} ("${m.description}") blocks backup import ` +
						`(backupSafe=${isBackupSafeMigration(m)}, blockedRoots=${touchesBlocked}, unmapped=${JSON.stringify(unmapped)}) ` +
						`— either make it a registry-covered defineRowMapMigration or acknowledge the version in IMPORT_BLOCKING_ACK`,
				).toBe(true)
			}
		}
	})

	test("block-listed roots and the registry never overlap (a root cannot be both migratable and blocked)", () => {
		for (const root of blocked) expect(coveredRoots.has(root), root).toBe(false)
	})
})

// ── Metamorphic guardrail ────────────────────────────────────────────────────

/** Derive sample rows straight from the transform's own declaration, so every
 *  DSL clause is exercised, plus generic rows the transform shouldn't touch. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 17 — the loops enumerate every row-transform DSL clause into its required samples
function sampleRowsFor(t: RowMapTransform): Array<Record<string, unknown>> {
	const rows: Array<Record<string, unknown>> = [{}, { untouched: "keep", n: 7, nested: { a: [1, 2] } }]
	for (const [oldName, newName] of Object.entries(t.rename ?? {})) {
		rows.push({ [oldName]: "pre-rename" }, { [newName]: "already-renamed" })
	}
	for (const field of t.drop ?? []) rows.push({ [field]: "to-drop" })
	for (const [field, kind] of Object.entries(t.retype ?? {})) {
		rows.push(kind === "number" ? { [field]: "42" } : kind === "boolean" ? { [field]: "true" } : { [field]: 42 })
	}
	for (const [field, table] of Object.entries(t.remapValues ?? {})) {
		for (const key of Object.keys(table)) rows.push({ [field]: key })
		rows.push({ [field]: "outside-the-table" })
	}
	for (const field of Object.keys(t.addDefault ?? {})) rows.push({ [field]: "pre-existing" })
	return rows
}

/** Run `m` over ONLY `rows` seeded under `root`, through the real engine. */
async function engineRun(m: Migration, root: string, rows: Array<[string, Record<string, unknown>]>): Promise<Map<string, string>> {
	const store = new MemoryStorageArea().seed({ [SCHEMA_VERSION_KEY]: m.version - 1 })
	for (const [id, row] of rows) store.data.set(`${root}@${id}`, JSON.stringify(row))
	const res = await new Migrator({ store, migrations: [m], baselineVersion: m.version - 1 }).run()
	if (res.kind !== "migrated") throw new Error(`engine returned ${res.kind}`)
	const out = new Map<string, string>()
	for (const [k, v] of store.data) if (k.startsWith(`${root}@`)) out.set(k.slice(root.length + 1), v as string)
	return out
}

describe("metamorphic guardrail: per-row output invariant under subset × permutation × duplication", () => {
	const covered = backupFacing.filter(isBackupSafeMigration)

	test("scope sanity: the stamped backup fixture is covered by this guardrail", () => {
		expect(covered).toContain(backupMigrationFixture)
	})

	test.each(covered.map((m) => [m.description, m] as const))("%s", async (_desc, m) => {
		const def = rowMapDefOf(m)
		if (!def) throw new Error("branded migration lost its DSL")
		for (const [root, transform] of Object.entries(def.rowMaps ?? {})) {
			const samples = sampleRowsFor(transform)
			const rows: Array<[string, Record<string, unknown>]> = samples.map((row, i) => [`id${i}`, row])

			const full = await engineRun(m, root, rows)
			expect(full.size).toBe(rows.length)

			// Single-row subsets: each row's output is independent of siblings.
			for (const [id, row] of rows) {
				const solo = await engineRun(m, root, [[id, row]])
				expect(solo.get(id), `subset ${id}`).toBe(full.get(id))
			}
			// Permutation: seeding order is invisible.
			const permuted = await engineRun(m, root, [...rows].reverse())
			for (const [id] of rows) expect(permuted.get(id), `permuted ${id}`).toBe(full.get(id))
			// Duplication: the same content under two ids transforms identically.
			const duplicated = await engineRun(
				m,
				root,
				rows.flatMap(
					([id, row]): Array<[string, Record<string, unknown>]> => [
						[id, row],
						[`${id}-dup`, row],
					],
				),
			)
			for (const [id] of rows) {
				expect(duplicated.get(id), `dup ${id}`).toBe(full.get(id))
				expect(duplicated.get(`${id}-dup`), `dup twin ${id}`).toBe(full.get(id))
			}
		}
	})

	// SCHEMA CONFORMANCE (post-#220 row codecs): a backup-safe migration whose
	// output violates the destination service's row schema produces a row that
	// restore WRITES but the next codec'd read returns as `undefined` —
	// invisible in the UI, dropped from the next export. We cannot fully prove
	// the old→new path here (only the author's before/after fixtures know the
	// old shape — see template.ts step 7), but a `drop`/`retype` of a required
	// field breaks a CURRENT-shape row too, which we CAN catch: apply each
	// migration to a schema-valid current row and assert it stays valid. The
	// map forces a sample when a future migration targets a new root.
	const SCHEMA_SAMPLES: Record<string, { schema: z.ZodType<unknown>; valid: Record<string, unknown> }> = {
		[CONTACT_STORAGE_ROOT]: {
			schema: ContactSchema as unknown as z.ZodType<unknown>,
			valid: { id: "c1", profileId: "p1", name: "Alice", address: "0xabc", abbr: "A" },
		},
	}

	test("every backup-safe migration keeps a schema-valid row valid (no dropped/retyped required field)", () => {
		for (const m of covered) {
			const def = rowMapDefOf(m)
			for (const root of Object.keys(def?.rowMaps ?? {})) {
				const sample = SCHEMA_SAMPLES[root]
				expect(
					sample,
					`migration ${m.version} transforms "${root}" but no schema sample is registered — add one to SCHEMA_SAMPLES so this guardrail can prove the output stays codec-valid`,
				).toBeDefined()
				if (!sample) continue
				const transform = def?.rowMaps?.[root]
				if (!transform) continue
				const out = applyRowTransform(sample.valid, transform)
				const parsed = sample.schema.safeParse(out)
				expect(
					parsed.success,
					`migration ${m.version} output for "${root}" fails its row schema (would restore invisible): ${JSON.stringify(out)}`,
				).toBe(true)
			}
		}
	})

	test("the guardrail has teeth: a migration dropping a schema-REQUIRED field is caught", () => {
		const dropsRequired = defineRowMapMigration({
			version: 2,
			description: "drops the required abbr field",
			rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: ["abbr"] } },
		})
		const transform = rowMapDefOf(dropsRequired)?.rowMaps?.[CONTACT_STORAGE_ROOT]
		const out = applyRowTransform(
			{ id: "c1", profileId: "p1", name: "Alice", address: "0xabc", abbr: "A" },
			transform as RowMapTransform,
		)
		expect(ContactSchema.safeParse(out).success).toBe(false)
	})

	test("interpreter idempotence: applying a transform twice equals applying it once (run-twice safety)", () => {
		for (const m of covered) {
			const def = rowMapDefOf(m)
			// BOTH rowMaps AND valueMaps: `applyRowTransform` is the same
			// interpreter for a value object, and the engine's empty-store
			// run-twice harness short-circuits an absent config value — so
			// without this a non-idempotent `valueMaps` transform would escape
			// every automated guardrail (row-map audit finding).
			const transforms = [...Object.values(def?.rowMaps ?? {}), ...Object.values(def?.valueMaps ?? {})]
			for (const transform of transforms) {
				for (const row of sampleRowsFor(transform)) {
					const once = applyRowTransform(row, transform)
					expect(applyRowTransform(once, transform)).toEqual(once)
				}
			}
		}
	})
})

// ── Non-forgeable brand + DSL well-formedness ────────────────────────────────

describe("backupSafe brand is non-forgeable", () => {
	const sample = () =>
		defineRowMapMigration({
			version: 2,
			description: "sample",
			rowMaps: { [CONTACT_STORAGE_ROOT]: { addDefault: { starred: false } } },
		})

	test("factory output is branded, deep-frozen, and carries its DSL", () => {
		const m = sample()
		expect(isBackupSafeMigration(m)).toBe(true)
		expect(Object.isFrozen(m)).toBe(true)
		expect(Object.isFrozen(m.reads)).toBe(true)
		expect(rowMapDefOf(m)?.rowMaps).toBeDefined()
	})

	test("post-brand mutation throws — up/reads cannot be reassigned into imperative logic", () => {
		const m = sample()
		expect(() => {
			;(m as { up: unknown }).up = async () => {}
		}).toThrow(TypeError)
		expect(() => {
			m.reads.push({ kind: "root", root: "nulo:core:evil" })
		}).toThrow(TypeError)
		expect(isBackupSafeMigration(m)).toBe(true)
	})

	test("nothing else can brand itself: imperative migrations and object copies are NOT backup-safe", () => {
		const imperative = defineMigration({
			version: 2,
			description: "imperative",
			reads: [{ kind: "root", root: CONTACT_STORAGE_ROOT }],
			writes: [{ kind: "root", root: CONTACT_STORAGE_ROOT }],
			up: async () => {},
		})
		expect(isBackupSafeMigration(imperative)).toBe(false)
		expect(rowMapDefOf(imperative)).toBeUndefined()
		const copy = Object.freeze({ ...sample() })
		expect(isBackupSafeMigration(copy)).toBe(false)
	})
})

describe("DSL define-time validation rejects ambiguous or non-idempotent transforms", () => {
	const define = (t: RowMapTransform) => defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: t } })

	test.each<[string, RowMapTransform]>([
		["rename onto itself", { rename: { a: "a" } }],
		["two renames onto one target", { rename: { a: "c", b: "c" } }],
		["rename chain a→b→c", { rename: { a: "b", b: "c" } }],
		["remap chain x→y→z", { remapValues: { f: { x: "y", y: "z" } } }],
		["empty field name", { drop: [""] }],
	])("%s", (_label, t) => {
		expect(() => define(t)).toThrow()
	})

	test("a migration transforming nothing is rejected", () => {
		expect(() => defineRowMapMigration({ version: 2, description: "x" })).toThrow()
	})

	test("cross-clause non-idempotency is rejected: addDefault field also transformed by an earlier clause", () => {
		// retype coerces the run-1 default on run 2; remapValues remaps it;
		// re-adding a rename source re-triggers the rename → collision. (Bug hunt.)
		const cases: RowMapTransform[] = [
			{ retype: { n: "number" }, addDefault: { n: "42" } },
			{ remapValues: { status: { old: "new" } }, addDefault: { status: "old" } },
			{ rename: { legacyName: "name" }, addDefault: { legacyName: "seed" } },
		]
		for (const t of cases) {
			expect(
				() => defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: t } }),
				JSON.stringify(t),
			).toThrow(/non-idempotent/)
		}
		// drop + addDefault on the same field is a stable reset — still allowed.
		expect(() =>
			defineRowMapMigration({
				version: 2,
				description: "x",
				rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: ["x"], addDefault: { x: 1 } } },
			}),
		).not.toThrow()
	})

	test("accessor smuggling is rejected: a getter on the transform is NOT pure data (codex post-impl finding)", () => {
		// A frozen accessor still executes on every read — per-row arbitrary
		// code behind an intact brand. The canonicalizer must throw on it.
		const withGetter = {}
		Object.defineProperty(withGetter, "rename", {
			get: () => ({ a: "b" }),
			enumerable: true,
			configurable: true,
		})
		expect(() =>
			defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: withGetter as RowMapTransform } }),
		).toThrow(/accessor/)

		const fnValue = { addDefault: { cb: (() => 1) as unknown as string } }
		expect(() =>
			defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: fnValue as RowMapTransform } }),
		).toThrow(/not plain JSON/)
	})

	test("array species/iterator smuggling is rejected: own non-index props, holes, and index accessors throw", () => {
		// An own `constructor` on a plain array redirects Array.prototype.map's
		// @@species — the clone would be an attacker-classed array whose
		// iterator runs per row. The canonicalizer never uses map and rejects
		// every own non-index key.
		const speciesDrop: string[] = ["legacy"]
		Object.defineProperty(speciesDrop, "constructor", { value: { [Symbol.species]: Array }, enumerable: false, configurable: true })
		expect(() =>
			defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: speciesDrop } } }),
		).toThrow(/non-index own property/)

		const iteratorDrop: string[] = ["legacy"]
		Object.defineProperty(iteratorDrop, Symbol.iterator, { value: () => ({ next: () => ({ done: true }) }), configurable: true })
		expect(() =>
			defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: iteratorDrop } } }),
		).toThrow(/non-index own property/)

		// biome-ignore lint/suspicious/noSparseArray: the hole IS the case under test
		const holey: string[] = ["a", , "b"] as string[]
		expect(() => defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: holey } } })).toThrow(
			/hole or accessor/,
		)

		const accessorIndex: string[] = []
		Object.defineProperty(accessorIndex, 0, { get: () => "boom", enumerable: true, configurable: true })
		Object.defineProperty(accessorIndex, "length", { value: 1 })
		expect(() =>
			defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: { drop: accessorIndex } } }),
		).toThrow(/hole or accessor/)
	})

	test("proto smuggling is rejected: computed __proto__ keys and __proto__ transform targets throw", () => {
		// `out["__proto__"] = …` on a plain clone would hit the inherited
		// SETTER and rewrite the clone's (unfrozen) prototype — a post-brand
		// mutation route via rowMapDefOf. Both the clone walker and the field
		// validator must reject the name.
		const protoKeyed = JSON.parse('{"rename":{"a":"b"},"__proto__":{"x":1}}') as RowMapTransform
		expect(() => defineRowMapMigration({ version: 2, description: "x", rowMaps: { [CONTACT_STORAGE_ROOT]: protoKeyed } })).toThrow(
			/__proto__/,
		)

		expect(() =>
			defineRowMapMigration({
				version: 2,
				description: "x",
				rowMaps: { [CONTACT_STORAGE_ROOT]: { rename: { legacy: "__proto__" } } },
			}),
		).toThrow(/__proto__/)
		expect(() =>
			defineRowMapMigration({
				version: 2,
				description: "x",
				rowMaps: { [CONTACT_STORAGE_ROOT]: { addDefault: JSON.parse('{"__proto__": true}') } },
			}),
		).toThrow(/__proto__/)
	})

	test("exotic transform objects are DEFUSED by canonicalization: the interpreter sees a plain clone, traps run at most once", () => {
		let reads = 0
		const proxied = new Proxy(
			{ addDefault: { starred: false } },
			{
				get(target, prop, receiver) {
					reads++
					return Reflect.get(target, prop, receiver)
				},
			},
		)
		const m = defineRowMapMigration({
			version: 2,
			description: "proxy defusal",
			rowMaps: { [CONTACT_STORAGE_ROOT]: proxied as RowMapTransform },
		})
		const readsAfterDefine = reads
		const def = rowMapDefOf(m)
		const transform = def?.rowMaps?.[CONTACT_STORAGE_ROOT]
		expect(transform).toEqual({ addDefault: { starred: false } })
		// Interpreting rows must not touch the proxy again — it closed over the clone.
		applyRowTransform({}, transform as RowMapTransform)
		applyRowTransform({ starred: true }, transform as RowMapTransform)
		expect(reads).toBe(readsAfterDefine)
	})

	test("interpreter fail-closed: rename collision and non-object rows throw", () => {
		expect(() => applyRowTransform({ a: 1, b: 2 }, { rename: { a: "b" } })).toThrow()
		expect(() => applyRowTransform("not-a-row", { drop: ["a"] })).toThrow()
		expect(() => applyRowTransform({ f: {} }, { retype: { f: "number" } })).toThrow()
	})

	test("fixed clause order: rename → drop → retype → remapValues → addDefault", () => {
		const t: RowMapTransform = {
			rename: { old: "status" },
			drop: ["legacy"],
			retype: { status: "string" },
			remapValues: { status: { "1": "active" } },
			addDefault: { status: "defaulted", kept: true },
		}
		// `old` renames to `status`, retypes 1 → "1", remaps "1" → "active";
		// addDefault must NOT overwrite it. `legacy` drops. `kept` defaults in.
		expect(applyRowTransform({ old: 1, legacy: "x" }, t)).toEqual({ status: "active", kept: true })
		// Without `old`, addDefault fills `status`.
		expect(applyRowTransform({}, t)).toEqual({ status: "defaulted", kept: true })
	})
})
