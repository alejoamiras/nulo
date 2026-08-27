import { EncryptionKey } from "@nulo/wallet-crypto"
import { MAX_BACKUP_FILE_BYTES } from "@/utils/full-backup-helpers"
import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FullExportPage from "./full.vue"

/**
 * Component pins for the export page's re-entry latch, error boundary, and
 * sealed-artifact contract. Client modules are mocked at the import level
 * (the useFullBackupImport.test.ts pattern); the assembler is REAL — the
 * single-execution proof counts the per-slice backup() calls through it.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function sliceClient() {
	return { backup: vi.fn(async (): Promise<unknown> => []), disconnect: vi.fn() }
}
let profileClient = sliceClient()
let networkClient = sliceClient()
let accountClient = { ...sliceClient(), backupImportedKeys: vi.fn(async (): Promise<unknown> => []) }
let transactionClient = sliceClient()
let tokenClient = sliceClient()
let tokenBalanceClient = sliceClient()
let accountStateClient = sliceClient()
let authRegistryClient = sliceClient()
let fpcClient = sliceClient()
let contactClient = sliceClient()
let configClient = sliceClient()

// Vitest requires `function` expressions for mocks instantiated with `new`.
vi.mock("@/wallet/services/profile/client", () => ({
	PROFILE_SERVICE_NAME: "profile",
	ProfileServiceClient: vi.fn(function () {
		return profileClient
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NETWORK_SERVICE_NAME: "network",
	NetworkServiceClient: vi.fn(function () {
		return networkClient
	}),
}))
vi.mock("@/wallet/services/account/client", () => ({
	ACCOUNT_SERVICE_NAME: "account",
	IMPORTED_KEYS_SERVICE_NAME: "imported-account-keys",
	AccountServiceClient: vi.fn(function () {
		return accountClient
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TRANSACTION_SERVICE_NAME: "transaction",
	TransactionServiceClient: vi.fn(function () {
		return transactionClient
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TOKEN_SERVICE_NAME: "token",
	TokenServiceClient: vi.fn(function () {
		return tokenClient
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TOKEN_BALANCE_SERVICE_NAME: "token-balance",
	TokenBalanceServiceClient: vi.fn(function () {
		return tokenBalanceClient
	}),
}))
vi.mock("@/wallet/services/account-state/client", () => ({
	ACCOUNT_STATE_SERVICE_NAME: "account-state",
	AccountStateServiceClient: vi.fn(function () {
		return accountStateClient
	}),
}))
vi.mock("@/wallet/services/auth-registry/client", () => ({
	AUTH_REGISTRY_SERVICE_NAME: "auth-registry",
	AuthRegistryServiceClient: vi.fn(function () {
		return authRegistryClient
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FPC_SERVICE_NAME: "fpc",
	FpcServiceClient: vi.fn(function () {
		return fpcClient
	}),
}))
vi.mock("@/wallet/services/contact/client", () => ({
	CONTACT_SERVICE_NAME: "contact",
	ContactServiceClient: vi.fn(function () {
		return contactClient
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	CONFIG_SERVICE_NAME: "config",
	ConfigServiceClient: vi.fn(function () {
		return configClient
	}),
}))

const exportBackupMaterial = vi.fn<(profileId: string, password: string) => Promise<unknown>>()
vi.mock("@/utils/core", () => ({
	managers: {
		profile: {
			exportBackupMaterial: (profileId: string, password: string) => exportBackupMaterial(profileId, password),
			getPasskeyCredentialId: vi.fn(async () => "cred"),
			exportPlain: vi.fn(async () => "mk"),
			getProfileDekSealed: vi.fn(async () => "sealed"),
		},
	},
}))

type DownloadArgs = { data: string; filename: string; mime?: string; saveAs?: boolean; compressionFormat?: string }
const downloadFile = vi.fn<(opts: DownloadArgs) => Promise<void>>(async () => undefined)
vi.mock("@/utils", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	downloadFile: (opts: DownloadArgs) => downloadFile(opts),
}))

const openToast = vi.fn()
vi.mock("@/composables/toast.js", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	useToast: () => ({ openToast }),
}))

// The global chrome stub exposes `storage: {}` only; the app store's synced
// refs read chrome.storage.local and subscribe to chrome.storage.onChanged,
// so flesh the stub out (this beforeEach runs after the setup file's).
beforeEach(() => {
	const c = (globalThis as { chrome?: { storage: Record<string, unknown> } }).chrome
	if (c) {
		c.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
		c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
	}
})

vi.mock("vue-router", () => ({
	useRouter: () => ({ go: vi.fn(), push: vi.fn() }),
}))

const allClients = () => [
	profileClient,
	networkClient,
	accountClient,
	transactionClient,
	tokenClient,
	tokenBalanceClient,
	accountStateClient,
	authRegistryClient,
	fpcClient,
	contactClient,
	configClient,
]

function mountPage() {
	return mount(FullExportPage, {
		global: {
			plugins: [
				createTestingPinia({
					initialState: {
						app: { profile: { id: "p1", type: "password", name: "Test Profile" }, network: { id: "net1" } },
					},
					stubActions: false,
				}),
			],
			stubs: {
				SecretExportLayout: {
					template: "<div><slot /><slot name='bottom' /></div>",
				},
				SecretUnlockSection: {
					props: ["modelValue", "error"],
					emits: ["update:modelValue", "clearError"],
					template:
						"<input data-testid='unlock-password-input' :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />",
				},
				PasskeyCeremonyDialog: true,
				Banner: { template: "<div><slot name='title' /><slot name='description' /></div>" },
				Flex: { template: "<div><slot /></div>" },
				Text: { template: "<span><slot /></span>" },
				Spinner: true,
				Input: true,
				Transition: false,
			},
		},
	})
}

async function reachUnlockAndSubmit(wrapper: ReturnType<typeof mountPage>) {
	await wrapper.find("[data-testid='agree-continue-btn']").trigger("click")
	await wrapper.find("[data-testid='unlock-password-input']").setValue("pw")
	await wrapper.find("[data-testid='unlock-submit-btn']").trigger("click")
}

const material = { masterKey: "mk", entropy: "ent", importedKeysDek: "dek" }

beforeEach(() => {
	vi.clearAllMocks()
	profileClient = sliceClient()
	networkClient = sliceClient()
	accountClient = { ...sliceClient(), backupImportedKeys: vi.fn(async (): Promise<unknown> => []) }
	transactionClient = sliceClient()
	tokenClient = sliceClient()
	tokenBalanceClient = sliceClient()
	accountStateClient = sliceClient()
	authRegistryClient = sliceClient()
	fpcClient = sliceClient()
	contactClient = sliceClient()
	configClient = sliceClient()
	exportBackupMaterial.mockReset()
	exportBackupMaterial.mockResolvedValue(material)
})

describe("export/full.vue — re-entry latch", () => {
	it("a second click and double Enter during the KDF window start nothing", async () => {
		const kdf = deferred<typeof material>()
		exportBackupMaterial.mockReturnValue(kdf.promise)
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)

		// Latch is closed while the KDF pends: the CTA has already unrendered
		// (status flipped synchronously — THAT is the click-side guard) and
		// double Enter is a no-op.
		const again = wrapper.find("[data-testid='unlock-submit-btn']")
		expect(again.exists()).toBe(false)
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		await flushPromises()
		expect(exportBackupMaterial).toHaveBeenCalledTimes(1)

		kdf.resolve(material)
		await vi.waitFor(() => expect(wrapper.find("[data-testid='protect-password-btn']").exists()).toBe(true))
		// Single execution end to end: every slice source ran exactly once.
		expect(profileClient.backup).toHaveBeenCalledTimes(1)
		expect(configClient.backup).toHaveBeenCalledTimes(1)
		expect(accountClient.backupImportedKeys).toHaveBeenCalledTimes(1)
	})

	it("Enter during 'progress' does not re-invoke; Enter during 'encrypting' does not re-invoke", async () => {
		const slice = deferred<unknown>()
		profileClient.backup.mockReturnValue(slice.promise)
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)
		await flushPromises()

		// In the slice loop now (status "progress"): Enter must be a no-op.
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		await flushPromises()
		expect(exportBackupMaterial).toHaveBeenCalledTimes(1)

		slice.resolve([])
		await vi.waitFor(() => expect(wrapper.find("[data-testid='protect-password-btn']").exists()).toBe(true))

		// Now "finished" → first Enter starts encryption (sync flip to
		// "encrypting"), second Enter must be a no-op.
		const passhashSpy = vi.spyOn(EncryptionKey, "getPasshash")
		const passhash = deferred<never>()
		passhashSpy.mockReturnValue(passhash.promise as never)
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		await flushPromises()
		expect(passhashSpy).toHaveBeenCalledTimes(1)
		passhash.reject(new Error("test done"))
		await flushPromises()
		passhashSpy.mockRestore()
	})
})

describe("export/full.vue — error boundary", () => {
	it("a slice failure resets to the unlock form, toasts, and disconnects every client", async () => {
		tokenClient.backup.mockRejectedValue(new Error("slice boom"))
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)
		await vi.waitFor(() =>
			expect(openToast).toHaveBeenCalledWith({ label: "Failed to create the backup", icon: "warning" }, expect.anything()),
		)
		// Recoverable: the create CTA is rendered again (status reset to "").
		await vi.waitFor(() => expect(wrapper.find("[data-testid='unlock-submit-btn']").exists()).toBe(true))
		// Every constructed client torn down. The account mock is shared by the
		// account slice AND the imported-keys adapter (both construct
		// AccountServiceClient), so it sees two disconnects.
		for (const c of allClients()) {
			expect(c.disconnect).toHaveBeenCalledTimes(c === accountClient ? 2 : 1)
		}

		// Retry succeeds with fresh per-run clients.
		tokenClient.backup.mockResolvedValue([])
		await wrapper.find("[data-testid='unlock-submit-btn']").trigger("click")
		await vi.waitFor(() => expect(wrapper.find("[data-testid='protect-password-btn']").exists()).toBe(true))
	})

	it("an oversized assembly fails loud instead of shipping an unimportable file", async () => {
		// One slice inflates the pretty output past the shared cap — symbolic
		// so the fixture tracks MAX_BACKUP_FILE_BYTES recalibrations. The real
		// assembler serializes the ~64 MiB payload, hence the long timeout.
		configClient.backup.mockResolvedValue(["x".repeat(MAX_BACKUP_FILE_BYTES + 2048)])
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)
		await vi.waitFor(
			() => expect(openToast).toHaveBeenCalledWith({ label: "Backup is too large to create", icon: "warning" }, expect.anything()),
			{ timeout: 30_000 },
		)
		await vi.waitFor(() => expect(wrapper.find("[data-testid='unlock-submit-btn']").exists()).toBe(true))
		expect(wrapper.find("[data-testid='download-backup-btn']").exists()).toBe(false)
	}, 45_000)

	it("unmount mid-run disconnects the run's clients and suppresses all late writes", async () => {
		const slice = deferred<unknown>()
		networkClient.backup.mockReturnValue(slice.promise)
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)
		await vi.waitFor(() => expect(networkClient.backup).toHaveBeenCalledTimes(1))

		wrapper.unmount()
		for (const c of allClients()) expect(c.disconnect).toHaveBeenCalled()

		// The pending slice settles after unmount: the fence keeps the run
		// silent — no toast, no error, no unhandled rejection.
		slice.resolve([])
		await flushPromises()
		expect(openToast).not.toHaveBeenCalled()
	})
})

describe("export/full.vue — sealed artifact", () => {
	it("the downloaded pretty file verifies against the import-side recompute", async () => {
		profileClient.backup.mockResolvedValue([{ id: "p1", type: "password" }])
		const wrapper = mountPage()
		await reachUnlockAndSubmit(wrapper)
		await vi.waitFor(() => expect(wrapper.find("[data-testid='protect-password-btn']").exists()).toBe(true))

		await wrapper.find("[data-testid='download-backup-btn']").trigger("click")
		await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1))
		const { data, filename } = downloadFile.mock.calls[0][0]
		expect(filename).toMatch(/^NuloBackup_/)

		// Exactly what the importer does with the downloaded file.
		const parsed = JSON.parse(data) as Record<string, unknown>
		const { checksum, ...body } = parsed
		expect(await EncryptionKey.getHashHex(JSON.stringify(body))).toBe(checksum)
		expect(parsed["master-key"]).toBe("mk")
		expect((parsed.data as Record<string, unknown>).profile).toEqual([{ id: "p1", type: "password" }])
		// The imported-keys slice key must be the registry's real literal — an
		// unknown key rejects the whole import.
		expect(Object.keys(parsed.data as Record<string, unknown>)).toContain("imported-account-keys")
	})
})
