/**
 * Pre-extraction characterization pins for the migration core's REJECT ORACLE:
 * the exact reason/message string of every branch the decomposition moves
 * (validateTransform via the public factory; normalize/denormalize;
 * preflight via migrateBackupData's test seam). The strings are the
 * fail-closed contract — byte drift here is a behavior change.
 */
import { describe, expect, test } from "vitest"
import { defineMigration } from "@nulo/wallet-core/migration"
import { ACCOUNT_STORAGE_ROOT } from "@/wallet/services/account/spec"
import { CONTACT_STORAGE_ROOT } from "@/wallet/services/contact/spec"
import { PROFILE_STORAGE_ROOT } from "@/wallet/services/profile/repository"
import { denormalizeBackupData, normalizeBackupData } from "./backup-migration-registry"
import { migrateBackupData } from "./backup-migrator"
import { defineRowMapMigration } from "./row-map-migration"

const rowMap = (version: number, t: object) =>
	defineRowMapMigration({
		version,
		description: "pin",
		rowMaps: { [CONTACT_STORAGE_ROOT]: t },
	})

describe("validateTransform reject oracle (via defineRowMapMigration)", () => {
	const cases: Array<[string, object, string]> = [
		["empty field name", { drop: [""] }, 'row-map transform for "nulo:core:contacts": drop has an empty field name'],
		["__proto__ field", { drop: ["__proto__"] }, 'row-map transform for "nulo:core:contacts": drop targets "__proto__"'],
		["empty rename target", { rename: { a: "" } }, 'row-map transform for "nulo:core:contacts": rename has an empty target name'],
		[
			"__proto__ rename target",
			{ rename: { a: "__proto__" } },
			'row-map transform for "nulo:core:contacts": rename targets "__proto__"',
		],
		["self rename", { rename: { a: "a" } }, 'row-map transform for "nulo:core:contacts": rename maps "a" onto itself'],
		[
			"two-onto-one rename",
			{ rename: { a: "c", b: "c" } },
			'row-map transform for "nulo:core:contacts": rename maps two fields onto "c"',
		],
		[
			"chained rename",
			{ rename: { a: "b", b: "c" } },
			'row-map transform for "nulo:core:contacts": rename chains through "b" (non-idempotent)',
		],
		[
			"chained remap",
			{ remapValues: { f: { x: "y", y: "z" } } },
			'row-map transform for "nulo:core:contacts": remapValues for "f" chains "x" → "y" → … (non-idempotent)',
		],
		[
			"addDefault ∩ retype",
			{ addDefault: { f: 1 }, retype: { f: "number" } },
			'row-map transform for "nulo:core:contacts": addDefault "f" is also retyped — a re-run would coerce the default (non-idempotent)',
		],
		[
			"addDefault ∩ remapValues",
			{ addDefault: { f: "a" }, remapValues: { f: { a: "b" } } },
			'row-map transform for "nulo:core:contacts": addDefault "f" is also remapped — a re-run would remap the default (non-idempotent)',
		],
		[
			"addDefault ∩ rename source",
			{ addDefault: { f: 1 }, rename: { f: "g" } },
			'row-map transform for "nulo:core:contacts": addDefault "f" re-creates a rename source — a re-run would re-trigger the rename (non-idempotent)',
		],
	]
	for (const [name, transform, message] of cases) {
		test(name, () => {
			expect(() => rowMap(9, transform)).toThrowError(message)
		})
	}

	test("primitive-field and empty-migration guards", () => {
		expect(() => defineRowMapMigration({ version: "9" as unknown as number, description: "x", rowMaps: {} })).toThrowError(
			"row-map migration version/description/breaking must be primitives",
		)
		expect(() => defineRowMapMigration({ version: 9, description: "x" })).toThrowError("row-map migration transforms nothing")
	})
})

describe("normalizeBackupData reject oracle", () => {
	const reason = (data: unknown): string => {
		const res = normalizeBackupData(data)
		if (res.ok) throw new Error("expected reject")
		return res.reason
	}

	test("non-object data", () => {
		expect(reason([])).toBe("backup data is not an object")
	})
	test("unknown slice", () => {
		expect(reason({ mystery: [] })).toBe('unknown backup slice "mystery"')
	})
	test("non-array root slice", () => {
		expect(reason({ contact: {} })).toBe('slice "contact" is not an array')
	})
	test("non-object row", () => {
		expect(reason({ contact: [42] })).toBe('slice "contact" row 0 is not an object')
	})
	test("missing row id", () => {
		expect(reason({ contact: [{ name: "no-id" }] })).toBe('slice "contact" row 0 has a missing or malformed id')
	})
	test("duplicate row id", () => {
		const row = { id: "c1", profileId: "p1", address: "0xc", name: "A" }
		expect(reason({ contact: [row, { ...row }] })).toBe('slice "contact" has a duplicate row id "c1"')
	})
	test("non-array value-projection slice", () => {
		expect(reason({ config: {} })).toBe('slice "config" is not an array')
	})
})

