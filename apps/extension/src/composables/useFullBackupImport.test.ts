/**
 * Unit coverage for the full-backup-import composable.
 *
 * Mocks every backup-service client so we can drive `restoreBackup` through
 * its branches: schema/checksum guards, success, no-networks fail, the
 * duplicate-address fix (post-A11: matches on err.message instead of the
 * dead `err === string` check), non-duplicate failure re-throw,
 * `finalizeRestore` failure, partial-errors path, and the success-without-
 * errors path that triggers `completeImport` automatically.
 *
 * Notes on test mechanics:
 *
 *  - Service clients are constructed via `new ServiceClient()` inside the
 *    composable, so each module is mocked at the import level to return a
 *    shared spy instance the test can configure per-case.
 *  - Pinia stores `useCacheStore` / `usePopupStore` are accessed via
 *    `createTestingPinia()`. The composable only writes to them inside
 *    `showRestoreErrorLog` (not exercised here) so a no-op pinia is fine.
 *  - Checksum match uses the real `EncryptionKey.getHashHex` over the
 *    test's backup object so we hit the integrity branch only when we
 *    intentionally corrupt it.
 */
import { setActivePinia } from "pinia"
import { createTestingPinia } from "@pinia/testing"
import { ref } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { asBase64CredentialId, asBase64SecretPrf, asHexUserHandle, EncryptionKey } from "@nulo/wallet-crypto"
import { UserRejectedError } from "@nulo/extension-messaging/errors"

// ── Mocks ───────────────────────────────────────────────────────────────────

const profileClient = {
	restore: vi.fn(),
	finalizeRestore: vi.fn(),
	deleteProfile: vi.fn(),
	disconnect: vi.fn(),
}
const networkClient = {
	restore: vi.fn(),
	disconnect: vi.fn(),
}
const accountClient = {
	restore: vi.fn(),
	disconnect: vi.fn(),
}
const tokenClient = {
	restore: vi.fn(),
	disconnect: vi.fn(),
}
function passthroughClient() {
	return { restore: vi.fn(async () => []), disconnect: vi.fn() }
}
let transactionClient = passthroughClient()
let tokenBalanceClient = passthroughClient()
let accountStateClient = passthroughClient()
let authRegistryClient = passthroughClient()
let fpcClient = passthroughClient()
let contactClient = passthroughClient()
let configClient = passthroughClient()

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Arrow factories error: "() => ... is not a constructor".
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return profileClient
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return networkClient
	}),
}))
vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: vi.fn(function () {
		return accountClient
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return tokenClient
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return transactionClient
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return tokenBalanceClient
	}),
}))
vi.mock("@/wallet/services/account-state/client", () => ({
	AccountStateServiceClient: vi.fn(function () {
		return accountStateClient
	}),
}))
vi.mock("@/wallet/services/auth-registry/client", () => ({
	AuthRegistryServiceClient: vi.fn(function () {
		return authRegistryClient
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return fpcClient
	}),
}))
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(function () {
		return contactClient
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return configClient
	}),
}))

// Service-name modules pull in side-effecting validators when imported
// from the real client modules, so re-export the bare name constants (plus
// the storage-root constants the backup-migration registry imports).
vi.mock("@/wallet/services/account/spec", () => ({ ACCOUNT_SERVICE_NAME: "account", ACCOUNT_STORAGE_ROOT: "nulo:core:accounts" }))
vi.mock("@/wallet/services/account-state/spec", () => ({ ACCOUNT_STATE_SERVICE_NAME: "account-state" }))
vi.mock("@/wallet/services/auth-registry/spec", () => ({
	AUTH_REGISTRY_SERVICE_NAME: "auth-registry",
	AUTH_REGISTRY_STORAGE_ROOT: "nulo:core:auth-registry",
	AUTH_REGISTRY_ENABLED_STORAGE_ROOT: "nulo:core:auth-registry-enabled",
}))
vi.mock("@/wallet/services/config/spec", () => ({ CONFIG_SERVICE_NAME: "config" }))
vi.mock("@/wallet/services/contact/spec", () => ({ CONTACT_SERVICE_NAME: "contact", CONTACT_STORAGE_ROOT: "nulo:core:contacts" }))
vi.mock("@/wallet/services/fpc/spec", () => ({ FPC_SERVICE_NAME: "fpc", FPC_STORAGE_ROOT: "nulo:core:fpcs" }))
vi.mock("@/wallet/services/network/spec", () => ({ NETWORK_SERVICE_NAME: "network", NETWORK_STORAGE_ROOT: "nulo:core:networks" }))
vi.mock("@/wallet/services/token-balance/spec", () => ({
	TOKEN_BALANCE_SERVICE_NAME: "token-balance",
	TOKEN_BALANCE_STORAGE_ROOT: "nulo:core:token-balances",
}))
vi.mock("@/wallet/services/token/spec", () => ({ TOKEN_SERVICE_NAME: "token", TOKEN_STORAGE_ROOT: "nulo:core:tokens" }))
vi.mock("@/wallet/services/transaction/spec", () => ({
	TRANSACTION_SERVICE_NAME: "transaction",
	TRANSACTION_STORAGE_ROOT: "nulo:core:txs",
}))

