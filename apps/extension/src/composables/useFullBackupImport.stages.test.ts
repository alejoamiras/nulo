/**
 * PRE-EXTRACTION real-wiring pins for restoreBackup/pickBackupFile/decryptBackup — the
 * equivalence complement the backup-import-decomposition plan requires committed BEFORE any
 * refactor (codex blueprint audit, response-6). These drive the CURRENT composable over the
 * same mock scaffolding as useFullBackupImport.test.ts and must stay green, unchanged,
 * across the decomposition. Scaffolding duplicated from that file (vi.mock is per-file).
 */
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
import { NodeStatus } from "@/wallet/services/network/spec"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { RpcDisconnectedError } from "@nulo/extension-messaging/errors"

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
	restoreImportedKeys: vi.fn(async () => []),
	reconcileImportedAccounts: vi.fn(async () => []),
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
	IMPORTED_KEYS_SERVICE_NAME: "imported-account-keys",
	IMPORTED_KEYS_STORAGE_ROOT: "nulo:core:imported-account-keys",
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
import { useFullBackupImport } from "./useFullBackupImport"
import { readLiveness } from "@/utils/background-liveness"

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
		// Epoch-4 password blobs also REQUIRE the imported-keys DEK carrier (plaintext beside
		// the plaintext master; the rewrap semantics are service-side, mocked here).
		"imported-keys-dek": Buffer.from(new Uint8Array(32).fill(2)).toString("base64"),
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

// ── Pre-extraction pins ─────────────────────────────────────────────────────

