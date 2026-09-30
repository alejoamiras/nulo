import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const profileApi = vi.hoisted(() => ({
	getProfiles: vi.fn(async () => [] as Array<{ name: string }>),
	importMnemonic: vi.fn(async () => ({ id: "p1", name: "Main", type: "password" })),
}))
vi.mock("@/utils/core", () => ({ managers: { profile: profileApi } }))
const bootstrap = vi.hoisted(() => ({ bootstrapActiveProfile: vi.fn(), hydrateKnownProfile: vi.fn() }))
vi.mock("@/composables/useProfileBootstrap", () => ({ useProfileBootstrap: () => bootstrap }))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("vue-router", () => ({ useRouter: () => router, useRoute: () => ({ meta: {} }) }))
const importFlow = vi.hoisted(() => ({
	api: undefined as ReturnType<typeof import("@/composables/useProfileImportFlow").useProfileImportFlow> | undefined,
}))
const backupImport = vi.hoisted(() => ({
	api: undefined as ReturnType<typeof import("@/composables/useFullBackupImport").useFullBackupImport> | undefined,
}))
// The real composable, with a Retry that stays pending: reaching a retryable state for real
// takes a whole restore, which this page test does not own.
vi.mock("@/composables/useFullBackupImport", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@/composables/useFullBackupImport")>()
	const { computed, ref } = await import("vue")
	return {
		...mod,
		useFullBackupImport: (opts: Parameters<typeof mod.useFullBackupImport>[0]) => {
			const real = mod.useFullBackupImport(opts)
			const isRetryingAccountState = ref(false)
			backupImport.api = {
				...real,
				canRetryAccountState: computed(() => real.restoreStatus.value === "finished"),
				unrestoredNetworkNames: computed(() => (real.restoreStatus.value === "finished" ? ["Alpha V5"] : [])),
				hasOtherRestoreErrors: computed(() => false),
				isRetryingAccountState,
				retryAccountState: vi.fn(() => {
					isRetryingAccountState.value = true
					return new Promise<void>(() => {})
				}),
			}
			return backupImport.api
		},
	}
})
vi.mock("@/composables/useProfileImportFlow", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@/composables/useProfileImportFlow")>()
	return {
		...mod,
		useProfileImportFlow: (opts: Parameters<typeof mod.useProfileImportFlow>[0]) => {
			importFlow.api = mod.useProfileImportFlow(opts)
			return importFlow.api
		},
	}
})

import { BrutalistTitle, Flex, Input, Text } from "@nulo/design"
import { useToast } from "@/composables/toast"
import OnboardingProfileNameField from "../components/OnboardingProfileNameField.vue"
import Import from "./import.vue"

const wrappers: VueWrapper[] = []

async function mountImport() {
	const wrapper = mount(Import, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { BrutalistTitle, Flex, Input, OnboardingProfileNameField, Text },
			stubs: {
				OnboardingPage: { template: "<main><slot /></main>" },
				OnboardingBackLink: true,
				StepIndicator: true,
				ImportMethodPicker: true,
				PasskeyCeremonyDialog: true,
			},
		},
	})
	wrappers.push(wrapper)
	await flushPromises()
	return wrapper
}

const page = (w: VueWrapper) => w.get('[data-testid="onboarding-import-page"]')