// A REAL pending backup-safe migration (v2, contact legacyName → name) so the
// suite exercises the full migrate-then-restore path: `buildBackup` stamps
// `backup-schema-version: 1`, so every restore in this file migrates 1 → 2
// before any service restore runs.
vi.mock("@/wallet/storage/migrations", async () => {
	const { defineRowMapMigration } = await vi.importActual<typeof import("@/wallet/services/backup/row-map-migration")>(
		"@/wallet/services/backup/row-map-migration",
	)
	const v2 = defineRowMapMigration({
		version: 2,
		description: "test: rename contact legacyName to name",
		rowMaps: { "nulo:core:contacts": { rename: { legacyName: "name" } } },
	})
	return { BASELINE_VERSION: 1, realMigrations: [], migrations: [], backupMigrations: [v2] }
})

// Imported AFTER mocks are registered.
import { useFullBackupImport } from "./useFullBackupImport"

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a backup payload + matching checksum so the integrity guard passes.
 *  `overrides.data` MERGES over the default slices (it must not clobber them:
 *  the mocked v2 migration reads contacts, so the default `contact: []` has to
 *  survive every override). */
async function buildBackup(overrides: Record<string, unknown> = {}) {
	const { data: dataOverride, ...bodyOverrides } = overrides
	const body = {
		"compat-epoch": 2,
		"backup-schema-version": 1,
		"master-key": Buffer.from(new Uint8Array(32)).toString("base64"),
		data: {
			profile: { id: "src-profile-id", name: "Imported", type: "password" },
			// P6: schema-realistic default fixtures (new-shape network with
			// endpoints[]; schema-complete account) so the default path mirrors
			// what the real services accept + the #220 read-codecs validate.
			network: [
				{
					id: "src-net-1",
					profileId: "src-profile-id",
					name: "Testnet",
					rpcUrl: "https://t/",
					chainId: 1,
					kind: "custom",
					endpoints: [{ id: "src-ep-1", rpcUrl: "https://t/" }],
					primaryEndpointId: "src-ep-1",
				},
			],
			account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa", index: 0, type: 0, name: "Account 1", visible: true }],
			token: [],
			// Present-but-empty: the mocked v2 migration READS contacts, and a
			// missing non-optional slice a pending migration reads rejects.
			contact: [],
			...((dataOverride as Record<string, unknown>) ?? {}),
		},
		...bodyOverrides,
	}
	const checksum = await EncryptionKey.getHashHex(JSON.stringify(body))
	return { ...body, checksum }
}