function happyWiring() {
	profileClient.restore.mockResolvedValue({ id: "new-id", name: "Imported", type: "password" })
	networkClient.restore.mockResolvedValue([{ id: "new-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }])
	accountClient.restore.mockResolvedValue([{ address: "0xaaaa", chainId: 1 }])
}

async function mountWithBackup(overrides: Record<string, unknown> = {}, opts = makeOpts()) {
	const c = useFullBackupImport(opts)
	const backup = await buildBackup(overrides)
	c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
	return { c, opts, backup }
}

describe("stage-order law (real wiring, happy path with every slice)", () => {
	it("runs profile → networks → active-pointer → accounts → imported keys → tokens → six services → reconcile → finalize → account-state → completeImport, in order", async () => {
		const order: string[] = []
		const track = (name: string, client: { restore: ReturnType<typeof vi.fn> }) => {
			const prev = client.restore.getMockImplementation() as ((...a: never[]) => Promise<unknown>) | undefined
			client.restore.mockImplementation(async (...a: unknown[]) => {
				order.push(name)
				return prev ? prev(...(a as never[])) : []
			})
		}
		happyWiring()
		track("profile", profileClient as never)
		track("network", networkClient as never)
		track("account", accountClient as never)
		track("token", tokenClient as never)
		track("transaction", transactionClient)
		track("token-balance", tokenBalanceClient)
		track("auth-registry", authRegistryClient)
		track("fpc", fpcClient)
		track("contact", contactClient)
		track("config", configClient)
		track("account-state", accountStateClient)
		networkClient.setActiveForProfile.mockImplementation(async () => {
			order.push("active-pointer")
			return "new-net-1"
		})
		accountClient.restoreImportedKeys.mockImplementation(async () => {
			order.push("imported-keys")
			return []
		})
		accountClient.reconcileImportedAccounts.mockImplementation(async () => {
			order.push("reconcile")
			return []
		})
		profileClient.finalizeRestore.mockImplementation(async () => {
			order.push("finalize")
			return { id: "new-id" }
		})

		const opts = makeOpts()
		const markersAtComplete: unknown[] = []
		opts.completeImport.mockImplementation(async () => {
			order.push("complete")
			markersAtComplete.push(cRef?.restoreStatus.value, cRef?.restoreStage.value)
		})
		let cRef: ReturnType<typeof useFullBackupImport> | undefined
		const { c } = await mountWithBackup(
			{
				"active-network-id": "src-net-1",
				data: {
					"imported-account-keys": [{ profileId: "src-profile-id", chainId: 1, address: "0xaaaa" }],
					transaction: [{ account: "0xaaaa", chainId: 1, hash: "h1" }],
					"token-balance": [],
					"auth-registry": [{ id: 1, account: "0xaaaa" }],
					fpc: [{ id: "f1" }],
					contact: [],
					config: [{ key: "k", value: true }],
					"account-state": [{ networkId: "src-net-1", contracts: [], senders: [AS_SENDER] }],
				},
			},
			opts,
		)
		cRef = c
		await c.restoreBackup()

		// Both finished markers are already set when completeImport observes them.
		expect(markersAtComplete).toEqual(["finished", "finished"])
		expect(order).toEqual([
			"profile",
			"network",
			"active-pointer",
			"account",
			"imported-keys",
			"token",
			"transaction",
			"token-balance",
			"auth-registry",
			"fpc",
			"contact",
			"config",
			"reconcile",
			"finalize",
			"account-state",
			"complete",
		])
		// Completion payload: completeImport receives the restored profile, with both
		// finished markers already set at call time.
		expect(opts.completeImport).toHaveBeenCalledWith(expect.objectContaining({ id: "new-id" }))
		expect(c.restoreStatus.value).toBe("finished")
		expect(c.restoreStage.value).toBe("finished")
		// Clean auto-complete leaves importedProfile UNSET (it is only set on the partial-errors path).
		expect(c.importedProfile.value).toBeNull()
	})

	it("the account-state tail receives the SUCCESSFUL networks subset (not the full index-aligned result)", async () => {
		happyWiring()
		networkClient.restore.mockResolvedValue([
			{ id: "new-net-1", name: "A", rpcUrl: "https://a/", chainId: 1 },
			{ id: "src-net-2", name: "B", rpcUrl: "https://b/", chainId: 2, restoreError: "nope" },
		])
		const { c } = await mountWithBackup({
			data: {
				network: [
					{
						id: "src-net-1",
						profileId: "src-profile-id",
						name: "A",
						rpcUrl: "https://a/",
						chainId: 1,
						kind: "custom",
						endpoints: [{ id: "e1", rpcUrl: "https://a/" }],
						primaryEndpointId: "e1",
					},
					{
						id: "src-net-2",
						profileId: "src-profile-id",
						name: "B",
						rpcUrl: "https://b/",
						chainId: 2,
						kind: "custom",
						endpoints: [{ id: "e2", rpcUrl: "https://b/" }],
						primaryEndpointId: "e2",
					},
				],
				"account-state": [
					{ networkId: "src-net-1", contracts: [], senders: [AS_SENDER] },
					// Work targeting the FAILED network: its id never remaps, so the chain-sync
					// normalizer must record it, never probe it.
					{ networkId: "src-net-2", contracts: [], senders: [AS_SENDER] },
				],
			},
		})
		await c.restoreBackup()
		expect(accountStateClient.restore).toHaveBeenCalled()
		const nets = (accountStateClient.restore.mock.calls[0] as unknown[])[1] as Array<{ id: string }>
		expect(nets.map((n) => n.id)).toEqual(["new-net-1"])
		// Failed networks are never probed — even with account-state work pointed at them:
		// exactly the successful id is probed, nothing else.
		const probed = networkClient.probeNodeStatus.mock.calls.map((call) => call[0])
		expect(probed).toEqual(["new-net-1"])
	})
})

describe("epoch-4 secret gates — rejections AND permissiveness", () => {
	it("password backup missing entropy fails with the exact copy", async () => {
		happyWiring()
		const backup = await buildBackup()
		const { checksum: _c, entropy: _e, ...body } = backup as Record<string, unknown>
		const fixed = { ...body, checksum: await EncryptionKey.getHashHex(JSON.stringify(body)) }
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: fixed, type: "plain", profileType: "password" }
		await c.restoreBackup()
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "This backup is missing its recovery-phrase entropy.")
		expect(c.restoreStatus.value).toBe("failed")
	})

	it("password backup missing the imported-keys DEK fails with the exact copy", async () => {
		happyWiring()
		const backup = await buildBackup()
		const { checksum: _c, "imported-keys-dek": _dek, ...body } = backup as Record<string, unknown>
		const fixed = { ...body, checksum: await EncryptionKey.getHashHex(JSON.stringify(body)) }
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "x.json", backup: fixed, type: "plain", profileType: "password" }
		await c.restoreBackup()
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "This backup is missing its imported-keys key.")
	})

	it("PERMISSIVENESS: a password backup with an EXTRA sealed DEK still imports (asymmetry preserved)", async () => {
		happyWiring()
		const { c, opts } = await mountWithBackup({ "imported-keys-dek-sealed": "c2VhbGVk" })
		await c.restoreBackup()
		expect(c.restoreStatus.value).toBe("finished")
		expect(opts.fillError).not.toHaveBeenCalled()
	})
})

