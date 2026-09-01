/**
 * Pre-extraction pins for the passkey-acquisition and wrong-password branches
 * of handleBackup — the stages the PR-b decomposition moves and the main
 * suite's password-path tests don't fix: silent ceremony cancel (agreement
 * gate reset, NO toast/navigation), acquisition failure (toast + back-nav),
 * and the wrong-password flag on the discriminated export. Scaffolding
 * mirrors full.test.ts (client modules mocked at the import level).
 */
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FullExportPage from "./full.vue"

function sliceClient() {
	return { backup: vi.fn(async (): Promise<unknown> => []), disconnect: vi.fn() }
}
const clients: Record<string, ReturnType<typeof sliceClient>> = {}
const named = (n: string) => {
	clients[n] = clients[n] ?? sliceClient()
	return clients[n]
}

vi.mock("@/wallet/services/profile/client", () => ({
	PROFILE_SERVICE_NAME: "profile",
	ProfileServiceClient: vi.fn(function () {
		return named("profile")
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NETWORK_SERVICE_NAME: "network",
	NetworkServiceClient: vi.fn(function () {
		return named("network")
	}),
}))
vi.mock("@/wallet/services/account/client", () => ({
	ACCOUNT_SERVICE_NAME: "account",
	IMPORTED_KEYS_SERVICE_NAME: "imported-account-keys",
	AccountServiceClient: vi.fn(function () {
		return { ...named("account"), backupImportedKeys: vi.fn(async () => []) }
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TRANSACTION_SERVICE_NAME: "transaction",
	TransactionServiceClient: vi.fn(function () {
		return named("transaction")
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TOKEN_SERVICE_NAME: "token",
	TokenServiceClient: vi.fn(function () {
		return named("token")
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TOKEN_BALANCE_SERVICE_NAME: "token-balance",
	TokenBalanceServiceClient: vi.fn(function () {
		return named("token-balance")
	}),
}))
vi.mock("@/wallet/services/account-state/client", () => ({
	ACCOUNT_STATE_SERVICE_NAME: "account-state",
	AccountStateServiceClient: vi.fn(function () {
		return named("account-state")
	}),
}))
vi.mock("@/wallet/services/auth-registry/client", () => ({
	AUTH_REGISTRY_SERVICE_NAME: "auth-registry",
	AuthRegistryServiceClient: vi.fn(function () {
		return named("auth-registry")
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FPC_SERVICE_NAME: "fpc",
	FpcServiceClient: vi.fn(function () {
		return named("fpc")
	}),
}))
vi.mock("@/wallet/services/contact/client", () => ({
	CONTACT_SERVICE_NAME: "contact",
	ContactServiceClient: vi.fn(function () {
		return named("contact")
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	CONFIG_SERVICE_NAME: "config",
	ConfigServiceClient: vi.fn(function () {
		return named("config")
	}),
}))

const exportBackupMaterial = vi.fn<(profileId: string, password: string) => Promise<unknown>>()
const getPasskeyCredentialId = vi.fn(async () => "cred-1")
const exportPlain = vi.fn(async () => "mk")
const getProfileDekSealed = vi.fn(async () => "sealed")
vi.mock("@/utils/core", () => ({
	managers: {
		profile: {
			exportBackupMaterial: (profileId: string, password: string) => exportBackupMaterial(profileId, password),
			getPasskeyCredentialId: (id: string) => getPasskeyCredentialId(id),
			exportPlain: (...args: unknown[]) => exportPlain(...(args as [])),
			getProfileDekSealed: (id: string) => getProfileDekSealed(id),
		},
	},
}))

const openToast = vi.fn()
vi.mock("@/composables/toast.js", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	useToast: () => ({ openToast }),
}))

const routerGo = vi.fn()
vi.mock("vue-router", () => ({
	useRouter: () => ({ go: routerGo, push: vi.fn() }),
}))

const runCeremony = vi.fn<() => Promise<unknown>>()
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({
		request: { value: null },
		runCeremony: (...args: unknown[]) => runCeremony(...(args as [])),
		onResolve: vi.fn(),
		onReject: vi.fn(),
	}),
}))

beforeEach(() => {
	const c = (globalThis as { chrome?: { storage: Record<string, unknown> } }).chrome
	if (c) {
		c.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
		c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
	}
	vi.clearAllMocks()
})

function mountPage(profileType: "passkey" | "password") {
	return mount(FullExportPage, {
		global: {
			plugins: [
				createTestingPinia({
					initialState: {
						app: { profile: { id: "p1", type: profileType, name: "Test Profile" }, network: { id: "net1" } },
					},
					stubActions: false,
				}),
			],
			stubs: {
				CollapsingHeroLayout: { template: "<div><slot /><slot name='bottom' /></div>" },
				SecretUnlockSection: {
					props: ["modelValue", "error"],
					emits: ["update:modelValue", "clearError"],
					template:
						"<input data-testid='unlock-password-input' :data-error='String(!!error)' :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />",
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

describe("export/full.vue — passkey acquisition + wrong-password pins", () => {
	it("ceremony cancel is SILENT: agreement gate resets, no toast, no navigation", async () => {
		runCeremony.mockRejectedValueOnce(new UserRejectedError("user cancelled"))
		const wrapper = mountPage("passkey")
		await wrapper.find("[data-testid='agree-continue-btn']").trigger("click")
		await flushPromises()
		// The agree CTA is back (isAgreed reset) so the user can retry or leave.
		expect(wrapper.find("[data-testid='agree-continue-btn']").exists()).toBe(true)
		expect(openToast).not.toHaveBeenCalled()
		expect(routerGo).not.toHaveBeenCalled()
		expect(exportPlain).not.toHaveBeenCalled()
	})

	it("ceremony failure toasts the generic passkey copy and navigates back", async () => {
		runCeremony.mockRejectedValueOnce(new Error("authenticator exploded"))
		const wrapper = mountPage("passkey")
		await wrapper.find("[data-testid='agree-continue-btn']").trigger("click")
		await flushPromises()
		expect(openToast).toHaveBeenCalledWith({ label: "Failed to authenticate by passkey", icon: "warning" }, expect.anything())
		expect(routerGo).toHaveBeenCalledWith(-1)
		expect(exportPlain).not.toHaveBeenCalled()
	})

	it("a failed discriminated export on a password profile flags wrong-password, no toast/navigation", async () => {
		exportBackupMaterial.mockRejectedValueOnce(new Error("Invalid profile old password"))
		const wrapper = mountPage("password")
		await wrapper.find("[data-testid='agree-continue-btn']").trigger("click")
		await wrapper.find("[data-testid='unlock-password-input']").setValue("wrong")
		await wrapper.find("[data-testid='unlock-submit-btn']").trigger("click")
		await flushPromises()
		expect(wrapper.find("[data-testid='unlock-password-input']").attributes("data-error")).toBe("true")
		expect(openToast).not.toHaveBeenCalled()
		expect(routerGo).not.toHaveBeenCalled()
	})
})