interface MakeOpts {
	password?: string
	repeatedPassword?: string
}
function makeOpts(o: MakeOpts = {}) {
	const password = ref(o.password ?? "pass1234")
	const repeatedPassword = ref(o.repeatedPassword ?? "pass1234")
	const fillError = vi.fn()
	const clearError = vi.fn()
	const pickFile = vi.fn()
	const completeImport = vi.fn()
	return { password, repeatedPassword, fillError, clearError, pickFile, completeImport }
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }))
	profileClient.restore.mockReset()
	profileClient.finalizeRestore.mockReset().mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
	profileClient.deleteProfile.mockReset().mockResolvedValue(undefined)
	profileClient.disconnect.mockReset()
	networkClient.restore.mockReset()
	networkClient.disconnect.mockReset()
	accountClient.restore.mockReset()
	accountClient.disconnect.mockReset()
	tokenClient.restore.mockReset().mockResolvedValue([])
	tokenClient.disconnect.mockReset()
	transactionClient = passthroughClient()
	tokenBalanceClient = passthroughClient()
	accountStateClient = passthroughClient()
	authRegistryClient = passthroughClient()
	fpcClient = passthroughClient()
	contactClient = passthroughClient()
	configClient = passthroughClient()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useFullBackupImport — isAllowedToImportBackup", () => {
	it("returns false when no backup is selected", () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		expect(c.isAllowedToImportBackup.value).toBe(false)
	})

	it("returns false for a password backup with a short password", async () => {
		const opts = makeOpts({ password: "short", repeatedPassword: "short" })
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: {}, type: "plain", profileType: "password" }
		expect(c.isAllowedToImportBackup.value).toBe(false)
	})

	it("returns false when the new password and repeat don't match", () => {
		const opts = makeOpts({ password: "longenough", repeatedPassword: "mismatch12" })
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: {}, type: "plain", profileType: "password" }
		expect(c.isAllowedToImportBackup.value).toBe(false)
	})

	it("returns true when password matches and is ≥8 chars", () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: {}, type: "plain", profileType: "password" }
		expect(c.isAllowedToImportBackup.value).toBe(true)
	})

	it("bypasses the password rule for passkey-typed backups", () => {
		const opts = makeOpts({ password: "", repeatedPassword: "" })
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: {}, type: "plain", profileType: "passkey" }
		expect(c.isAllowedToImportBackup.value).toBe(true)
	})
})

describe("useFullBackupImport — restoreBackup happy path", () => {
	it("calls restore + finalizeRestore + completeImport on clean success", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		expect(profileClient.restore).toHaveBeenCalledOnce()
		expect(profileClient.finalizeRestore).toHaveBeenCalledWith("new-id", "pass1234")
		expect(opts.completeImport).toHaveBeenCalledOnce()
		expect(c.restoreStatus.value).toBe("finished")
		expect(c.isRestoreHasErrors.value).toBe(false)
		expect(profileClient.disconnect).toHaveBeenCalled()
		expect(networkClient.disconnect).toHaveBeenCalled()
	})

	it("does NOT auto-call completeImport when partial errors exist (Continue button shows)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		// One network failed → recorded as error → isRestoreHasErrors=true
		networkClient.restore.mockResolvedValue([
			{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 },
			{ id: "src-net-2", name: "Devnet", rpcUrl: "https://d/", chainId: 2, restoreError: "rpc unreachable" },
		])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("finished")
		expect(c.isRestoreHasErrors.value).toBe(true)
		expect(c.importedProfile.value).toEqual({ id: "new-id", name: "Imported", type: "password" })
		expect(opts.completeImport).not.toHaveBeenCalled()
	})
})

describe("useFullBackupImport — guards before any writes", () => {
	async function expectRejected(backup: unknown, title: string, opts = makeOpts()) {
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		await c.restoreBackup()
		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", title, expect.any(String))
		expect(profileClient.restore).not.toHaveBeenCalled()
	}

	it("rejects an unsupported compat-epoch", async () => {
		await expectRejected(await buildBackup({ "compat-epoch": 3 }), "Incompatible backup")
	})

	it("rejects a pre-baseline blob (legacy schema-version only, no new fields) with the re-export copy", async () => {
		const legacy = await buildBackup({ "compat-epoch": undefined, "backup-schema-version": undefined, "schema-version": 2 })
		await expectRejected(legacy, "Incompatible backup")
	})

	it("rejects a missing or malformed backup-schema-version", async () => {
		for (const bad of [undefined, 0, -1, 1.5, "1"]) {
			profileClient.restore.mockClear()
			await expectRejected(await buildBackup({ "backup-schema-version": bad }), "Incompatible backup")
		}
	})

	it("rejects a backup-schema-version newer than this build", async () => {
		await expectRejected(await buildBackup({ "backup-schema-version": 999 }), "Backup is too new")
	})

	it("rejects a tampered checksum", async () => {
		const backup = await buildBackup()
		;(backup as { checksum: string }).checksum = "deadbeef"
		await expectRejected(backup, "Backup Integrity Check Failed")
	})

	it("verifies the checksum BEFORE any version field is interpreted", async () => {
		// Bad epoch AND bad checksum: the integrity error must win — the
		// trust-gate order is checksum → epoch → schema-version.
		const backup = await buildBackup({ "compat-epoch": 3 })
		;(backup as { checksum: string }).checksum = "deadbeef"
		await expectRejected(backup, "Backup Integrity Check Failed")
	})

	it("a migration failure aborts BEFORE any restore() call — zero-rollback atomicity", async () => {
		// An unknown slice fails the migrator's trust-boundary validation; the
		// import must reject with profileService.restore never invoked (nothing
		// touched live storage, so there is nothing to roll back).
		const backup = await buildBackup({ data: { mystery: [] } })
		await expectRejected(backup, "Import failed")
	})
})