describe("stage/status matrix on the failure paths", () => {
	it("no-networks rollback keeps the stage at restoring:networks (NO rolling-back emission) with the exact copy", async () => {
		happyWiring()
		networkClient.restore.mockResolvedValue([{ id: "x", restoreError: "bad" }])
		const { c, opts } = await mountWithBackup()
		await c.restoreBackup()
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(c.restoreStage.value).toBe("restoring:networks")
		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "Couldn't restore any networks from this backup")
	})

	it("duplicate-account rollback also keeps the pre-accounts stage (historical, preserved)", async () => {
		happyWiring()
		accountClient.restore.mockRejectedValue(new Error("Duplicate account"))
		const { c, opts } = await mountWithBackup()
		await c.restoreBackup()
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(c.restoreStage.value).toBe("restoring:networks")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "An account from this backup is already in your wallet")
	})

	it("duplicate-confirm decline abandons cleanly: status '', no profile, no error", async () => {
		happyWiring()
		const opts = { ...makeOpts(), confirmDuplicate: vi.fn(async () => undefined) }
		const c = useFullBackupImport(opts as never)
		const backup = await buildBackup()
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }
		await c.restoreBackup()
		expect(c.restoreStatus.value).toBe("")
		expect(opts.fillError).not.toHaveBeenCalled()
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
	})

	it("a rejected active-pointer write never fails the import", async () => {
		happyWiring()
		networkClient.setActiveForProfile.mockRejectedValue(new Error("not owned"))
		const { c } = await mountWithBackup({ "active-network-id": "src-net-1" })
		await c.restoreBackup()
		expect(c.restoreStatus.value).toBe("finished")
	})

	it("finalize failure keeps the profile (no rollback) with the exact copy", async () => {
		happyWiring()
		profileClient.finalizeRestore.mockRejectedValue(new Error("kdf broke"))
		const { c, opts } = await mountWithBackup()
		await c.restoreBackup()
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Couldn't open the imported profile", "kdf broke")
	})

	it("a post-finalize account-state failure is ABSORBED into error records — profile kept, partial-errors path", async () => {
		happyWiring()
		accountStateClient.restore.mockRejectedValue(new Error("pxe down"))
		const { c } = await mountWithBackup({
			data: { "account-state": [{ networkId: "src-net-1", contracts: [], senders: [AS_SENDER] }] },
		})
		await c.restoreBackup()
		// The bounded chain-sync tail converts the failure into skip/violation records; the
		// import finishes degraded, the profile is KEPT, and the errors screen gates Continue.
		expect(profileClient.deleteProfile).not.toHaveBeenCalled()
		expect(c.restoreStatus.value).toBe("finished")
		expect(c.isRestoreHasErrors.value).toBe(true)
		expect(c.importedProfile.value).toMatchObject({ id: "new-id" })
	})

	it("a PRE-finalize mid-flight throw rolls back the created profile (createdProfileId was already visible)", async () => {
		happyWiring()
		tokenClient.restore.mockRejectedValue(new Error("boom"))
		const { c } = await mountWithBackup()
		await c.restoreBackup()
		expect(profileClient.deleteProfile).toHaveBeenCalledWith("new-id")
		expect(c.restoreStage.value).toBe("rolled-back")
	})

	it("bounded rollback: two failed deletes then success still lands rolled-back", async () => {
		happyWiring()
		tokenClient.restore.mockRejectedValue(new Error("boom"))
		profileClient.deleteProfile
			.mockRejectedValueOnce(new Error("t1"))
			.mockRejectedValueOnce(new Error("t2"))
			.mockResolvedValueOnce(undefined)
		const { c } = await mountWithBackup()
		await c.restoreBackup()
		expect(profileClient.deleteProfile).toHaveBeenCalledTimes(3)
		expect(c.restoreStage.value).toBe("rolled-back")
	})

	it("liveness-gate read failure fails CLOSED to cleanup-pending", async () => {
		happyWiring()
		tokenClient.restore.mockRejectedValue(new RpcDisconnectedError("gone"))
		vi.mocked(readLiveness).mockRejectedValueOnce(new Error("storage read failed"))
		const { c, opts } = await mountWithBackup()
		await c.restoreBackup()
		expect(c.restoreStage.value).toBe("rollback-failed")
		expect(opts.fillError).toHaveBeenCalledWith(
			"full_backup",
			"Import incomplete",
			expect.stringContaining("couldn't be removed automatically"),
		)
	})
})

