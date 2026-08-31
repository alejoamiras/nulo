/**
 * `defineRowMapMigration` — the BACKUP-SAFE migration form: a finite
 * declarative DSL of pure DATA, compiled into a standard `Migration`.
 *
 * WHY NO AUTHOR FUNCTIONS — DO NOT "IMPROVE" THIS (rejected 4× in audit):
 * a backup is a partial/profile-scoped PROJECTION of the live store, so a
 * backup-safe migration must be row-local — its output for a row must not
 * depend on sibling rows, row order, or call count. Arbitrary JS cannot be
 * proven row-local (a `(row)=>row` signature is defeated by a mutable
 * closure; metamorphic sampling is defeated by a value-gated closure). The
 * only airtight enforcement is STRUCTURAL: every transform here is data
 * (`rename`/`addDefault`/`drop`/`retype`/`remapValues`), interpreted per row
 * by this module — data cannot observe siblings or order. A transform that
 * doesn't fit the DSL belongs in an imperative `defineMigration`, which is
 * NOT backup-safe and blocks backup import at any version it covers (the
 * honest escape hatch).
 *
 * The compiled migration processes ATTACKER-CONTROLLED rows on the backup
 * path: the interpreter presence-guards everything and throws on any shape it
 * cannot transform deterministically (fail-closed → the engine reports
 * `failed` → the import is rejected).
 */
import { defineMigration, type Migration, type StorageRef } from "@nulo/wallet-core/migration"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One root's (or stored value's) declarative transform. All entries are pure
 *  data. Applied per row in a FIXED order: rename → drop → retype →
 *  remapValues → addDefault. Field names in `retype`/`remapValues`/`drop`/
 *  `addDefault` refer to POST-rename names. */
export interface RowMapTransform {
	/** `{ oldField: newField }`. A row without `oldField` passes through
	 *  (already renamed — idempotent). A row carrying BOTH names fails closed. */
	rename?: Readonly<Record<string, string>>
	/** Remove these fields when present. */
	drop?: readonly string[]
	/** Coerce a field to the declared primitive. Absent fields pass through;
	 *  a value that can't be converted deterministically fails closed. */
	retype?: Readonly<Record<string, "string" | "number" | "boolean">>
	/** `{ field: { oldValue: newValue } }` — finite enum-value remap. The
	 *  current value is matched by its `String()` form; non-primitive values
	 *  never match. Values outside the table pass through. */
	remapValues?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
	/** Add `{ field: value }` when the field is ABSENT (idempotent). */
	addDefault?: Readonly<Record<string, JsonValue>>
}

export interface RowMapMigrationDef {
	/** Strictly-increasing integer, same number space as every live migration. */
	version: number
	description: string
	/** Same semantics as `defineMigration` — defaults `true`. */
	breaking?: boolean
	/** EntityStorage roots → per-row transform. */
	rowMaps?: Readonly<Record<string, RowMapTransform>>
	/** ValueStorage keys → transform applied to the single stored OBJECT
	 *  (`rename` is then a key-rename — the config-migration shape). An absent
	 *  value stays absent (never fabricated). */
	valueMaps?: Readonly<Record<string, RowMapTransform>>
}

/** Module-private brand: ONLY `defineRowMapMigration` can add to it, and the
 *  branded object is deep-frozen so `up`/`reads`/`writes` cannot be reassigned
 *  after branding (the WeakSet brands the object, not its contents). */
const backupSafeBrand = new WeakSet<Migration>()

/** The frozen source DSL per branded migration — lets the metamorphic
 *  guardrail derive per-transform sample rows without widening `Migration`. */
const compiledFrom = new WeakMap<Migration, RowMapMigrationDef>()

/** `true` iff `m` was built by `defineRowMapMigration` AND is still frozen. */
export function isBackupSafeMigration(m: Migration): boolean {
	return backupSafeBrand.has(m) && Object.isFrozen(m) && Object.isFrozen(m.up)
}

/** The (frozen) DSL a branded migration was compiled from; `undefined` for
 *  anything `isBackupSafeMigration` would reject. */
export function rowMapDefOf(m: Migration): RowMapMigrationDef | undefined {
	return isBackupSafeMigration(m) ? compiledFrom.get(m) : undefined
}

