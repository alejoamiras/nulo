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
	const rowMaps = def.rowMaps ?? {}
	const valueMaps = def.valueMaps ?? {}
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
	deepFreeze(def)
	backupSafeBrand.add(migration)
	compiledFrom.set(migration, def)
	return migration
}

/** Define-time well-formedness: reject transforms that could be ambiguous or
 *  non-idempotent BEFORE they ever meet data. */
function validateTransform(target: string, t: RowMapTransform): void {
	const fail = (reason: string): never => {
		throw new Error(`row-map transform for "${target}": ${reason}`)
	}
	const fields = (names: Iterable<string>, where: string) => {
		for (const n of names) if (typeof n !== "string" || n.length === 0) fail(`${where} has an empty field name`)
	}
	if (t.rename) {
		fields(Object.keys(t.rename), "rename")
		const targets = new Set<string>()
		for (const [oldName, newName] of Object.entries(t.rename)) {
			if (typeof newName !== "string" || newName.length === 0) fail("rename has an empty target name")
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
}

/** The per-row interpreter. Deterministic, sibling-blind, order-blind: its
 *  ONLY inputs are one row and the frozen transform data. Throws on anything
 *  it cannot transform unambiguously (hostile-input rule: presence-guard
 *  every access, fail closed). Exported for the metamorphic guardrail tests. */
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