describe("error-log conservation", () => {
	it("the log RESETS at restore start and APPENDS across sources", async () => {
		happyWiring()
		tokenClient.restore.mockResolvedValue([{ id: 1, chainId: 1, contract: "0xT", restoreError: "row broke" }])
		const { c } = await mountWithBackup({
			data: { token: [{ id: 1, chainId: 1 }], "token-balance": [{ id: 9, token: 999, account: "0xaaaa" }] },
		})
		c.restoreErrorLog.value = { stale: [{ old: true }] }
		await c.restoreBackup()
		expect(c.restoreErrorLog.value.stale).toBeUndefined()
		expect(c.restoreErrorLog.value["token-balance"]?.length).toBeGreaterThan(0)
		expect(c.restoreErrorLog.value.token?.length).toBeGreaterThan(0)
		// Partial-errors path: finished status, importedProfile SET (manual continue).
		expect(c.restoreStatus.value).toBe("finished")
		expect(c.importedProfile.value).toMatchObject({ id: "new-id" })
	})
})

describe("pickBackupFile / decryptBackup behavior pins", () => {
	it("progress guard: a running restore blocks a new pick entirely", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.restoreStatus.value = "progress"
		await c.pickBackupFile()
		expect(opts.pickFile).not.toHaveBeenCalled()
	})

	it("a null pick DROPS the previous selection (no stale import CTA)", async () => {
		const opts = makeOpts()
		opts.pickFile.mockResolvedValue(null)
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "old.json", backup: {}, type: "plain", profileType: "password" }
		await c.pickBackupFile()
		expect(c.selectedBackup.value).toBeNull()
	})

	it("a plain pick publishes the SANITIZED embedded name and clears the password fields", async () => {
		const opts = makeOpts()
		const body = JSON.stringify({ data: { profile: { name: "Nice\u202Ename", type: "password" } } })
		opts.pickFile.mockResolvedValue(new File([body], "b.json", { type: "application/json" }))
		const c = useFullBackupImport(opts)
		c.decryptionPassword.value = "leftover"
		await c.pickBackupFile()
		expect(c.parsedBackupName.value).toBe("Nicename")
		expect(opts.password.value).toBe("")
		expect(c.decryptionPassword.value).toBe("")
		expect(opts.clearError).toHaveBeenCalled()
	})

	it("a throwing pick surfaces the read-failure copy", async () => {
		const opts = makeOpts()
		opts.pickFile.mockRejectedValue(new Error("io"))
		const c = useFullBackupImport(opts)
		await c.pickBackupFile()
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Failed to read the backup file")
	})

	it("decryptBackup: success replaces the selection, publishes the sanitized name; wrong password fills the exact copy", async () => {
		const inner = { data: { profile: { type: "password", name: "Enc\u200bName" } } }
		const key = await EncryptionKey.fromPassword("pw12345678")
		const sealed = Buffer.from(await key.encrypt(new TextEncoder().encode(JSON.stringify(inner)))).toString("base64")
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.selectedBackup.value = { name: "e.txt", backup: sealed, type: "encrypted", profileType: null }
		c.decryptionPassword.value = "wrong-password"
		await c.decryptBackup()
		expect(opts.fillError).toHaveBeenCalledWith(
			"full_backup",
			"Decryption Failed",
			"The provided password is incorrect or the backup file is corrupted. Please try again with the correct password or select another file.",
		)

		c.decryptionPassword.value = "pw12345678"
		await c.decryptBackup()
		expect((c.selectedBackup.value?.backup as { data?: { profile?: { type?: string } } })?.data?.profile?.type).toBe("password")
		expect(c.selectedBackup.value?.profileType).toBe("password")
		expect(c.parsedBackupName.value).toBe("EncName")
	})

	it("sticky name: a nameless decrypt keeps the previously published name", async () => {
		const inner = { data: { profile: { type: "password" } } }
		const key = await EncryptionKey.fromPassword("pw12345678")
		const sealed = Buffer.from(await key.encrypt(new TextEncoder().encode(JSON.stringify(inner)))).toString("base64")
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		c.parsedBackupName.value = "Kept"
		c.selectedBackup.value = { name: "e.txt", backup: sealed, type: "encrypted", profileType: null }
		c.decryptionPassword.value = "pw12345678"
		await c.decryptBackup()
		expect(c.parsedBackupName.value).toBe("Kept")
	})
})