beforeEach(() => {
	vi.clearAllMocks()
	profileApi.getProfiles.mockResolvedValue([])
	vi.stubGlobal("chrome", {
		storage: {
			local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})
afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
	vi.unstubAllGlobals()
})

describe("onboarding import", () => {
	test("a first-run import has no name field and reads Import / Wallet", async () => {
		const w = await mountImport()
		expect(page(w).attributes("data-name-field")).toBe("hidden")
		expect(w.find('[data-testid="onboarding-name-input"]').exists()).toBe(false)
		expect(w.text()).toContain("Import")
		expect(w.text()).toContain("Wallet")
		expect(w.text()).not.toContain("Profile")
		expect(w.text()).toContain("Restore from a recovery phrase, passkey, or full backup.")
	})

	test("with a profile already there, the field shows prefilled Profile 2", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Main" }])
		const w = await mountImport()
		expect(page(w).attributes("data-name-field")).toBe("shown")
		expect((w.get('[data-testid="onboarding-name-input"] input').element as HTMLInputElement).value).toBe("Profile 2")
	})

	// Onboarding is a web page, not the wallet: a finished import opens no snack there, while the
	// popup's import keeps its own.
	test.each([
		["activates", true],
		["is left locked", false],
	])("a phrase import that %s goes on to /onboarding/learn and opens no snack", async (_, activates) => {
		bootstrap.bootstrapActiveProfile.mockResolvedValue(activates)
		bootstrap.hydrateKnownProfile.mockResolvedValue(undefined)
		useToast().closeToast()
		await mountImport()
		const flow = importFlow.api!
		flow.seedPhrase.value = "abandon ".repeat(24).trim()
		flow.password.value = "password123"
		flow.repeatedPassword.value = "password123"

		await flow.handleImportSeed()

		expect(profileApi.importMnemonic).toHaveBeenCalledTimes(1)
		expect(router.push).toHaveBeenCalledWith("/onboarding/learn")
		expect(useToast().toast.value).toBeNull()
	})

	test("while a Retry runs it reads Retrying..., and Continue, View errors and Back are disabled", async () => {
		const w = await mountImport()
		importFlow.api!.selectedImportOption.value = "full_backup"
		const backup = backupImport.api!
		backup.restoreStatus.value = "finished"
		backup.restoreErrorLog.value = {
			"account-state": [
				{ networkId: "M2", senders: [], contracts: [], restoreError: "Skipped — ran out of time reaching the network" },
			],
		}
		await flushPromises()
		const button = (testid: string) => w.get(`[data-testid="${testid}"]`)
		const back = () => {
			const found = w.findAll("button").find((b) => b.text() === "Back to methods")
			if (!found) throw new Error("no Back to methods button")
			return found
		}
		expect(w.get('[data-testid="import-full-backup-warning"]').text()).toContain(
			"Alpha V5 didn't answer in time, so what was saved for it may not be restored. You can retry or continue.",
		)
		expect(button("import-full-backup-retry-btn").text()).toBe("Retry")
		expect(button("import-full-backup-continue-btn").attributes("disabled")).toBeUndefined()
		expect(back().attributes("disabled")).toBeUndefined()

		await button("import-full-backup-retry-btn").trigger("click")
		await flushPromises()

		expect(backup.retryAccountState).toHaveBeenCalledTimes(1)
		expect(button("import-full-backup-retry-btn").text()).toBe("Retrying...")
		expect(button("import-full-backup-continue-btn").attributes("disabled")).toBeDefined()
		expect(button("import-full-backup-view-errors-btn").attributes("disabled")).toBeDefined()
		expect(back().attributes("disabled")).toBeDefined()
	})

	test("Continue on the errors screen completes the imported profile and goes on to /onboarding/learn", async () => {
		bootstrap.bootstrapActiveProfile.mockResolvedValue(true)
		const w = await mountImport()
		importFlow.api!.selectedImportOption.value = "full_backup"
		const backup = backupImport.api!
		backup.importedProfile.value = { id: "p9", name: "Imported", type: "password" }
		backup.restoreStatus.value = "finished"
		backup.restoreErrorLog.value = {
			"account-state": [
				{ networkId: "M2", senders: [], contracts: [], restoreError: "Skipped — ran out of time reaching the network" },
			],
		}
		await flushPromises()

		await w.get('[data-testid="import-full-backup-continue-btn"]').trigger("click")
		await flushPromises()

		expect(bootstrap.bootstrapActiveProfile).toHaveBeenCalledWith({ id: "p9", name: "Imported", type: "password" })
		expect(router.push).toHaveBeenCalledWith("/onboarding/learn")
	})
})
