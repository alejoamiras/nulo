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
import { ref, watch } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NodeStatus } from "@/wallet/services/network/spec"
import { asBase64CredentialId, asBase64SecretPrf, asHexUserHandle, EncryptionKey } from "@nulo/wallet-crypto"
import { RpcDisconnectedError, UserRejectedError } from "@nulo/extension-messaging/errors"

// ── Mocks ───────────────────────────────────────────────────────────────────

const profileClient = {
	restore: vi.fn(),
	finalizeRestore: vi.fn(),
	deleteProfile: vi.fn(),
	disconnect: vi.fn(),
}
const networkClient = {
	restore: vi.fn(),
	setActiveForProfile: vi.fn(),
	probeNodeStatus: vi.fn(),
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
/** Registrable child for account-state fixtures: since the bounded
 *  chain-registration tail landed, zero-work items dial nothing and never
 *  reach the restore call — remap observability needs at least one child. */
const AS_SENDER = { address: `0x${"ab".repeat(32)}` }

function passthroughClient() {
	return { restore: vi.fn(async (): Promise<unknown[]> => []), disconnect: vi.fn() }
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
vi.mock("@/wallet/services/account/spec", () => ({
	ACCOUNT_SERVICE_NAME: "account",
	ACCOUNT_STORAGE_ROOT: "nulo:core:accounts",
	accountRowId: (profileId: string, chainId: number, address: string) => JSON.stringify(["account", profileId, chainId, address]),
}))
vi.mock("@/wallet/services/account-state/spec", () => ({ ACCOUNT_STATE_SERVICE_NAME: "account-state" }))
vi.mock("@/utils/background-liveness", () => ({
	readLiveness: vi.fn(async () => 100),
	awaitLivenessAdvance: vi.fn(async () => 101),
}))
vi.mock("@/wallet/services/auth-registry/spec", () => ({
	AUTH_REGISTRY_SERVICE_NAME: "auth-registry",
	AUTH_REGISTRY_STORAGE_ROOT: "nulo:core:auth-registry",
	AUTH_REGISTRY_ENABLED_STORAGE_ROOT: "nulo:core:auth-registry-enabled",
}))
vi.mock("@/wallet/services/config/spec", () => ({ CONFIG_SERVICE_NAME: "config" }))
vi.mock("@/wallet/services/contact/spec", () => ({ CONTACT_SERVICE_NAME: "contact", CONTACT_STORAGE_ROOT: "nulo:core:contacts" }))
vi.mock("@/wallet/services/fpc/spec", () => ({ FPC_SERVICE_NAME: "fpc", FPC_STORAGE_ROOT: "nulo:core:fpcs" }))
vi.mock("@/wallet/services/network/spec", () => ({
	NETWORK_SERVICE_NAME: "network",
	NETWORK_STORAGE_ROOT: "nulo:core:networks",
	NodeStatus: { Active: 0, Inactive: 1, InvalidChain: 2 },
}))
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
import {
	relinkRestoredTokenBalances,
	restoreAccountsAndFilterOwnedSlices,
	useFullBackupImport,
	validateAndMigrateBackup,
} from "./useFullBackupImport"
import { awaitLivenessAdvance, readLiveness } from "@/utils/background-liveness"

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a backup payload + matching checksum so the integrity guard passes.
 *  `overrides.data` MERGES over the default slices (it must not clobber them:
 *  the mocked v2 migration reads contacts, so the default `contact: []` has to
 *  survive every override). */
async function buildBackup(overrides: Record<string, unknown> = {}) {
	const { data: dataOverride, ...bodyOverrides } = overrides
	const body = {
		"compat-epoch": 4,
		"backup-schema-version": 1,
		"master-key": Buffer.from(new Uint8Array(32)).toString("base64"),
		// Epoch-4 password blobs REQUIRE the entropy field. The composable checks only
		// presence/shape; the words↔master pairing check is service-side (mocked here).
		entropy: Buffer.from(new Uint8Array(32).fill(1)).toString("base64"),
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
					l1ChainId: 1,
					kind: "custom",
					endpoints: [{ id: "src-ep-1", rpcUrl: "https://t/" }],
					primaryEndpointId: "src-ep-1",
				},
			],
			account: [
				{
					profileId: "src-profile-id",
					chainId: 1,
					address: "0xaaaa",
					index: 0,
					type: 0,
					l1ChainId: 1,
					name: "Account 1",
					visible: true,
				},
			],
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

// biome-ignore lint/suspicious/noExplicitAny: the extracted validator takes the raw backup envelope
const validate = (b: unknown) => validateAndMigrateBackup(b as any)

describe("validateAndMigrateBackup — exact reject copy (Q-02)", () => {
	it("tampered checksum → 'Backup Integrity Check Failed' with the exact message", async () => {
		const r = await validate({ ...(await buildBackup()), checksum: "definitely-wrong" })
		expect(r).toEqual({
			kind: "rejected",
			title: "Backup Integrity Check Failed",
			message: "The backup file appears to be corrupted or has been tampered with. Please ensure you have the correct backup file.",
		})
	})

	it("unsupported compat-epoch → 'Incompatible backup' (incompatible-version copy)", async () => {
		const r = await validate(await buildBackup({ "compat-epoch": 2 }))
		expect(r).toEqual({
			kind: "rejected",
			title: "Incompatible backup",
			message:
				"This backup was created by an incompatible wallet version and cannot be imported. Re-export a backup from a current version of the wallet.",
		})
	})

	it("malformed schema-version → 'Incompatible backup' (no-valid-version copy)", async () => {
		const r = await validate(await buildBackup({ "backup-schema-version": 0 }))
		expect(r).toEqual({
			kind: "rejected",
			title: "Incompatible backup",
			message: "This backup does not carry a valid schema version. Re-export a backup from a current version of the wallet.",
		})
	})

	it("too-new schema-version → 'Backup is too new' with the exact message", async () => {
		const r = await validate(await buildBackup({ "backup-schema-version": 999 }))
		expect(r).toEqual({
			kind: "rejected",
			title: "Backup is too new",
			message: "This backup was created by a newer version of the wallet. Update the wallet, then import it again.",
		})
	})

	it("checksum wins over a bad compat-epoch (trust-gate order)", async () => {
		const r = await validate({ ...(await buildBackup({ "compat-epoch": 2 })), checksum: "wrong" })
		expect((r as { title: string }).title).toBe("Backup Integrity Check Failed")
	})

	it("a valid backup resolves ok with the migrated data + checksum-stripped backup", async () => {
		const r = await validate(await buildBackup())
		expect(r.kind).toBe("ok")
		if (r.kind === "ok") {
			expect(r.backup).not.toHaveProperty("checksum")
			expect(r.data.profile?.id).toBe("src-profile-id")
		}
	})
})

// Direct-call contract pins for the stage-2 units (F-Q02). The seam — the
// `${chainId}:${address}` allow-set — is now an explicit return/parameter, so
// its contract is pinned HERE at the unit level; the black-box suites below
// remain the end-to-end proof.
describe("restoreAccountsAndFilterOwnedSlices — stage 2a contract (Q-02)", () => {
	const fakeAccountService = (rows: unknown) => ({ restore: vi.fn(async () => rows) }) as never

	it("returns the allow-set from SUCCESSFUL accounts only and filters every account-owned slice in place", async () => {
		const data = {
			account: [{ address: "0xa", chainId: 1 }],
			transaction: [
				{ account: "0xa", chainId: 1, hash: "keep" },
				{ account: "0xa", chainId: 2, hash: "wrong-chain" },
				{ account: "0xevil", chainId: 1, hash: "foreign" },
			],
			"auth-registry": [{ account: "0xa" }, { account: "0xevil" }],
			"token-balance": [
				{ account: "0xa", id: 1 },
				{ account: "0xevil", id: 2 },
			],
		} as never
		const recorder = vi.fn()

		const set = await restoreAccountsAndFilterOwnedSlices(
			data,
			fakeAccountService([
				{ address: "0xa", chainId: 1 },
				{ address: "0xfail", chainId: 1, restoreError: "boom" },
			]),
			recorder,
		)

		expect([...set]).toEqual(["1:0xa"]) // failed accounts never enter the allow-set
		const d = data as Record<string, Array<Record<string, unknown>>>
		expect(d.transaction.map((t) => t.hash)).toEqual(["keep"])
		expect(d["auth-registry"].map((a) => a.account)).toEqual(["0xa"])
		expect(d["token-balance"].map((b) => b.id)).toEqual([1])
		expect(recorder).toHaveBeenCalledWith("account", expect.anything())
	})

	it("propagates a restore rejection with its IDENTITY intact (the caller matches .message; the outer catch classifies)", async () => {
		const boom = new Error("Duplicate account")
		const failing = { restore: vi.fn(async () => Promise.reject(boom)) } as never

		await expect(restoreAccountsAndFilterOwnedSlices({ account: [] } as never, failing, vi.fn())).rejects.toBe(boom)
	})
})

describe("relinkRestoredTokenBalances — stage 2b contract (Q-02)", () => {
	it("re-links by result index, drops failed-token and chain-mismatched balances, mutates in place, returns the dropped rows", () => {
		const data = {
			token: [
				{ id: 1, chainId: 1 },
				{ id: 2, chainId: 2 },
				{ id: 3, chainId: 1 },
			],
			"token-balance": [
				{ id: 10, token: 1, account: "0xa" }, // ok → n1
				{ id: 11, token: 2, account: "0xa" }, // account not imported on chain 2 → dropped
				{ id: 12, token: 3, account: "0xa" }, // token failed restore → dropped
			],
		} as never
		const newTokens = [
			{ id: "n1", chainId: 1, contract: "0xT" },
			{ id: "n2", chainId: 2, contract: "0xU" },
			{ id: 3, chainId: 1, contract: "0xV", restoreError: "boom" },
		]

		const dropped = relinkRestoredTokenBalances(data, newTokens, new Set(["1:0xa"]))

		expect((data as Record<string, unknown>)["token-balance"]).toEqual([{ id: 10, token: "n1", account: "0xa" }])
		expect(dropped).toHaveLength(2)
		for (const row of dropped as Array<Record<string, unknown>>) {
			expect(row.restoreError).toBe("Token balance could not be re-linked to a restored token")
		}
	})
})

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
	networkClient.setActiveForProfile.mockReset().mockResolvedValue("new-net-1")
	networkClient.probeNodeStatus.mockReset().mockResolvedValue(NodeStatus.Active)
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

	it("item 1b: restores the ACTIVE-network selection (new id) BEFORE finalizeRestore", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			"active-network-id": "src-net-1",
			data: {
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
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		// src-net-1 restored under a NEW id → the resolver must pair by index and write the new id.
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		expect(networkClient.setActiveForProfile).toHaveBeenCalledWith("new-id", "new-net-1")
		// The setter is profileId-parameterized precisely because the profile isn't active until finalize.
		expect(networkClient.setActiveForProfile.mock.invocationCallOrder[0]).toBeLessThan(
			profileClient.finalizeRestore.mock.invocationCallOrder[0],
		)
	})

	it("item 1b: a legacy backup with NO active-network-id sets nothing (bootstrap picks the primary)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
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
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		expect(networkClient.setActiveForProfile).not.toHaveBeenCalled()
	})

	it("restores account-state AFTER finalizeRestore (store key needs an open session; 5.0.1 regression fix)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				network: [{ id: "N1", name: "A", chainId: 1 }],
				"account-state": [{ networkId: "N1", contracts: [], senders: [AS_SENDER] }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "M1", name: "A", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		// The crux: account-state's registerContract needs the PXE store key, which is
		// only provisionable once finalizeRestore has opened the session. So account-state
		// restore MUST run strictly after finalizeRestore (running it before hit
		// PXE_STORE_KEY_MISSING under 5.0.1 → "completed with errors").
		expect(accountStateClient.restore).toHaveBeenCalledOnce()
		expect(profileClient.finalizeRestore).toHaveBeenCalledOnce()
		expect(accountStateClient.restore.mock.invocationCallOrder[0]).toBeGreaterThan(
			profileClient.finalizeRestore.mock.invocationCallOrder[0],
		)
		expect(accountStateClient.disconnect).toHaveBeenCalled()
		expect(c.isRestoreHasErrors.value).toBe(false)
	})

	it("a present-but-malformed account-state slice records a violation and blocks auto-completion", async () => {
		// Hostile `{}` where the array belongs: gating the chain-sync tail on
		// Array.isArray would skip the normalizer's violation record and let the
		// import auto-route past the Continue gate unrecorded.
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				network: [{ id: "N1", name: "A", chainId: 1 }],
				"account-state": { evil: true } as never,
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "M1", name: "A", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		expect(accountStateClient.restore).not.toHaveBeenCalled() // nothing registrable
		expect(c.isRestoreHasErrors.value).toBe(true)
		const records = c.restoreErrorLog.value["account-state"] as Array<{ restoreError?: unknown }>
		expect(records?.some((r) => typeof r.restoreError === "string" && r.restoreError.includes("not an array"))).toBe(true)
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

	it("rejects an unsupported compat-epoch (incl. epoch 3 — the superseded KDF-v1 generation)", async () => {
		await expectRejected(await buildBackup({ "compat-epoch": 2 }), "Incompatible backup")
		await expectRejected(await buildBackup({ "compat-epoch": 3 }), "Incompatible backup")
		await expectRejected(await buildBackup({ "compat-epoch": 5 }), "Incompatible backup")
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
		const backup = await buildBackup({ "compat-epoch": 2 })
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
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xMINE" }],
				transaction: [
					{ hash: "h1", account: "0xMINE", chainId: 1 },
					{ hash: "h2", account: "0xFOREIGN", chainId: 1 },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xMINE", chainId: 1 }])

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await c.restoreBackup()

		// Only the imported-account tx reaches restore; the foreign one is dropped
		// BEFORE it can be written (it would otherwise surface in another profile's
		// activity and never be purged after the subscriber removal).
		expect(transactionClient.restore).toHaveBeenCalledWith([{ hash: "h1", account: "0xMINE", chainId: 1 }])
		// Recorded (console), NOT surfaced as a user-facing restore error — a
		// dropped foreign/corrupt tx must not flip a clean import to error-mode.
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 transaction"))
		expect(c.restoreErrorLog.value.transaction).toBeUndefined()
		expect(c.isRestoreHasErrors.value).toBe(false)
		warn.mockRestore()
	})

	it("keeps every tx when all accounts were imported (no false drops)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [
					{ profileId: "src-profile-id", chainId: 1, address: "0xA" },
					{ profileId: "src-profile-id", chainId: 1, address: "0xB" },
				],
				transaction: [
					{ hash: "h1", account: "0xA", chainId: 1 },
					{ hash: "h2", account: "0xB", chainId: 1 },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([
			{ address: "0xA", chainId: 1 },
			{ address: "0xB", chainId: 1 },
		])

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
				account: [
					{ profileId: "src-profile-id", chainId: 1, address: "0xOK" },
					{ profileId: "src-profile-id", chainId: 1, address: "0xBAD" },
				],
				transaction: [{ hash: "h1", account: "0xBAD", chainId: 1 }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xOK" }, { address: "0xBAD", restoreError: "boom" }])

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await c.restoreBackup()

		// The tx's account failed to restore → dropped (allow-set is SUCCESSFUL
		// accounts). The failed ACCOUNT already surfaces its own restoreError, so
		// the dropped tx is only console-recorded, not double-flagged.
		expect(transactionClient.restore).toHaveBeenCalledWith([])
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 transaction"))
		warn.mockRestore()
	})
})

describe("useFullBackupImport — account-owned-slice provenance (P3)", () => {
	it("drops an auth-registry row whose account was NOT imported (graft closed)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xMINE" }],
				"auth-registry": [
					{ id: 1, account: "0xMINE", hash: "0xh1" },
					{ id: 2, account: "0xVICTIM", hash: "0xh2" },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xMINE", chainId: 1 }])
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		await c.restoreBackup()

		// Only the imported-account authwit reaches restore; the foreign one is
		// dropped before it can graft into the victim's revocation index.
		expect(authRegistryClient.restore).toHaveBeenCalledWith([{ id: 1, account: "0xMINE", hash: "0xh1" }])
		warn.mockRestore()
	})

	it("drops a token-balance whose account was NOT imported (graft closed)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xMINE" }],
				token: [{ id: 1, chainId: 1, contract: "0xT" }],
				"token-balance": [
					{ id: 10, token: 1, account: "0xMINE" },
					{ id: 11, token: 1, account: "0xVICTIM" },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xMINE", chainId: 1 }])
		tokenClient.restore.mockResolvedValue([{ id: "n1", chainId: 1, contract: "0xT" }])
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		await c.restoreBackup()

		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([{ id: 10, token: "n1", account: "0xMINE" }])
		warn.mockRestore()
	})

	it("drops a tx referencing an imported account on the WRONG chain (chain-provenance)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xMINE" }],
				transaction: [
					{ hash: "h1", account: "0xMINE", chainId: 1 },
					{ hash: "h2", account: "0xMINE", chainId: 2 },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xMINE", chainId: 1 }])
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		await c.restoreBackup()

		// 0xMINE was imported on chain 1 only → the chain-2 tx is dropped (an
		// address-only filter would have admitted it).
		expect(transactionClient.restore).toHaveBeenCalledWith([{ hash: "h1", account: "0xMINE", chainId: 1 }])
		warn.mockRestore()
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
					{ networkId: "N1", contracts: [], senders: [AS_SENDER] },
					{ networkId: "N2", contracts: [], senders: [AS_SENDER] },
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
				{ networkId: "M1", contracts: [], senders: [AS_SENDER] },
				{ networkId: "M2", contracts: [], senders: [AS_SENDER] },
			],
			expect.anything(),
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
					{ networkId: "NA", contracts: [], senders: [AS_SENDER] },
					{ networkId: "NB", contracts: [], senders: [AS_SENDER] },
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
				{ networkId: "NA", contracts: [], senders: [AS_SENDER] },
				{ networkId: "MB", contracts: [], senders: [AS_SENDER] },
			],
			expect.anything(),
			expect.anything(),
		)
	})

	it("(3+ matrix) index-pairs a mixed changed/failed/unchanged/changed set correctly", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				network: [
					{ id: "N1", name: "A", chainId: 1 },
					{ id: "N2", name: "B", chainId: 2 },
					{ id: "N3", name: "C", chainId: 3 },
					{ id: "N4", name: "D", chainId: 4 },
				],
				"account-state": [
					{ networkId: "N1", contracts: [], senders: [AS_SENDER] },
					{ networkId: "N2", contracts: [], senders: [AS_SENDER] },
					{ networkId: "N3", contracts: [], senders: [AS_SENDER] },
					{ networkId: "N4", contracts: [], senders: [AS_SENDER] },
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		accountClient.restore.mockResolvedValue([])
		// index 0 changed (N1→M1); index 1 FAILED (raw fields spread back); index 2
		// unchanged (N3 kept its id); index 3 changed (N4→M4).
		networkClient.restore.mockResolvedValue([
			{ id: "M1", name: "A", chainId: 1 },
			{ id: "N2", name: "B", chainId: 2, restoreError: "boom" },
			{ id: "N3", name: "C", chainId: 3 },
			{ id: "M4", name: "D", chainId: 4 },
		])

		await c.restoreBackup()

		expect(accountStateClient.restore).toHaveBeenCalledWith(
			[
				{ networkId: "M1", contracts: [], senders: [AS_SENDER] }, // N1 → M1
				{ networkId: "N2", contracts: [], senders: [AS_SENDER] }, // N2 failed → not remapped
				{ networkId: "N3", contracts: [], senders: [AS_SENDER] }, // N3 unchanged
				{ networkId: "M4", contracts: [], senders: [AS_SENDER] }, // N4 → M4
			],
			expect.anything(),
			expect.anything(),
		)
	})

	// NB: the composable also skips DUPLICATED source ids from the remap map
	// (sourceIdCounts), but a backup carrying two networks with the same root id
	// is rejected upstream by backup normalization (backup-migration-registry
	// duplicate-root-id guard) before restore runs — so that skip is unreachable
	// defense-in-depth here and is covered by the normalization dup-rejection
	// test, not this composable path.
})