describe("epoch-4 passkey gates (codex impl-review pins)", () => {
	const CRED_ID = Buffer.from(new Uint8Array(16).fill(7)).toString("base64")

	async function passkeyBackup(mutate: (body: Record<string, unknown>) => void) {
		const base = await buildBackup({
			"master-key": CRED_ID,
			"imported-keys-dek-sealed": Buffer.from(new Uint8Array(48).fill(3)).toString("base64"),
			data: { profile: { id: "src-profile-id", name: "Imported", type: "passkey" } },
		})
		const { checksum: _c, entropy: _e, "imported-keys-dek": _dek, ...body } = base as Record<string, unknown>
		mutate(body)
		return { ...body, checksum: await EncryptionKey.getHashHex(JSON.stringify(body)) }
	}

	function mountPasskey(backup: unknown) {
		const runCeremony = vi.fn(async () => ({ credentialId: CRED_ID }) as never)
		const opts = { ...makeOpts({ password: "", repeatedPassword: "" }), runCeremony }
		const c = useFullBackupImport(opts as never)
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "passkey" }
		return { c, opts, runCeremony }
	}

	it("a passkey backup WITH an entropy field fails with the exact copy", async () => {
		const backup = await passkeyBackup((body) => {
			body.entropy = Buffer.from(new Uint8Array(32).fill(9)).toString("base64")
		})
		const { c, opts } = mountPasskey(backup)
		await c.restoreBackup()
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "A passkey backup must not carry an entropy field.")
		expect(c.restoreStatus.value).toBe("failed")
	})

	it("a passkey backup missing its sealed DEK fails with the exact copy", async () => {
		const backup = await passkeyBackup((body) => {
			body["imported-keys-dek-sealed"] = undefined
		})
		const { c, opts } = mountPasskey(backup)
		await c.restoreBackup()
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Can't import", "This backup is missing its imported-keys key.")
	})

	it("PERMISSIVENESS: a passkey backup with an EXTRA plain DEK still imports", async () => {
		happyWiring()
		const backup = await passkeyBackup((body) => {
			body["imported-keys-dek"] = Buffer.from(new Uint8Array(32).fill(2)).toString("base64")
		})
		const { c, opts, runCeremony } = mountPasskey(backup)
		await c.restoreBackup()
		expect(runCeremony).toHaveBeenCalledWith({ mode: "get", credentialId: CRED_ID })
		expect(c.restoreStatus.value).toBe("finished")
		expect(opts.fillError).not.toHaveBeenCalled()
	})
})

describe("decrypt publication race — the last await seam (codex impl-review HIGH)", () => {
	it("a re-pick landing between the helper's final fence and the caller's continuation is NOT overwritten", async () => {
		const inner = { data: { profile: { type: "password", name: "RaceName" } } }
		const key = await EncryptionKey.fromPassword("pw12345678")
		const sealed = Buffer.from(await key.encrypt(new TextEncoder().encode(JSON.stringify(inner)))).toString("base64")

		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const original = { name: "e.txt", backup: sealed, type: "encrypted" as const, profileType: null }
		const replacement = { name: "new.json", backup: {}, type: "plain" as const, profileType: "password" }
		c.selectedBackup.value = original
		c.decryptionPassword.value = "pw12345678"

		// Deterministic scheduling: wrap the real key's decrypt so the re-pick is queued AT
		// decrypt resolution. Microtask order is then [helper continuation (fence passes,
		// parse, return), re-pick, caller continuation] — landing the replacement exactly in
		// the seam between the helper's last internal fence and the caller's publication.
		const realFromPasshash = EncryptionKey.fromPasshash.bind(EncryptionKey)
		vi.spyOn(EncryptionKey, "fromPasshash").mockImplementation(async (passhash) => {
			const realKey = await realFromPasshash(passhash)
			return {
				decrypt: async (bytes: Uint8Array) => {
					const out = await realKey.decrypt(bytes as Uint8Array<ArrayBuffer>)
					queueMicrotask(() => {
						c.selectedBackup.value = replacement
					})
					return out
				},
			} as never
		})

		await c.decryptBackup()

		// The replacement selection must survive (structural: the ref stores a reactive
		// proxy of the assigned object); the decrypted publication must not land.
		expect(c.selectedBackup.value).toStrictEqual(replacement)
		expect(c.parsedBackupName.value).not.toBe("RaceName")
	})
})