describe("useFullBackupImport — backup migration wiring", () => {
	it("a v1 backup migrates forward and services restore CURRENT-shape slices", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: { contact: [{ id: "c1", profileId: "src-profile-id", address: "0xc", legacyName: "Ali" }] },
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("finished")
		// The v2 migration renamed legacyName → name before the restore ran.
		expect(contactClient.restore).toHaveBeenCalledWith([{ id: "c1", profileId: "new-id", address: "0xc", name: "Ali" }])
	})
})

describe("useFullBackupImport — tx-restore provenance filter (P1)", () => {
	it("drops-and-records a tx whose account was NOT imported by this restore", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ address: "0xMINE" }],
				transaction: [
					{ hash: "h1", account: "0xMINE", chainId: 1 },
					{ hash: "h2", account: "0xFOREIGN", chainId: 1 },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xMINE" }])

		await c.restoreBackup()

		// Only the imported-account tx reaches restore; the foreign one is dropped
		// BEFORE it can be written (it would otherwise surface in another profile's
		// activity and never be purged after the subscriber removal).
		expect(transactionClient.restore).toHaveBeenCalledWith([{ hash: "h1", account: "0xMINE", chainId: 1 }])
		// The drop is recorded, not silent.
		expect(c.restoreErrorLog.value.transaction).toEqual([
			{ hash: "h2", account: "0xFOREIGN", chainId: 1, restoreError: expect.stringContaining("not imported") },
		])
	})

	it("keeps every tx when all accounts were imported (no false drops)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ address: "0xA" }, { address: "0xB" }],
				transaction: [
					{ hash: "h1", account: "0xA", chainId: 1 },
					{ hash: "h2", account: "0xB", chainId: 1 },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xA" }, { address: "0xB" }])

		await c.restoreBackup()

		expect(transactionClient.restore).toHaveBeenCalledWith([
			{ hash: "h1", account: "0xA", chainId: 1 },
			{ hash: "h2", account: "0xB", chainId: 1 },
		])
		expect(c.restoreErrorLog.value.transaction).toBeUndefined()
	})

	it("drops a tx whose account FAILED to import (allow-set is SUCCESSFUL accounts only)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ address: "0xOK" }, { address: "0xBAD" }],
				transaction: [{ hash: "h1", account: "0xBAD", chainId: 1 }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xOK" }, { address: "0xBAD", restoreError: "boom" }])

		await c.restoreBackup()

		expect(transactionClient.restore).toHaveBeenCalledWith([])
		expect(c.restoreErrorLog.value.transaction).toHaveLength(1)
	})
})

