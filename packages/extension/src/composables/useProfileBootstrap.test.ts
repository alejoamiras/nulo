import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@/utils/core", () => {
	const profileMock = {
		getProfiles: vi.fn(async () => []),
		getActiveProfile: vi.fn(async () => null),
	}
	const networkMock = {
		disconnect: vi.fn(),
		getOrInitNetworks: vi.fn(async () => []),
		getActiveNetwork: vi.fn(async () => undefined),
		setActiveNetwork: vi.fn(async () => undefined),
	}
	const accountMock = {
		disconnect: vi.fn(),
		ensureDefaultAccount: vi.fn(async () => undefined),
		getAccounts: vi.fn(async () => []),
	}
	return {
		managers: {
			profile: profileMock,
			network: networkMock,
			account: accountMock,
		},
		initTransactionService: vi.fn(),
	}
})

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Arrow factories error: "() => ... is not a constructor".
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getOrInitNetworks: vi.fn(async () => [
				{ id: "n1", chainId: 1, kind: "testnet", endpoints: [{ id: "ep1", rpcUrl: "https://r.test" }] },
			]),
			getActiveNetwork: vi.fn(async () => ({
				id: "n1",
				chainId: 1,
				kind: "testnet",
				endpoints: [{ id: "ep1", rpcUrl: "https://r.test" }],
			})),
			setActiveNetwork: vi.fn(async () => undefined),
			// app.store.syncNetworkStatus fires fire-and-forget; provide a stub so
			// it resolves cleanly and doesn't show up as an unhandled rejection.
			getNodeStatus: vi.fn(async () => 0),
			getEndpointHealth: vi.fn(async () => ({ activeEndpointId: "ep1", failures: {}, cooldownUntil: {}, invalidChain: [] })),
			onPrimaryEndpointChanged: { add: vi.fn() },
			onPrimaryEndpointDegraded: { add: vi.fn() },
		}
	}),
	NodeStatus: { Online: 0 },
}))

vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			ensureDefaultAccount: vi.fn(async () => undefined),
			getAccounts: vi.fn(async () => [{ address: "0xacc1", index: 0, visible: true }]),
		}
	}),
	AccountType: { Nulo_v1: "Nulo_v1" },
}))

import { managers, initTransactionService } from "@/utils/core"
import { useAppStore } from "@/stores/app.store"
import { useProfileBootstrap } from "./useProfileBootstrap"

// app.store references `managers` as an auto-imported global at runtime
// (vite auto-import via src/utils/). In vitest the auto-import only covers
// vue + vue-router, so we mirror the symbol onto globalThis manually.
;(globalThis as { managers?: unknown }).managers = managers

const fakeProfile = { id: "prof-1", name: "Test", type: "password" as const } as never

beforeEach(() => {
	// Extend the global chrome stub from tests/vitest.setup.ts to include
	// the `storage.local` surface that useSyncedRef calls at store init.
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn((_key: string | string[], cb?: (result: Record<string, unknown>) => void) => {
					cb?.({})
					return Promise.resolve({})
				}),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: {
				addListener: vi.fn(),
				removeListener: vi.fn(),
			},
		},
		runtime: {
			connect: vi.fn(),
			onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	})
	setActivePinia(createPinia())
	vi.clearAllMocks()
	;(managers.profile.getProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([fakeProfile])
	;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(null)
})

describe("useProfileBootstrap", () => {
	test("bootstrapActiveProfile sets appStore.profile", async () => {
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		await bootstrapActiveProfile(fakeProfile)
		expect(appStore.profile).toEqual(fakeProfile)
	})

	test("bootstrapActiveProfile refreshes the profile list", async () => {
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		await bootstrapActiveProfile(fakeProfile)
		expect(managers.profile.getProfiles).toHaveBeenCalled()
		expect(appStore.profiles).toEqual([fakeProfile])
	})

	test("bootstrapActiveProfile wires the transaction service", async () => {
		const { bootstrapActiveProfile } = useProfileBootstrap()
		await bootstrapActiveProfile(fakeProfile)
		expect(initTransactionService).toHaveBeenCalled()
	})

	test("bootstrapActiveProfile flips isLogined to true at the end", async () => {
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		expect(appStore.isLogined).toBe(false)
		await bootstrapActiveProfile(fakeProfile)
		expect(appStore.isLogined).toBe(true)
	})

	test("hydrateKnownProfile returns null when no active profile exists", async () => {
		const { hydrateKnownProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		const result = await hydrateKnownProfile()
		expect(result).toBeNull()
		expect(appStore.isLogined).toBe(false)
	})

	test("hydrateKnownProfile bootstraps when an active profile exists", async () => {
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(fakeProfile)
		const { hydrateKnownProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		const result = await hydrateKnownProfile()
		expect(result).toEqual(fakeProfile)
		expect(appStore.profile).toEqual(fakeProfile)
		expect(appStore.isLogined).toBe(true)
		expect(appStore.isSessionChecked).toBe(true)
	})
})
