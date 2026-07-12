import { describe, expect, test } from "vitest"
import { defineMigration, Migrator, SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import { MemoryStorageArea } from "@nulo/wallet-core/storage"
import { ACCOUNT_STORAGE_ROOT } from "@/wallet/services/account/spec"
import { CONTACT_STORAGE_ROOT } from "@/wallet/services/contact/spec"
import { PROFILE_STORAGE_ROOT } from "@/wallet/services/profile/repository"
import { migrateBackupData, maxBackupSchemaVersion } from "./backup-migrator"
import { defineRowMapMigration } from "./row-map-migration"

/** The representative real-migration pair used across this suite:
 *  v2 adds a default flag to accounts, v3 renames a contact field. */
const v2 = () =>
	defineRowMapMigration({
		version: 2,
		description: "add default pinned flag to accounts",
		rowMaps: { [ACCOUNT_STORAGE_ROOT]: { addDefault: { pinned: false } } },
	})
const v3 = () =>
	defineRowMapMigration({
		version: 3,
		description: "rename contact legacyName to name",
		rowMaps: { [CONTACT_STORAGE_ROOT]: { rename: { legacyName: "name" } } },
	})

const account = (profileId: string, address: string) => ({ profileId, chainId: 31337, address, type: 0 })
const contact = (profileId: string, id: string, legacyName: string) => ({ id, profileId, address: "0xc", legacyName })

/** A pre-migration (v1-shaped) single-profile backup `data`. */
const v1Data = () => ({
	profile: { id: "p1", name: "Main", type: "password" },
	account: [account("p1", "0xa1"), account("p1", "0xa2")],
	network: [{ id: "n1", profileId: "p1", name: "Local", rpcUrl: "http://localhost:1", chainId: 31337 }],
	token: [{ id: 1, profileId: "p1", chainId: 31337, contract: "0xt" }],
	"token-balance": [{ id: 1, token: 1, account: "0xa1", updatedAt: 1 }],
	contact: [contact("p1", "c1", "Alice")],
	fpc: [{ id: "f1", profileId: "p1", chainId: 31337, type: 1, address: "0xf", name: "Sponsored" }],
	config: [{ key: "theme", value: "dark" }],
})

async function migrateOrThrow(data: unknown, from: number, migrations = [v2(), v3()]) {
	const res = await migrateBackupData({ data, backupSchemaVersion: from, migrations })
	if (res.kind !== "migrated" && res.kind !== "noop") throw new Error(`expected success, got ${res.kind}: ${res.reason}`)
	return res
}

describe("backup-migrator", () => {
	test("superset-vs-projection (H1): a single-profile backup migrates to exactly the live multi-profile run's corresponding subset", async () => {
		const migrations = [v2(), v3()]

		// LIVE superset: two profiles' rows in one store, engine run as boot would.
		const live = new MemoryStorageArea().seed({
			[SCHEMA_VERSION_KEY]: 1,
			[`${ACCOUNT_STORAGE_ROOT}@0xa1`]: JSON.stringify(account("p1", "0xa1")),
			[`${ACCOUNT_STORAGE_ROOT}@0xa2`]: JSON.stringify(account("p1", "0xa2")),
			[`${ACCOUNT_STORAGE_ROOT}@0xb1`]: JSON.stringify(account("p2", "0xb1")),
			[`${CONTACT_STORAGE_ROOT}@c1`]: JSON.stringify(contact("p1", "c1", "Alice")),
			[`${CONTACT_STORAGE_ROOT}@c2`]: JSON.stringify(contact("p2", "c2", "Bob")),
		})
		const liveResult = await new Migrator({ store: live, migrations, baselineVersion: 1 }).run()
		expect(liveResult.kind).toBe("migrated")

		// BACKUP projection: only p1's slices.
		const res = await migrateOrThrow(v1Data(), 1, migrations)

		const liveRow = (key: string) => JSON.parse(live.data.get(key) as string)
		expect(res.data.account).toEqual([liveRow(`${ACCOUNT_STORAGE_ROOT}@0xa1`), liveRow(`${ACCOUNT_STORAGE_ROOT}@0xa2`)])
		expect(res.data.contact).toEqual([liveRow(`${CONTACT_STORAGE_ROOT}@c1`)])
		// Cardinality + anchors preserved 1:1 with the source slices.
		expect((res.data.account as unknown[]).length).toBe(2)
		expect((res.data.contact as Array<{ id: string; name: string }>)[0]).toMatchObject({ id: "c1", name: "Alice" })
	})

	test("migrated output: transforms applied, untouched slices byte-equal, reserved engine keys never leak", async () => {
		const data = v1Data()
		const res = await migrateOrThrow(data, 1)
		expect(res.kind).toBe("migrated")
		expect(res.data.account).toEqual(data.account.map((a) => ({ ...a, pinned: false })))
		expect(res.data.contact).toEqual([{ id: "c1", profileId: "p1", address: "0xc", name: "Alice" }])
		for (const slice of ["network", "token", "token-balance", "fpc", "config", "profile"] as const) {
			expect(res.data[slice], slice).toEqual(data[slice])
		}
		expect(JSON.stringify(res.data)).not.toContain("nulo:schema:")
	})

	test("run-twice: migrating the migrated output at the new version is a byte-identical noop", async () => {
		const first = await migrateOrThrow(v1Data(), 1)
		const second = await migrateOrThrow(first.data, 3)
		expect(second.kind).toBe("noop")
		expect(second.data).toEqual(first.data)
	})

	test("noop path still validates: a current-version backup with an unknown slice rejects", async () => {
		const res = await migrateBackupData({
			data: { ...v1Data(), mystery: [] },
			backupSchemaVersion: 3,
			migrations: [v2(), v3()],
		})
		expect(res).toEqual({ kind: "failed", reason: 'unknown backup slice "mystery"' })
	})

	test("missing OPTIONAL slices (transaction/auth-registry/account-state, the network-less export) migrate fine and stay absent", async () => {
		const res = await migrateOrThrow(v1Data(), 1)
		expect("transaction" in res.data).toBe(false)
		expect("auth-registry" in res.data).toBe(false)
		expect("account-state" in res.data).toBe(false)
	})

	test("missing REQUIRED slice that a pending migration reads rejects", async () => {
		const { account: _a, ...data } = v1Data()
		const res = await migrateBackupData({ data, backupSchemaVersion: 1, migrations: [v2(), v3()] })
		expect(res.kind).toBe("failed")
		if (res.kind === "failed") expect(res.reason).toContain("missing a required slice")
	})

	test("malformed row rejects before any migration runs", async () => {
		const res = await migrateBackupData({
			data: { ...v1Data(), account: [{ profileId: "p1" }] },
			backupSchemaVersion: 1,
			migrations: [v2(), v3()],
		})
		expect(res.kind).toBe("failed")
	})

	test("a migration failure rejects the import — breaking AND non-breaking alike (zero live state involved)", async () => {
		for (const breaking of [true, false]) {
			const hostile = defineRowMapMigration({
				version: 2,
				description: "retype chainId to number",
				breaking,
				rowMaps: { [ACCOUNT_STORAGE_ROOT]: { retype: { chainId: "number" } } },
			})
			const data = { ...v1Data(), account: [{ ...account("p1", "0xa1"), chainId: { nested: true } }] }
			const res = await migrateBackupData({ data, backupSchemaVersion: 1, migrations: [hostile] })
			expect(res.kind, `breaking=${breaking}`).toBe("failed")
		}
	})

	test("an imperative (non-backup-safe) migration in range blocks import with the re-export message", async () => {
		const imperative = defineMigration({
			version: 2,
			description: "imperative transform",
			reads: [{ kind: "root", root: ACCOUNT_STORAGE_ROOT }],
			writes: [{ kind: "root", root: ACCOUNT_STORAGE_ROOT }],
			up: async () => {},
		})
		const res = await migrateBackupData({ data: v1Data(), backupSchemaVersion: 1, migrations: [imperative] })
		expect(res.kind).toBe("incompatible")
		if (res.kind === "incompatible") expect(res.reason).toContain("re-export")
	})

	test("a migration touching a block-listed or unmapped root blocks import", async () => {
		const touchesProfiles = defineRowMapMigration({
			version: 2,
			description: "touches profiles",
			rowMaps: { [PROFILE_STORAGE_ROOT]: { addDefault: { x: 1 } } },
		})
		const blocked = await migrateBackupData({ data: v1Data(), backupSchemaVersion: 1, migrations: [touchesProfiles] })
		expect(blocked.kind).toBe("incompatible")

		const touchesUnmapped = defineRowMapMigration({
			version: 2,
			description: "touches an unmapped root",
			rowMaps: { "nulo:core:elsewhere": { addDefault: { x: 1 } } },
		})
		const unmapped = await migrateBackupData({ data: v1Data(), backupSchemaVersion: 1, migrations: [touchesUnmapped] })
		expect(unmapped.kind).toBe("incompatible")
	})

	test("version guards: newer-than-build is incompatible; non-integer/below-baseline is failed", async () => {
		expect(maxBackupSchemaVersion([v2(), v3()])).toBe(3)
		const newer = await migrateBackupData({ data: v1Data(), backupSchemaVersion: 4, migrations: [v2(), v3()] })
		expect(newer.kind).toBe("incompatible")
		for (const bad of [0, -1, 1.5, "1", undefined, null]) {
			const res = await migrateBackupData({ data: v1Data(), backupSchemaVersion: bad, migrations: [v2(), v3()] })
			expect(res.kind, JSON.stringify(bad)).toBe("failed")
		}
	})

	test("config value transform: a key-rename migration sees the REAL old shape and renames only present keys", async () => {
		const renameConfigKey = defineRowMapMigration({
			version: 2,
			description: "rename config legacyTheme to theme",
			valueMaps: { "nulo:config": { rename: { legacyTheme: "theme" } } },
		})
		const data = { ...v1Data(), config: [{ key: "legacyTheme", value: "dark" }] }
		const res = await migrateBackupData({ data, backupSchemaVersion: 1, migrations: [renameConfigKey] })
		if (res.kind !== "migrated") throw new Error(`expected migrated, got ${res.kind}`)
		expect(res.data.config).toEqual([{ key: "theme", value: "dark" }])

		// Absence-preserving: a backup with NO config slice migrates without one
		// being fabricated (the migration reads a required-but-absent value → reject).
		const { config: _c, ...noConfig } = v1Data()
		const rejected = await migrateBackupData({ data: noConfig, backupSchemaVersion: 1, migrations: [renameConfigKey] })
		expect(rejected.kind).toBe("failed")
	})
})