describe("useFullBackupImport — network index-pairing (P2)", () => {
	it("remaps each network's child rows to ITS new id by index — never cross-grafts", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				network: [
					{ id: "N1", name: "A", chainId: 1 },
					{ id: "N2", name: "B", chainId: 2 },
				],
				"account-state": [
					{ networkId: "N1", contracts: [], senders: [] },
					{ networkId: "N2", contracts: [], senders: [] },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		// Both ids collide on restore → new ids, index i ↔ data.network[i].
		networkClient.restore.mockResolvedValue([
			{ id: "M1", name: "A", chainId: 1 },
			{ id: "M2", name: "B", chainId: 2 },
		])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		expect(accountStateClient.restore).toHaveBeenCalledWith(
			[
				{ networkId: "M1", contracts: [], senders: [] },
				{ networkId: "M2", contracts: [], senders: [] },
			],
			expect.anything(),
		)
	})

	it("is unforgeable: a FAILED net A + valid net B sharing name+chainId does NOT graft B's rows onto A", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				network: [
					{ id: "NA", name: "Same", chainId: 7 },
					{ id: "NB", name: "Same", chainId: 7 },
				],
				"account-state": [
					{ networkId: "NA", contracts: [], senders: [] },
					{ networkId: "NB", contracts: [], senders: [] },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		// index 0 (NA) FAILED (raw fields spread back); index 1 (NB) succeeded with a new id.
		networkClient.restore.mockResolvedValue([
			{ id: "NA", name: "Same", chainId: 7, restoreError: "boom" },
			{ id: "MB", name: "Same", chainId: 7 },
		])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		// NB's row → MB (index-paired); NA's row untouched (NA failed → no remap),
		// NOT grafted to MB. A field-match would have paired MB with NA here.
		expect(accountStateClient.restore).toHaveBeenCalledWith(
			[
				{ networkId: "NA", contracts: [], senders: [] },
				{ networkId: "MB", contracts: [], senders: [] },
			],
			expect.anything(),
		)
	})
})

describe("useFullBackupImport — token-balance (chainId,contract) key (P3)", () => {
	it("keeps same-contract tokens on different chains distinct (no balance collapse)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				token: [
					{ id: 1, chainId: 1, contract: "0xT" },
					{ id: 2, chainId: 2, contract: "0xT" },
				],
				"token-balance": [
					{ id: 10, token: 1, account: "0xa" },
					{ id: 11, token: 2, account: "0xa" },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])
		tokenClient.restore.mockResolvedValue([
			{ id: "n1", chainId: 1, contract: "0xT" },
			{ id: "n2", chainId: 2, contract: "0xT" },
		])

		await c.restoreBackup()

		// Balance for old token 1 (chain 1) → n1; for old token 2 (chain 2) → n2.
		// A contract-only key would collapse both onto the last (n2).
		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([
			{ id: 10, token: "n1", account: "0xa" },
			{ id: 11, token: "n2", account: "0xa" },
		])
	})

	it("skips-and-records a balance whose old token key is ambiguous (duplicate (chainId,contract))", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				token: [
					{ id: 1, chainId: 1, contract: "0xDUP" },
					{ id: 2, chainId: 1, contract: "0xDUP" },
				],
				"token-balance": [{ id: 10, token: 1, account: "0xa" }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])
		// Both restore to the SAME (chainId, contract) → ambiguous → skip-and-record.
		tokenClient.restore.mockResolvedValue([
			{ id: "n1", chainId: 1, contract: "0xDUP" },
			{ id: "n2", chainId: 1, contract: "0xDUP" },
		])

		await c.restoreBackup()

		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([])
		expect(c.restoreErrorLog.value["token-balance"]).toHaveLength(1)
	})
})

describe("useFullBackupImport — completeImport + client hygiene (P7)", () => {
	it("a rejected completeImport keeps status 'finished' and does NOT roll back", async () => {
		const opts = makeOpts()
		opts.completeImport = vi.fn().mockRejectedValue(new Error("handshake failed"))
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		// The import genuinely succeeded — a failed handshake must not undo it.
		expect(c.restoreStatus.value).toBe("finished")
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(opts.fillError).not.toHaveBeenCalledWith("full_backup", "Import failed", expect.anything())
	})

	it("disconnects EVERY backup-service client even when a mid-loop restore throws", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])
		// TRANSACTION is the FIRST client in the backup-services loop; make it throw.
		transactionClient.restore = vi.fn().mockRejectedValue(new Error("kaboom"))

		await c.restoreBackup()

		// The whole-loop finally must disconnect every constructed client — the
		// one that threw AND all the ones after it that never ran.
		expect(transactionClient.disconnect).toHaveBeenCalled()
		expect(tokenBalanceClient.disconnect).toHaveBeenCalled()
		expect(accountStateClient.disconnect).toHaveBeenCalled()
		expect(authRegistryClient.disconnect).toHaveBeenCalled()
		expect(fpcClient.disconnect).toHaveBeenCalled()
		expect(contactClient.disconnect).toHaveBeenCalled()
		expect(configClient.disconnect).toHaveBeenCalled()
	})
})