export function defineRowMapMigration(def: RowMapMigrationDef): Migration {
	// Canonicalize BEFORE anything else: the data-only guarantee must hold
	// against accessor properties and Proxies, which survive Object.freeze (a
	// frozen accessor still runs its getter on every read — arbitrary code per
	// row, the exact hole the DSL exists to close). Detectable accessors are
	// REJECTED; anything exotic that lies its way past detection is DEFUSED,
	// because the interpreter only ever sees this plain-literal clone, built
	// exactly once here (codex post-impl audit, finding 1).
	if (
		typeof def.version !== "number" ||
		typeof def.description !== "string" ||
		(def.breaking !== undefined && typeof def.breaking !== "boolean")
	) {
		throw new Error("row-map migration version/description/breaking must be primitives")
	}
	const rowMaps = canonicalizeTransformMap(def.rowMaps ?? {}, "rowMaps")
	const valueMaps = canonicalizeTransformMap(def.valueMaps ?? {}, "valueMaps")
	const roots = Object.keys(rowMaps)
	const valueKeys = Object.keys(valueMaps)
	if (roots.length + valueKeys.length === 0) throw new Error("row-map migration transforms nothing")
	for (const [target, transform] of [...Object.entries(rowMaps), ...Object.entries(valueMaps)]) {
		validateTransform(target, transform)
	}

	const refs: StorageRef[] = [
		...roots.map((root): StorageRef => ({ kind: "root", root })),
		...valueKeys.map((key): StorageRef => ({ kind: "value", key })),
	]

	const migration = defineMigration({
		version: def.version,
		description: def.description,
		...(def.breaking === undefined ? {} : { breaking: def.breaking }),
		reads: refs,
		writes: refs.map((r) => ({ ...r })),
		up: async (ctx) => {
			for (const [root, transform] of Object.entries(rowMaps)) {
				const rows = await ctx.local.rows(root)
				await ctx.local.setRows(
					root,
					rows.map(([id, row]) => [id, applyRowTransform(row, transform)]),
				)
			}
			for (const [key, transform] of Object.entries(valueMaps)) {
				const value = await ctx.local.value(key)
				if (value === undefined) continue
				await ctx.local.setValue(key, applyRowTransform(value, transform))
			}
		},
	})

	deepFreeze(migration)
	// Brand + expose ONLY the canonical clone — never the caller's objects.
	const canonicalDef: RowMapMigrationDef = {
		version: def.version,
		description: def.description,
		...(def.breaking === undefined ? {} : { breaking: def.breaking }),
		...(roots.length ? { rowMaps } : {}),
		...(valueKeys.length ? { valueMaps } : {}),
	}
	deepFreeze(canonicalDef)
	backupSafeBrand.add(migration)
	compiledFrom.set(migration, canonicalDef)
	return migration
}

/** Recursively copy a transform map into fresh plain literals, REJECTING
 *  anything that is not inert JSON data: accessor properties (a frozen getter
 *  still executes on every read), symbol keys, non-plain prototypes,
 *  functions, and non-JSON primitives. Exotic objects that evade detection
 *  (a Proxy can lie to descriptor checks) are still defused — their traps run
 *  at most once, here, and the interpreter closes over the clone. */
function canonicalizeTransformMap(maps: Readonly<Record<string, RowMapTransform>>, where: string): Record<string, RowMapTransform> {
	return cloneJsonObject(maps, where) as unknown as Record<string, RowMapTransform>
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 24) — refactor when touched, never raise
function cloneJsonValue(value: unknown, path: string): JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`row-map data at ${path} is a non-finite number`)
		return value
	}
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`row-map data at ${path} has an exotic array prototype`)
		// Clone index-by-index into a LITERAL array — never Array.prototype.map,
		// whose @@species lookup lets an own `constructor` property substitute an
		// attacker-classed result whose iterator would then run per row. Any own
		// non-index key (incl. `constructor` or a symbol like @@iterator), hole,
		// or index accessor is rejected outright.
		for (const key of Reflect.ownKeys(value)) {
			if (key === "length") continue
			if (typeof key !== "string" || String(Number(key)) !== key || !(Number(key) >= 0)) {
				throw new Error(`row-map data at ${path} array carries a non-index own property`)
			}
		}
		const out: JsonValue[] = []
		for (let i = 0; i < value.length; i++) {
			const desc = Object.getOwnPropertyDescriptor(value, i)
			if (!desc || desc.get !== undefined || desc.set !== undefined) {
				throw new Error(`row-map data at ${path}[${i}] is a hole or accessor — transforms must be pure data`)
			}
			out.push(cloneJsonValue(desc.value, `${path}[${i}]`))
		}
		return out
	}
	if (typeof value === "object") return cloneJsonObject(value as Record<string, unknown>, path)
	throw new Error(`row-map data at ${path} is not plain JSON data (got ${typeof value})`)
}