describe("useFullBackupImport — profileId normalization (P2 hardening)", () => {
	it("normalizes a hostile foreign profileId even when the root profile id is UNCHANGED (unconditional remap)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		// Crafted backup: root profile id "src-profile-id" is unused → restore
		// KEEPS it (so `newProfile.id === profile.id`, the old guard's skip case),
		// but a child network row smuggles a DIFFERENT (victim) profileId.
		const backup = await buildBackup({
			data: {
				network: [
					{
						id: "src-net-1",
						profileId: "victim-profile-id",
						name: "Testnet",
						rpcUrl: "https://t/",
						chainId: 1,
						kind: "custom",
						endpoints: [{ id: "src-ep-1", rpcUrl: "https://t/" }],
						primaryEndpointId: "src-ep-1",
					},
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		// restore returns the SAME id → `newProfile.id !== profile.id` is false.
		profileClient.restore.mockResolvedValue({ id: "src-profile-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([])

		await c.restoreBackup()

		// The foreign profileId was rewritten to the created profile's id. Under the
		// old `if (newProfile.id !== profile.id)` guard it would have been written
		// verbatim → the row would bind to (graft into) the victim profile.
		const restoredNetworks = networkClient.restore.mock.calls[0][0] as Array<{ profileId: string }>
		expect(restoredNetworks[0].profileId).toBe("src-profile-id")
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
		// 0xa is imported on BOTH chains (chain-distinct accounts) so each chain's
		// balance passes the token/account chain-equality check.
		accountClient.restore.mockResolvedValue([
			{ address: "0xa", chainId: 1 },
			{ address: "0xa", chainId: 2 },
		])
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

	it("index-pairs duplicate-contract tokens distinctly — a balance maps to its OWN token by id (not dropped)", async () => {
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
		accountClient.restore.mockResolvedValue([{ address: "0xa", chainId: 1 }])
		// Both restore successfully; INDEX-pairing maps old id 1→n1, 2→n2 — the old
		// composite-key approach used to falsely DROP this balance as "ambiguous".
		tokenClient.restore.mockResolvedValue([
			{ id: "n1", chainId: 1, contract: "0xDUP" },
			{ id: "n2", chainId: 1, contract: "0xDUP" },
		])

		await c.restoreBackup()

		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([{ id: 10, token: "n1", account: "0xa" }])
	})

	it("drops a balance whose account was imported on a DIFFERENT chain than the token (chain-equality cross-check)", async () => {
		// The seam pin the prior suite lacked: every earlier test imported the
		// address on BOTH chains, so deleting the chain-equality check kept them
		// green. Here 0xa is imported ONLY on chain 1, while the balance's token
		// lives on chain 2 — the cross-check (fed by the stage-2a allow-set) must
		// drop it with a diagnostic.
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				token: [{ id: 2, chainId: 2, contract: "0xT" }],
				"token-balance": [{ id: 11, token: 2, account: "0xa" }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xa", chainId: 1 }])
		tokenClient.restore.mockResolvedValue([{ id: "n2", chainId: 2, contract: "0xT" }])

		await c.restoreBackup()

		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([])
		expect(c.restoreErrorLog.value["token-balance"]).toHaveLength(1)
	})

	it("detects OLD-side ambiguity: two old tokens share (chainId,contract), one FAILS restore → balance NOT grafted onto survivor", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				token: [
					{ id: 1, chainId: 1, contract: "0xDUP" },
					{ id: 2, chainId: 1, contract: "0xDUP" },
				],
				// The balance references old token 2 — the one that FAILS to restore.
				"token-balance": [{ id: 10, token: 2, account: "0xa" }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xa", chainId: 1 }])
		// token 1 succeeds; token 2 FAILS. The NEW side now sees only ONE
		// (1,0xDUP) → looks unambiguous. The OLD-side duplicate must still mark
		// the key ambiguous, or the balance would silently graft onto n1.
		tokenClient.restore.mockResolvedValue([
			{ id: "n1", chainId: 1, contract: "0xDUP" },
			{ id: 2, chainId: 1, contract: "0xDUP", restoreError: "boom" },
		])

		await c.restoreBackup()

		expect(tokenBalanceClient.restore).toHaveBeenCalledWith([])
		expect(c.restoreErrorLog.value["token-balance"]).toHaveLength(1)
	})

	it("MERGES un-relinkable-balance diagnostics with a later token-balance restore error (no clobber)", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({
			data: {
				token: [{ id: 1, chainId: 1, contract: "0xT" }],
				"token-balance": [
					{ id: 10, token: 999, account: "0xa" }, // references a MISSING old token → dropped-and-recorded
					{ id: 11, token: 1, account: "0xa" }, // re-links to n1 → passed to restore
				],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xa", chainId: 1 }])
		tokenClient.restore.mockResolvedValue([{ id: "n1", chainId: 1, contract: "0xT" }])
		// The re-linked balance then FAILS its actual restore. recordRestoreErrors
		// must APPEND this to the drop diagnostic, not overwrite it.
		tokenBalanceClient.restore.mockResolvedValue([{ id: 11, token: "n1", account: "0xa", restoreError: "quota exceeded" }])

		await c.restoreBackup()

		// 1 dropped (missing token) + 1 real restore error = 2, not 1.
		expect(c.restoreErrorLog.value["token-balance"]).toHaveLength(2)
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

		// The whole-loop finally must disconnect every constructed LOOP client — the
		// one that threw AND all the ones after it that never ran.
		expect(transactionClient.disconnect).toHaveBeenCalled()
		expect(tokenBalanceClient.disconnect).toHaveBeenCalled()
		expect(authRegistryClient.disconnect).toHaveBeenCalled()
		expect(fpcClient.disconnect).toHaveBeenCalled()
		expect(contactClient.disconnect).toHaveBeenCalled()
		expect(configClient.disconnect).toHaveBeenCalled()
		// account-state is NOT in the loop — it is restored AFTER finalizeRestore, which
		// a mid-loop throw never reaches, so its client is never even constructed (nothing
		// to leak). Its own restore step owns its disconnect (see the happy-path test).
		expect(accountStateClient.disconnect).not.toHaveBeenCalled()
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

	it("(B-24) a persistently-failing rollback retries and surfaces a cleanup-pending error", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "x", restoreError: "boom" }]) // no networks → site-1 rollback
		// The compensating delete rejects on every attempt (e.g. its tombstone write fails).
		profileClient.deleteProfile.mockRejectedValue(new Error("tombstone write failed"))

		await c.restoreBackup()

		// Retried a bounded number of times, not swallowed after one attempt.
		expect(profileClient.deleteProfile).toHaveBeenCalledTimes(3)
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(c.restoreStatus.value).toBe("failed")
		// Actionable cleanup-pending message instead of the generic per-site error.
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Import incomplete", expect.stringContaining("Delete it in Settings"))
	})

	it("duplicate account: matches on err.message, rolls back, surfaces new copy", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		// Pre-A11: composable did `if (err === "Duplicate account")`. RPC layer
		// reconstructs server throws as Error instances, so that check was DEAD.
		// Post-fix: composable matches on err.message.
		accountClient.restore.mockRejectedValue(new Error("Duplicate account"))

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
		// Passkey blobs must NOT carry an entropy field (the composable rejects one).
		return buildBackup({
			"master-key": PASSKEY_CRED_ID,
			entropy: undefined,
			data: {
				profile: { id: "src-profile-id", name: "PK", type: "passkey" },
				network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
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
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
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
				account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
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
					account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
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
					account: [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
					token: [],
				},
			})
			c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

			await c.restoreBackup()

			expect(profileClient.restore.mock.calls[0][0]).toMatchObject({ name: "FromBackup" })
		}
	})
})

describe("restoreStage — phase observability", () => {
	// A synchronous watcher records every transition, so ordering is asserted
	// on the full history rather than on sampled snapshots.
	function recordStages(c: ReturnType<typeof useFullBackupImport>) {
		const seen: string[] = [c.restoreStage.value]
		watch(
			c.restoreStage,
			(v) => {
				seen.push(v)
			},
			{ flush: "sync" },
		)
		return seen
	}

	it("advances through the stages in order on a clean import, never backward", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])
		const seen = recordStages(c)

		await c.restoreBackup()

		const order = [
			"",
			"restoring:profile",
			"restoring:networks",
			"restoring:tokens",
			"restoring:services",
			"finalizing",
			"restoring:account-state",
			"finished",
		]
		// The chain-sync stage only appears when the backup carries an
		// account-state slice; assert the observed history is an ordered
		// subsequence-superset of the required order.
		const required = seen.filter((v) => order.includes(v))
		expect(required).toEqual(order)
		expect(c.restoreStage.value).toBe("finished")
	})

	it("a pre-finalize service failure lands rolled-back and deleteProfile was called", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		// The token restore rejecting is a pre-finalize failure that reaches the
		// outer catch (unlike per-service loop errors, which are recorded).
		tokenClient.restore.mockRejectedValue(new Error("boom mid-restore"))
		const seen = recordStages(c)

		await c.restoreBackup()

		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(seen).toContain("rolling-back")
		expect(c.restoreStage.value).toBe("rolled-back")
		expect(profileClient.finalizeRestore).not.toHaveBeenCalled()
	})

	it("a post-finalize failure never enters rolling-back and keeps the profile", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		// The slice must EXIST (and its networkId must survive the remap) for
		// the account-state leg to run at all — without it the rejection mock
		// is never invoked and every assert passes vacuously (review finding,
		// both lenses).
		const backup = await buildBackup({
			data: {
				network: [{ id: "N1", name: "A", chainId: 1 }],
				"account-state": [{ networkId: "N1", contracts: [], senders: [AS_SENDER] }],
			},
		})
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "M1", name: "A", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])
		// Post-finalize failures are RETAIN + record, never rollback: the
		// chain-sync runner contractually converts this rejection into recorded
		// skip errors (importChainSync's own catch) — the outer catch is
		// UNREACHABLE from this boundary by design, which is exactly the
		// contract this pin holds.
		accountStateClient.restore.mockRejectedValue(new Error("post-finalize boom"))
		const seen = recordStages(c)

		await c.restoreBackup()

		expect(accountStateClient.restore).toHaveBeenCalled()
		expect(profileClient.finalizeRestore).toHaveBeenCalled()
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(seen).not.toContain("rolling-back")
		expect(c.restoreStage.value).toBe("finished")
	})

	it("deleteProfile rejecting EVERY bounded attempt lands rollback-failed", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		tokenClient.restore.mockRejectedValue(new Error("boom mid-restore"))
		profileClient.deleteProfile.mockRejectedValue(new Error("delete refused"))

		await c.restoreBackup()

		expect(c.restoreStage.value).toBe("rollback-failed")
		// B-24 integration: the stage wraps the SHARED bounded rollback helper —
		// all attempts ran before the failure was declared.
		expect(profileClient.deleteProfile).toHaveBeenCalledTimes(3)
	})
})