describe("useFullBackupImport — failure branches", () => {
	it("surfaces restoreError when ProfileService.restore returns one", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "src-profile-id", name: "Imported", type: "password", restoreError: "seal failed" })

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Import failed", "seal failed")
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
	})

	it("rolls back and fails when no networks could be restored", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "x", restoreError: "boom" }])

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", expect.stringMatching(/networks/i))
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
	})

	it("duplicate address: matches on err.message, rolls back, surfaces new copy", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		// Pre-A11: composable did `if (err === "Duplicate address")`. RPC layer
		// reconstructs server throws as Error instances, so that check was DEAD.
		// Post-fix: composable matches on err.message.
		accountClient.restore.mockRejectedValue(new Error("Duplicate address"))

		await c.restoreBackup()

		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "An account from this backup is already in your wallet")
		expect(c.restoreStatus.value).toBe("failed")
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
	})

	it("non-duplicate account failure re-throws into the outer catch, which deletes the orphan profile (pre-finalize rollback)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockRejectedValue(new Error("Profile locked"))

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Import failed", "Profile locked")
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
		// The half-created profile must not be left behind.
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
	})

	it("a token restore throw (pre-finalize) also rolls the orphan profile back", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])
		tokenClient.restore.mockRejectedValue(new Error("storage exploded"))

		await c.restoreBackup()

		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Import failed", "storage exploded")
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
	})

	it("finalizeRestore failure surfaces a distinct error and leaves the profile in storage", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])
		profileClient.finalizeRestore.mockRejectedValue(new Error("session storage full"))

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Couldn't open the imported profile", "session storage full")
		// Profile is intentionally NOT deleted — user can fall back to unlocking via /popup/auth.
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(opts.completeImport).not.toHaveBeenCalled()
	})
})

// ── Passkey ceremony branch (Path A handoff) ─────────────────────────────────

describe("useFullBackupImport — passkey backup", () => {
	const PASSKEY_CRED_ID = "cred-PK123"
	const PASSKEY_DATA = {
		id: asBase64CredentialId(PASSKEY_CRED_ID),
		prf: asBase64SecretPrf("AAAA"),
		userHandle: asHexUserHandle("src-profile-id"),
	}

	async function buildPasskeyBackup() {
		// For passkey backups, `master-key` IS the credentialId (per
		// `ProfileService.exportPlain`'s passkey return). The composable
		// uses `master-key` as the runCeremony's credentialId so the
		// modal targets the right key.
		return buildBackup({
			"master-key": PASSKEY_CRED_ID,
			data: {
				profile: { id: "src-profile-id", name: "PK", type: "passkey" },
				network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
				account: [{ address: "0xaaaa" }],
				token: [],
			},
		})
	}

	it("runs the ceremony for passkey backups and passes credentialData to restore", async () => {
		const runCeremony = vi.fn().mockResolvedValue(PASSKEY_DATA)
		const opts = { ...makeOpts({ password: "" }), runCeremony }
		const c = useFullBackupImport(opts)
		const backup = await buildPasskeyBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "passkey" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "PK", type: "passkey" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		expect(runCeremony).toHaveBeenCalledWith({ mode: "get", credentialId: PASSKEY_CRED_ID })
		expect(profileClient.restore).toHaveBeenCalledWith(
			expect.objectContaining({ type: "passkey" }),
			{ type: "passkey", credentialId: PASSKEY_CRED_ID },
			"", // empty password for passkey
			PASSKEY_DATA, // credentialData forwarded
		)
		expect(opts.completeImport).toHaveBeenCalledOnce()
	})

	it("UserRejectedError from the ceremony silently resets state (no toast, no fillError)", async () => {
		const runCeremony = vi.fn().mockRejectedValue(new UserRejectedError("cancelled"))
		const opts = { ...makeOpts({ password: "" }), runCeremony }
		const c = useFullBackupImport(opts)
		const backup = await buildPasskeyBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "passkey" }

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("") // reset so the Import button is usable again
		expect(opts.fillError).not.toHaveBeenCalled()
		expect(profileClient.restore).not.toHaveBeenCalled()
	})

	it("non-cancel ceremony error surfaces a specific fillError (not generic 'Import failed')", async () => {
		const runCeremony = vi.fn().mockRejectedValue(new Error("authenticator unavailable"))
		const opts = { ...makeOpts({ password: "" }), runCeremony }
		const c = useFullBackupImport(opts)
		const backup = await buildPasskeyBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "passkey" }

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Couldn't authenticate", "authenticator unavailable")
		expect(profileClient.restore).not.toHaveBeenCalled()
	})

	it("missing runCeremony option surfaces an actionable error (defensive — page should always wire it)", async () => {
		const opts = makeOpts({ password: "" }) // no runCeremony
		const c = useFullBackupImport(opts)
		const backup = await buildPasskeyBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "passkey" }

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", expect.stringMatching(/ceremony not wired/i))
		expect(profileClient.restore).not.toHaveBeenCalled()
	})
})

