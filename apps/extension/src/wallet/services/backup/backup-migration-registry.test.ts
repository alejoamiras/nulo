import { describe, expect, test } from "vitest"
import { BASELINE_VERSION } from "@/wallet/storage/migrations"
import { ACCOUNT_STORAGE_ROOT } from "@/wallet/services/account/spec"
import { AUTH_REGISTRY_ENABLED_STORAGE_ROOT, AUTH_REGISTRY_STORAGE_ROOT } from "@/wallet/services/auth-registry/spec"
import { CONTACT_STORAGE_ROOT } from "@/wallet/services/contact/spec"
import { FPC_STORAGE_ROOT } from "@/wallet/services/fpc/spec"
import { NETWORK_STORAGE_ROOT } from "@/wallet/services/network/spec"
import { PROFILE_STORAGE_ROOT } from "@/wallet/services/profile/repository"
import { TOKEN_BALANCE_STORAGE_ROOT } from "@/wallet/services/token-balance/spec"
import { TOKEN_STORAGE_ROOT } from "@/wallet/services/token/spec"
import { TRANSACTION_STORAGE_ROOT } from "@/wallet/services/transaction/spec"
import { CONFIG_STORAGE_KEY } from "@/wallet/config/store"
import {
	BACKUP_BLOCKED_ROOTS,
	BACKUP_SCHEMA_BASELINE,
	BACKUP_SLICE_REGISTRY,
	CURRENT_COMPAT_EPOCH,
	denormalizeBackupData,
	isSupportedCompatEpoch,
	normalizeBackupData,
} from "./backup-migration-registry"

/** Baseline-shaped fixtures mirroring what each service's `backup()` returns. */
const fixture = () => ({
	profile: { id: "p1", name: "Main", type: "password" },
	account: [
		{ profileId: "p1", chainId: 31337, address: "0xaaa1", name: "Account 1", type: 0 },
		{ profileId: "p1", chainId: 31337, address: "0xaaa2", name: "Account 2", type: 0 },
	],
	network: [{ id: "n1", profileId: "p1", name: "Local", rpcUrl: "http://localhost:8080", chainId: 31337 }],
	token: [{ id: 1, profileId: "p1", chainId: 31337, contract: "0xt0k", name: "Test", symbol: "TST", decimals: 18 }],
	"token-balance": [{ id: 3, token: 1, account: "0xaaa1", publicBalance: "10", updatedAt: 1700000000000 }],
	contact: [{ id: "c1", profileId: "p1", name: "Alice", address: "0xccc", abbr: "A" }],
	transaction: [{ hash: "0xh4sh", account: "0xaaa1", chainId: 31337, status: 1 }],
	fpc: [{ id: "f1", profileId: "p1", chainId: 31337, type: 1, address: "0xfpc", name: "Sponsored" }],
	"auth-registry": [{ id: 7, account: "0xaaa1", hash: "0xmsg", content: { kind: "x" } }],
	config: [
		{ key: "theme", value: "dark" },
		{ key: "developerMode", value: true },
	],
	"account-state": [{ networkId: "n1", senders: [{ address: "0xaaa1" }], contracts: [] }],
})

function normalizeOrThrow(data: unknown) {
	const res = normalizeBackupData(data)
	if (!res.ok) throw new Error(res.reason)
	return res.normalized
}