describe("denormalizeBackupData reject oracle", () => {
	const ctx = { passThrough: {}, present: new Set<string>() }
	const reason = (entries: Record<string, unknown>): string => {
		const res = denormalizeBackupData(entries, ctx)
		if (res.ok) throw new Error("expected reject")
		return res.reason
	}

	test("key outside every root", () => {
		expect(reason({ "rogue:key": "{}" })).toBe('scratch store holds a key outside every registered root: "rogue:key"')
	})
	test("non-string scratch value", () => {
		expect(reason({ [`${CONTACT_STORAGE_ROOT}@c1`]: 42 })).toBe(
			`scratch value for "${CONTACT_STORAGE_ROOT}@c1" is not a serialized string`,
		)
	})
	test("invalid JSON scratch value", () => {
		expect(reason({ [`${CONTACT_STORAGE_ROOT}@c1`]: "{nope" })).toBe(`scratch value for "${CONTACT_STORAGE_ROOT}@c1" is not valid JSON`)
	})
	test("non-object scratch row", () => {
		expect(reason({ [`${CONTACT_STORAGE_ROOT}@c1`]: "[1]" })).toBe(`scratch row "${CONTACT_STORAGE_ROOT}@c1" is not an object`)
	})
	test("id-anchor mismatch", () => {
		expect(reason({ [`${CONTACT_STORAGE_ROOT}@c1`]: JSON.stringify({ id: "c2" }) })).toBe(
			`scratch row "${CONTACT_STORAGE_ROOT}@c1" no longer matches its id anchor (got "c2")`,
		)
	})
	test("vanished value slice", () => {
		const res = denormalizeBackupData({}, { passThrough: {}, present: new Set(["config"]) })
		expect(res).toEqual({ ok: false, reason: 'slice "config" vanished from the scratch store' })
	})
})

describe("preflight reject oracle (via migrateBackupData's migrations seam)", () => {
	const data = () => ({ contact: [{ id: "c1", profileId: "p1", address: "0xc", name: "A" }] })
	const run = async (migration: unknown) => {
		const res = await migrateBackupData({
			data: data(),
			backupSchemaVersion: 1,
			migrations: [migration as never],
		})
		if (res.kind !== "incompatible" && res.kind !== "failed") throw new Error(`expected reject, got ${res.kind}`)
		return res
	}

	test("imperative migration in range → incompatible with re-export guidance", async () => {
		const imperative = defineMigration({
			version: 2,
			description: "imperative",
			reads: [{ kind: "root", root: CONTACT_STORAGE_ROOT }],
			writes: [{ kind: "root", root: CONTACT_STORAGE_ROOT }],
			up: async () => {},
		})
		const res = await run(imperative)
		expect(res).toEqual({
			kind: "incompatible",
			reason: "this wallet version can't upgrade old backups: migration 2 is not backup-safe — re-export a fresh backup from a current wallet",
		})
	})

	test("block-listed root → incompatible naming the root", async () => {
		const res = await run(
			defineRowMapMigration({
				version: 2,
				description: "touches profiles",
				rowMaps: { [PROFILE_STORAGE_ROOT]: { addDefault: { x: 1 } } },
			}),
		)
		expect(res).toEqual({
			kind: "incompatible",
			reason: `migration 2 touches "${PROFILE_STORAGE_ROOT}", which backups cannot represent — re-export a fresh backup from a current wallet`,
		})
	})

	test("registry-uncovered root → incompatible naming the target", async () => {
		const res = await run(
			defineRowMapMigration({
				version: 2,
				description: "unmapped root",
				rowMaps: { "nulo:mystery": { addDefault: { x: 1 } } },
			}),
		)
		expect(res).toEqual({
			kind: "incompatible",
			reason: 'migration 2 touches "nulo:mystery", which no backup slice maps to',
		})
	})

	test("read of an absent non-optional slice → failed naming root + version", async () => {
		const res = await run(
			defineRowMapMigration({
				version: 2,
				description: "reads absent accounts",
				rowMaps: { [ACCOUNT_STORAGE_ROOT]: { addDefault: { pinned: false } } },
			}),
		)
		expect(res).toEqual({
			kind: "failed",
			reason: `backup is missing a required slice for "${ACCOUNT_STORAGE_ROOT}" that migration 2 reads`,
		})
	})
})