describe("crash-rollback liveness gate", () => {
	// The MV3 respawn gap: a disconnect-classified pre-finalize failure means
	// the worker died mid-restore — the rollback must wait for the NEW
	// worker's liveness signal before the bounded delete helper runs, or every
	// attempt burns into doomed ports in milliseconds (deflake-round-4
	// BUG-TRANSPORT; fix-plan Decision 1 + ledger row 15).
	function primeHappyRestore() {
		profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
		networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
		accountClient.restore.mockResolvedValue([{ address: "0xaaaa" }])
	}

	it("a disconnect-classified failure awaits the liveness advance, THEN rolls back", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		primeHappyRestore()
		tokenClient.restore.mockRejectedValue(new Error("Client disconnected"))

		await c.restoreBackup()

		expect(readLiveness).toHaveBeenCalledTimes(1)
		expect(awaitLivenessAdvance).toHaveBeenCalledTimes(1)
		expect(awaitLivenessAdvance).toHaveBeenCalledWith(100, 60_000)
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		// Ordering: the gate resolves BEFORE the first delete attempt.
		expect(vi.mocked(awaitLivenessAdvance).mock.invocationCallOrder[0]).toBeLessThan(
			profileClient.deleteProfile.mock.invocationCallOrder[0],
		)
		expect(c.restoreStage.value).toBe("rolled-back")
	})

	it("an RpcDisconnectedError send-failure shape is gated too", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		primeHappyRestore()
		tokenClient.restore.mockRejectedValue(new RpcDisconnectedError("RPC 'restore' aborted: port disconnected", {}))

		await c.restoreBackup()

		expect(awaitLivenessAdvance).toHaveBeenCalledTimes(1)
		expect(c.restoreStage.value).toBe("rolled-back")
	})

	it("a NON-disconnect failure rolls back immediately — no liveness wait", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		primeHappyRestore()
		tokenClient.restore.mockRejectedValue(new Error("boom mid-restore"))

		await c.restoreBackup()

		expect(awaitLivenessAdvance).not.toHaveBeenCalled()
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(c.restoreStage.value).toBe("rolled-back")
	})

	it("a rejected baseline READ also fails closed — zero deletes, rollback-failed", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		primeHappyRestore()
		tokenClient.restore.mockRejectedValue(new Error("Client disconnected"))
		vi.mocked(readLiveness).mockRejectedValueOnce(new Error("session storage unavailable"))

		await c.restoreBackup()

		// The rejection must NOT escape the catch (stage stuck at rolling-back,
		// status stuck at progress was the failure mode) — same fail-closed
		// path as a ceiling expiry.
		expect(awaitLivenessAdvance).not.toHaveBeenCalled()
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(c.restoreStage.value).toBe("rollback-failed")
		expect(c.restoreStatus.value).toBe("failed")
	})

	it("a liveness ceiling expiry SKIPS the delete helper and fails closed to rollback-failed", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		primeHappyRestore()
		tokenClient.restore.mockRejectedValue(new Error("Client disconnected"))
		vi.mocked(awaitLivenessAdvance).mockRejectedValueOnce(new Error("liveness never advanced past 100"))

		await c.restoreBackup()

		// Fail-closed: NO delete attempts against a worker that never proved
		// itself; the torn-marker backstop stays authoritative.
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(c.restoreStage.value).toBe("rollback-failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Import incomplete", expect.stringContaining("Delete it in Settings"))
	})
})