describe("backup-migration-registry", () => {
	test("full round-trip: denormalize(normalize(data)) === data for every service", () => {
		const data = fixture()
		const normalized = normalizeOrThrow(data)
		const back = denormalizeBackupData(normalized.entries, normalized)
		expect(back).toEqual({ ok: true, data })
	})

	test("normalize writes exact live storage keys (root@id / value key) with JSON-string values", () => {
		const data = fixture()
		const { entries } = normalizeOrThrow(data)
		expect(entries[`${ACCOUNT_STORAGE_ROOT}@0xaaa1`]).toBe(JSON.stringify(data.account[0]))
		// Transaction rows are keyed by `hash`, NOT an `id`.
		expect(entries[`${TRANSACTION_STORAGE_ROOT}@0xh4sh`]).toBe(JSON.stringify(data.transaction[0]))
		// Numeric ids land under their decimal string.
		expect(entries[`${TOKEN_STORAGE_ROOT}@1`]).toBe(JSON.stringify(data.token[0]))
		expect(entries[`${TOKEN_BALANCE_STORAGE_ROOT}@3`]).toBe(JSON.stringify(data["token-balance"][0]))
		expect(entries[`${AUTH_REGISTRY_STORAGE_ROOT}@7`]).toBe(JSON.stringify(data["auth-registry"][0]))
		expect(entries[`${NETWORK_STORAGE_ROOT}@n1`]).toBe(JSON.stringify(data.network[0]))
		expect(entries[`${CONTACT_STORAGE_ROOT}@c1`]).toBe(JSON.stringify(data.contact[0]))
		expect(entries[`${FPC_STORAGE_ROOT}@f1`]).toBe(JSON.stringify(data.fpc[0]))
		expect(entries[CONFIG_STORAGE_KEY]).toBe(JSON.stringify({ theme: "dark", developerMode: true }))
		// Pass-through slices contribute ZERO storage entries.
		const keys = Object.keys(entries)
		expect(keys.some((k) => k.startsWith(`${PROFILE_STORAGE_ROOT}@`))).toBe(false)
		expect(keys).toHaveLength(10)
	})

	test("config toStored preserves an on-disk key absent from the typed Config class and never fabricates defaults", () => {
		// The anticipated key-rename shape: an OLD backup carries the OLD key.
		const data = { ...fixture(), config: [{ key: "legacyTheme", value: "dark" }] }
		const normalized = normalizeOrThrow(data)
		expect(JSON.parse(normalized.entries[CONFIG_STORAGE_KEY])).toEqual({ legacyTheme: "dark" })
		const back = denormalizeBackupData(normalized.entries, normalized)
		if (!back.ok) throw new Error(back.reason)
		expect(back.data.config).toEqual([{ key: "legacyTheme", value: "dark" }])
	})

	test("config toStored preserves a `__proto__` key faithfully and still detects it as a duplicate", () => {
		// On a plain `{}` target, `stored["__proto__"] = …` hits the inherited
		// setter — silently dropping the key AND bypassing the duplicate guard.
		// The null-proto target round-trips it as real data. (Bug hunt.)
		const data = { ...fixture(), config: [{ key: "__proto__", value: { x: 1 } }] }
		const normalized = normalizeOrThrow(data)
		// Assert on the raw JSON string — an object literal `{__proto__: …}` sets
		// the prototype, so `.toEqual` can't express "own __proto__ key".
		expect(normalized.entries[CONFIG_STORAGE_KEY]).toBe('{"__proto__":{"x":1}}')
		const back = denormalizeBackupData(normalized.entries, normalized)
		if (!back.ok) throw new Error(back.reason)
		expect(back.data.config).toEqual([{ key: "__proto__", value: { x: 1 } }])

		const dup = normalizeBackupData({
			...fixture(),
			config: [
				{ key: "__proto__", value: 1 },
				{ key: "__proto__", value: 2 },
			],
		})
		expect(dup.ok).toBe(false)
	})

	test("fpc slice element is the stored row verbatim — no `isProtocol` fabricated anywhere", () => {
		const data = fixture()
		const normalized = normalizeOrThrow(data)
		const storedRow = JSON.parse(normalized.entries[`${FPC_STORAGE_ROOT}@f1`]) as Record<string, unknown>
		expect(storedRow).toEqual(data.fpc[0])
		expect("isProtocol" in storedRow).toBe(false)
	})

	test("missing OPTIONAL slices normalize as empty (no reject, no absentRequired) and stay absent after denormalize", () => {
		const { transaction: _t, "auth-registry": _a, "account-state": _s, ...data } = fixture()
		const normalized = normalizeOrThrow(data)
		expect(normalized.absentRequired).toEqual([])
		const back = denormalizeBackupData(normalized.entries, normalized)
		if (!back.ok) throw new Error(back.reason)
		expect("transaction" in back.data).toBe(false)
		expect("auth-registry" in back.data).toBe(false)
		expect("account-state" in back.data).toBe(false)
	})

	test("missing NON-optional slices are recorded as absentRequired refs (reject is the migrator's call)", () => {
		const { "token-balance": _tb, config: _c, ...data } = fixture()
		const normalized = normalizeOrThrow(data)
		expect(normalized.absentRequired).toEqual([
			{ kind: "root", root: TOKEN_BALANCE_STORAGE_ROOT },
			{ kind: "value", key: CONFIG_STORAGE_KEY },
		])
	})

	test("unknown slice name rejects (fail-closed at the trust boundary)", () => {
		const res = normalizeBackupData({ ...fixture(), "future-service": [] })
		expect(res).toEqual({ ok: false, reason: 'unknown backup slice "future-service"' })
	})

	test.each([
		["non-array slice", { ...fixture(), account: "not-an-array" }],
		["row is not an object", { ...fixture(), account: [42] }],
		["missing id anchor", { ...fixture(), account: [{ profileId: "p1" }] }],
		["mistyped id anchor", { ...fixture(), token: [{ id: "1" }] }],
		["duplicate row id", { ...fixture(), contact: [{ id: "c1" }, { id: "c1" }] }],
		["config element without value", { ...fixture(), config: [{ key: "theme" }] }],
		[
			"config duplicate key",
			{
				...fixture(),
				config: [
					{ key: "theme", value: "dark" },
					{ key: "theme", value: "light" },
				],
			},
		],
		["data not an object", "nope"],
	])("hostile input rejects: %s", (_label, data) => {
		expect(normalizeBackupData(data).ok).toBe(false)
	})

	test("account-state is non-storage and profile is block-listed; blocked roots pinned", () => {
		expect(BACKUP_SLICE_REGISTRY["account-state"]).toEqual({ kind: "non-storage", optional: true })
		expect(BACKUP_SLICE_REGISTRY.profile).toEqual({ kind: "block-listed", root: PROFILE_STORAGE_ROOT })
		expect(BACKUP_BLOCKED_ROOTS).toEqual([PROFILE_STORAGE_ROOT, AUTH_REGISTRY_ENABLED_STORAGE_ROOT])
	})

	test("registry roots + id anchors match each service's own storage contract", () => {
		const rootOf = (name: string) => {
			const d = BACKUP_SLICE_REGISTRY[name]
			if (d.kind !== "root") throw new Error(`${name} is not a root descriptor`)
			return d
		}
		const cases: Array<[string, string, Record<string, unknown>, string]> = [
			["account", ACCOUNT_STORAGE_ROOT, { address: "0xaaa1" }, "0xaaa1"],
			["network", NETWORK_STORAGE_ROOT, { id: "n1" }, "n1"],
			["token", TOKEN_STORAGE_ROOT, { id: 5 }, "5"],
			["token-balance", TOKEN_BALANCE_STORAGE_ROOT, { id: 9 }, "9"],
			["contact", CONTACT_STORAGE_ROOT, { id: "c9" }, "c9"],
			["transaction", TRANSACTION_STORAGE_ROOT, { hash: "0xh" }, "0xh"],
			["fpc", FPC_STORAGE_ROOT, { id: "f9" }, "f9"],
			["auth-registry", AUTH_REGISTRY_STORAGE_ROOT, { id: 2 }, "2"],
		]
		for (const [name, root, row, expected] of cases) {
			const d = rootOf(name)
			expect(d.root, name).toBe(root)
			expect(d.idOf(row), name).toBe(expected)
			// Hostile row: anchor missing → undefined, never a throw.
			expect(d.idOf({}), name).toBeUndefined()
		}
		const config = BACKUP_SLICE_REGISTRY.config
		expect(config.kind === "value-projection" && config.key).toBe(CONFIG_STORAGE_KEY)
	})

	test("denormalize fails closed: unregistered scratch key, mutated id anchor; reserved engine keys are filtered", () => {
		const data = fixture()
		const normalized = normalizeOrThrow(data)

		const alien = denormalizeBackupData({ ...normalized.entries, "nulo:core:evil@x": "{}" }, normalized)
		expect(alien.ok).toBe(false)

		const mutated = {
			...normalized.entries,
			[`${ACCOUNT_STORAGE_ROOT}@0xaaa1`]: JSON.stringify({ ...data.account[0], address: "0xELSEWHERE" }),
		}
		expect(denormalizeBackupData(mutated, normalized).ok).toBe(false)

		const withEngineKeys = { ...normalized.entries, "nulo:schema:version": 1, "nulo:schema:running": 2 }
		expect(denormalizeBackupData(withEngineKeys, normalized)).toEqual({ ok: true, data })
	})

	test("version metadata: epoch gate is fail-closed; baseline shares the live schema number space", () => {
		expect(isSupportedCompatEpoch(CURRENT_COMPAT_EPOCH)).toBe(true)
		for (const bad of [undefined, null, 1, 3, "2", Number.NaN]) expect(isSupportedCompatEpoch(bad)).toBe(false)
		expect(BACKUP_SCHEMA_BASELINE).toBe(BASELINE_VERSION)
	})
})