function cloneJsonObject(value: Record<string, unknown>, path: string): { [key: string]: JsonValue } {
	const proto = Object.getPrototypeOf(value)
	if (proto !== Object.prototype && proto !== null) throw new Error(`row-map data at ${path} has a non-plain prototype`)
	if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`row-map data at ${path} has symbol keys`)
	const out: { [key: string]: JsonValue } = {}
	for (const key of Object.keys(value)) {
		// An own computed `__proto__` key would not survive a naive `out[key] =`
		// (the inherited setter rewrites the clone's PROTOTYPE, which deepFreeze
		// does not freeze — a post-brand mutation route). Reject the name AND
		// write via defineProperty so no setter can ever be reached.
		if (key === "__proto__") throw new Error(`row-map data at ${path} has a "__proto__" key`)
		const desc = Object.getOwnPropertyDescriptor(value, key)
		if (!desc || desc.get !== undefined || desc.set !== undefined) {
			throw new Error(`row-map data at ${path}.${key} is an accessor — transforms must be pure data`)
		}
		Object.defineProperty(out, key, {
			value: cloneJsonValue(desc.value, `${path}.${key}`),
			enumerable: true,
			writable: true,
			configurable: true,
		})
	}
	return out
}

/** Define-time well-formedness: reject transforms that could be ambiguous or
 *  non-idempotent BEFORE they ever meet data. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 53) — refactor when touched, never raise
function validateTransform(target: string, t: RowMapTransform): void {
	const fail = (reason: string): never => {
		throw new Error(`row-map transform for "${target}": ${reason}`)
	}
	const fields = (names: Iterable<string>, where: string) => {
		for (const n of names) {
			if (typeof n !== "string" || n.length === 0) fail(`${where} has an empty field name`)
			// Writing `out["__proto__"]` on a row clone would mutate its
			// prototype via the inherited setter, not set a field — never a
			// legitimate transform target.
			if (n === "__proto__") fail(`${where} targets "__proto__"`)
		}
	}
	if (t.rename) {
		fields(Object.keys(t.rename), "rename")
		const targets = new Set<string>()
		for (const [oldName, newName] of Object.entries(t.rename)) {
			if (typeof newName !== "string" || newName.length === 0) fail("rename has an empty target name")
			if (newName === "__proto__") fail(`rename targets "__proto__"`)
			if (oldName === newName) fail(`rename maps "${oldName}" onto itself`)
			if (targets.has(newName)) fail(`rename maps two fields onto "${newName}"`)
			targets.add(newName)
			if (Object.hasOwn(t.rename, newName)) fail(`rename chains through "${newName}" (non-idempotent)`)
		}
	}
	if (t.drop) fields(t.drop, "drop")
	if (t.retype) fields(Object.keys(t.retype), "retype")
	if (t.addDefault) fields(Object.keys(t.addDefault), "addDefault")
	if (t.remapValues) {
		fields(Object.keys(t.remapValues), "remapValues")
		for (const [field, table] of Object.entries(t.remapValues)) {
			for (const [oldValue, newValue] of Object.entries(table)) {
				// A new value that is itself a remap SOURCE would remap again on a
				// re-run (a→b→c) — non-idempotent, reject at define time.
				const asKey =
					typeof newValue === "string" || typeof newValue === "number" || typeof newValue === "boolean"
						? String(newValue)
						: undefined
				if (asKey !== undefined && asKey !== oldValue && Object.hasOwn(table, asKey)) {
					fail(`remapValues for "${field}" chains "${oldValue}" → ${JSON.stringify(newValue)} → … (non-idempotent)`)
				}
			}
		}
	}

	// Cross-clause idempotency: `addDefault` runs LAST, so a field it fills on
	// the first pass would be re-transformed by an earlier value clause on the
	// second — the harness runs every migration twice. Reject a default whose
	// field is also `retype`d / `remapValues`d (run 2 coerces/remaps the
	// freshly-defaulted value), or is a `rename` SOURCE (run 2 re-triggers the
	// rename → a both-names collision throw). Overlap with `drop` is fine
	// (drop-then-default is a stable reset).
	if (t.addDefault) {
		const retypeFields = new Set(Object.keys(t.retype ?? {}))
		const remapFields = new Set(Object.keys(t.remapValues ?? {}))
		const renameSources = new Set(Object.keys(t.rename ?? {}))
		for (const field of Object.keys(t.addDefault)) {
			if (retypeFields.has(field)) fail(`addDefault "${field}" is also retyped — a re-run would coerce the default (non-idempotent)`)
			if (remapFields.has(field)) fail(`addDefault "${field}" is also remapped — a re-run would remap the default (non-idempotent)`)
			if (renameSources.has(field))
				fail(`addDefault "${field}" re-creates a rename source — a re-run would re-trigger the rename (non-idempotent)`)
		}
	}
}

/** The per-row interpreter. Deterministic, sibling-blind, order-blind: its
 *  ONLY inputs are one row and the frozen transform data. Throws on anything
 *  it cannot transform unambiguously (hostile-input rule: presence-guard
 *  every access, fail closed). Exported for the metamorphic guardrail tests. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 39) — refactor when touched, never raise
export function applyRowTransform(row: unknown, t: RowMapTransform): Record<string, unknown> {
	if (typeof row !== "object" || row === null || Array.isArray(row)) {
		throw new Error("row is not an object")
	}
	const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }

	if (t.rename) {
		for (const [oldName, newName] of Object.entries(t.rename)) {
			if (!Object.hasOwn(out, oldName)) continue
			if (Object.hasOwn(out, newName)) throw new Error(`rename collision: row carries both "${oldName}" and "${newName}"`)
			out[newName] = out[oldName]
			delete out[oldName]
		}
	}
	if (t.drop) {
		for (const field of t.drop) delete out[field]
	}
	if (t.retype) {
		for (const [field, kind] of Object.entries(t.retype)) {
			if (!Object.hasOwn(out, field)) continue
			out[field] = retypeValue(field, out[field], kind)
		}
	}
	if (t.remapValues) {
		for (const [field, table] of Object.entries(t.remapValues)) {
			if (!Object.hasOwn(out, field)) continue
			const v = out[field]
			if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue
			const key = String(v)
			if (Object.hasOwn(table, key)) out[field] = table[key]
		}
	}
	if (t.addDefault) {
		for (const [field, value] of Object.entries(t.addDefault)) {
			if (!Object.hasOwn(out, field)) out[field] = value
		}
	}
	return out
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 23) — refactor when touched, never raise
function retypeValue(field: string, v: unknown, kind: "string" | "number" | "boolean"): string | number | boolean {
	switch (kind) {
		case "string": {
			if (typeof v === "string") return v
			if (typeof v === "number" || typeof v === "boolean") return String(v)
			break
		}
		case "number": {
			if (typeof v === "number" && Number.isFinite(v)) return v
			if (typeof v === "string" && v.trim().length > 0) {
				const n = Number(v)
				if (Number.isFinite(n)) return n
			}
			break
		}
		case "boolean": {
			if (typeof v === "boolean") return v
			if (v === "true" || v === 1) return true
			if (v === "false" || v === 0) return false
			break
		}
	}
	throw new Error(`retype: field "${field}" cannot be converted to ${kind}`)
}

function deepFreeze(value: unknown): void {
	if ((typeof value !== "object" || value === null) && typeof value !== "function") return
	if (Object.isFrozen(value)) return
	Object.freeze(value)
	for (const key of Reflect.ownKeys(value as object)) {
		deepFreeze((value as Record<PropertyKey, unknown>)[key])
	}
}