// ── Typed-name override (F3) ─────────────────────────────────────────────────

describe("useFullBackupImport — parsedBackupName + typed-name override (F3)", () => {
	it("parsedBackupName is null until a backup is parsed", () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		expect(c.parsedBackupName.value).toBeNull()
	})

	it("pickBackupFile surfaces the embedded profile name from a plain backup", async () => {
		const backupBody = await buildBackup({
			data: {
				profile: { id: "src-profile-id", name: "Vault A", type: "password" },
				network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
				account: [{ address: "0xaaaa" }],
				token: [],
			},
		})
		const file = new File([JSON.stringify(backupBody)], "backup.json", { type: "application/json" })
		const opts = makeOpts()
		opts.pickFile.mockResolvedValue(file)
		const c = useFullBackupImport(opts)

		await c.pickBackupFile()

		expect(c.parsedBackupName.value).toBe("Vault A")
		expect(c.selectedBackup.value?.type).toBe("plain")
		expect(c.selectedBackup.value?.profileType).toBe("password")
	})

	it("restoreBackup passes the backup-embedded name when profileName opt is absent (regression pin)", async () => {
		const opts = makeOpts() // no profileName
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				profile: { id: "src-profile-id", name: "FromBackup", type: "password" },
				network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
				account: [{ address: "0xaaaa" }],
				token: [],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "FromBackup", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

		await c.restoreBackup()

		expect(profileClient.restore.mock.calls[0][0]).toMatchObject({ name: "FromBackup" })
	})

	it("restoreBackup uses the trimmed profileName override when non-empty; falls back to backup name otherwise", async () => {
		// Sub-case 1: explicit override wins.
		{
			const opts = { ...makeOpts(), profileName: ref("Acme") }
			const c = useFullBackupImport(opts)
			const backup = await buildBackup({
				data: {
					profile: { id: "src-profile-id", name: "FromBackup", type: "password" },
					network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
					account: [{ address: "0xaaaa" }],
					token: [],
				},
			})
			c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

			profileClient.restore.mockResolvedValue({ id: "new-id", name: "Acme", type: "password" })
			networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
			accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])

			await c.restoreBackup()

			expect(profileClient.restore.mock.calls[0][0]).toMatchObject({ name: "Acme" })
			// Confirm we spread-cloned: the backup's embedded profile is untouched.
			expect((backup.data as { profile: { name: string } }).profile.name).toBe("FromBackup")
		}

		// Sub-case 2: whitespace-only override falls back to backup name.
		profileClient.restore.mockReset().mockResolvedValue({ id: "new-id", name: "FromBackup", type: "password" })
		networkClient.restore.mockReset().mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockReset().mockResolvedValue([{ address: "0xaaaa" }])
		{
			const opts = { ...makeOpts(), profileName: ref("   ") }
			const c = useFullBackupImport(opts)
			const backup = await buildBackup({
				data: {
					profile: { id: "src-profile-id", name: "FromBackup", type: "password" },
					network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
					account: [{ address: "0xaaaa" }],
					token: [],
				},
			})
			c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

			await c.restoreBackup()

			expect(profileClient.restore.mock.calls[0][0]).toMatchObject({ name: "FromBackup" })
		}
	})
})
