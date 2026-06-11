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
import { EncryptionKey } from "@nulo/wallet-crypto"
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
	ProfileServiceClient: vi.fn(() => profileClient),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(() => networkClient),
}))
vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: vi.fn(() => accountClient),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(() => tokenClient),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(() => transactionClient),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(() => tokenBalanceClient),
}))
vi.mock("@/wallet/services/account-state/client", () => ({
	AccountStateServiceClient: vi.fn(() => accountStateClient),
}))
vi.mock("@/wallet/services/auth-registry/client", () => ({
	AuthRegistryServiceClient: vi.fn(() => authRegistryClient),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(() => fpcClient),
}))
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(() => contactClient),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(() => configClient),
}))

// Service-name modules pull in side-effecting validators when imported
// from the real client modules, so re-export the bare name constants.
vi.mock("@/wallet/services/account/spec", () => ({ ACCOUNT_SERVICE_NAME: "account" }))
vi.mock("@/wallet/services/account-state/spec", () => ({ ACCOUNT_STATE_SERVICE_NAME: "account-state" }))
vi.mock("@/wallet/services/auth-registry/spec", () => ({ AUTH_REGISTRY_SERVICE_NAME: "auth-registry" }))
vi.mock("@/wallet/services/config/spec", () => ({ CONFIG_SERVICE_NAME: "config" }))
vi.mock("@/wallet/services/contact/spec", () => ({ CONTACT_SERVICE_NAME: "contact" }))
vi.mock("@/wallet/services/fpc/spec", () => ({ FPC_SERVICE_NAME: "fpc" }))
vi.mock("@/wallet/services/network/spec", () => ({ NETWORK_SERVICE_NAME: "network" }))
vi.mock("@/wallet/services/token-balance/spec", () => ({ TOKEN_BALANCE_SERVICE_NAME: "token-balance" }))
vi.mock("@/wallet/services/token/spec", () => ({ TOKEN_SERVICE_NAME: "token" }))
vi.mock("@/wallet/services/transaction/spec", () => ({ TRANSACTION_SERVICE_NAME: "transaction" }))

// Imported AFTER mocks are registered.
import { useFullBackupImport } from "./useFullBackupImport"

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a backup payload + matching checksum so the integrity guard passes. */
async function buildBackup(overrides: Record<string, unknown> = {}) {
	const body = {
		"schema-version": 2,
		"master-key": Buffer.from(new Uint8Array(32)).toString("base64"),
		data: {
			profile: { id: "src-profile-id", name: "Imported", type: "password" },
			network: [{ id: "src-net-1", name: "Testnet", rpcUrl: "https://t/", chainId: 1 }],
			account: [{ address: "0xaaaa" }],
			token: [],
			...((overrides.data as Record<string, unknown>) ?? {}),
		},
		...overrides,
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
	it("rejects schema-version != 2", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup({ "schema-version": 1 })
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Incompatible backup", expect.any(String))
		expect(profileClient.restore).not.toHaveBeenCalled()
	})

	it("rejects a tampered checksum", async () => {
		const opts = makeOpts()
		const c = useFullBackupImport(opts)
		const backup = await buildBackup()
		;(backup as { checksum: string }).checksum = "deadbeef"
		c.selectedBackup.value = { name: "x.json", backup, type: "plain", profileType: "password" }

		await c.restoreBackup()

		expect(c.restoreStatus.value).toBe("failed")
		expect(opts.fillError).toHaveBeenCalledWith("full_backup", "Backup Integrity Check Failed", expect.any(String))
		expect(profileClient.restore).not.toHaveBeenCalled()
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

	it("non-duplicate account failure re-throws into the outer catch (no half-restore)", async () => {
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
	const PASSKEY_DATA = { id: PASSKEY_CRED_ID, prf: "AAAA", userHandle: "src-profile-id" }

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
			PASSKEY_CRED_ID,
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
