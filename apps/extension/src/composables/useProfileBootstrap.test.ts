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
	const managers = {
		profile: profileMock,
		network: networkMock,
		account: accountMock,
	}
	return {
		managers,
		// app.store reads the lazy clients via require*()/get*(). initNetworks/
		// initAccount REASSIGN `managers.network`/`.account` to the mocked
		// `new NetworkServiceClient()`/`new AccountServiceClient()` (which carry
		// getNodeStatus etc.), so these MUST read the CURRENT `managers.X` — close
		// over `managers`, not the original *Mock consts (matching the real impl).
		requireNetwork: () => managers.network,
		requireAccount: () => managers.account,
		getNetwork: () => managers.network,
		getAccount: () => managers.account,
		initTransactionService: vi.fn(),
	}
})

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Arrow factories error: "() => ... is not a constructor".
// Shared, reconfigurable network-client stub (defaults set in beforeEach) so tests can drive the
// no-active-pointer fallback path (getActiveNetwork → undefined, getPrimaryNetwork → X).
const netMock = vi.hoisted(() => ({
	disconnect: vi.fn(),
	getOrInitNetworks: vi.fn(),
	getActiveNetwork: vi.fn(),
	getPrimaryNetwork: vi.fn(),
	setActiveNetwork: vi.fn(),
	getNodeStatus: vi.fn(),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return netMock
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
import { CHAIN_IDS } from "@/utils/chain-ids"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { NetworkServiceClient } from "@/wallet/services/network/client"
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
	// Default network-client behavior (an ACTIVE pointer exists → no fallback); fallback tests override.
	netMock.getOrInitNetworks.mockResolvedValue([{ id: "n1", chainId: 1, kind: "testnet" }])
	netMock.getActiveNetwork.mockResolvedValue({ id: "n1", chainId: 1, kind: "testnet" })
	netMock.getPrimaryNetwork.mockResolvedValue(null)
	netMock.setActiveNetwork.mockResolvedValue(undefined)
	netMock.getNodeStatus.mockResolvedValue(0)
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

	test("initNetworks: no active pointer → falls back to the PRIMARY network, NOT hardcoded testnet", async () => {
		// An imported profile has no active-network pointer yet (item 1b restores it later).
		netMock.getActiveNetwork.mockResolvedValue(undefined)
		netMock.getOrInitNetworks.mockResolvedValue([
			{ id: "alpha", chainId: CHAIN_IDS.MAINNET, kind: "mainnet" },
			{ id: "tn", chainId: CHAIN_IDS.TESTNET, kind: "testnet" },
		])
		netMock.getPrimaryNetwork.mockResolvedValue({ id: "alpha", chainId: CHAIN_IDS.MAINNET, kind: "mainnet" })
		const { initNetworks } = useProfileBootstrap()
		const appStore = useAppStore()
		await initNetworks()
		expect(appStore.network?.id).toBe("alpha")
		expect(appStore.network?.kind).not.toBe("testnet")
		expect(netMock.getPrimaryNetwork).toHaveBeenCalled()
		expect(netMock.setActiveNetwork).toHaveBeenCalledWith("alpha")
	})

	test("initNetworks: no active pointer AND no primary present → falls back to networks[0]", async () => {
		// Documented edge: a backup where the user had deleted the primary network.
		netMock.getActiveNetwork.mockResolvedValue(undefined)
		netMock.getOrInitNetworks.mockResolvedValue([
			{ id: "tn", chainId: CHAIN_IDS.TESTNET, kind: "testnet" },
			{ id: "local", chainId: 0, kind: "local" },
		])
		netMock.getPrimaryNetwork.mockResolvedValue(null)
		const { initNetworks } = useProfileBootstrap()
		const appStore = useAppStore()
		await initNetworks()
		expect(appStore.network?.id).toBe("tn")
		expect(netMock.setActiveNetwork).toHaveBeenCalledWith("tn")
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

	test("(B-27) a concurrent bootstrap + hydrate for the same profile share ONE init (no client stomping)", async () => {
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(fakeProfile)
		// Hold initNetworks mid-flight so the second caller must JOIN the first run
		// rather than start its own network/account init that replaces the clients.
		let releaseNetworks!: () => void
		netMock.getOrInitNetworks.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseNetworks = () => resolve([{ id: "n1", chainId: 1, kind: "testnet" }])
				}),
		)

		const { bootstrapActiveProfile, hydrateKnownProfile } = useProfileBootstrap()
		const p1 = bootstrapActiveProfile(fakeProfile) // enters the core, awaits getOrInitNetworks
		await Promise.resolve()
		await Promise.resolve()
		const p2 = hydrateKnownProfile() // same profile → joins the in-flight core
		await Promise.resolve()

		releaseNetworks()
		await Promise.all([p1, p2])

		// Single-flighted: each shared client was constructed ONCE, not once per
		// caller (pre-fix, both ran initNetworks/initAccount and stomped the clients).
		expect(NetworkServiceClient).toHaveBeenCalledTimes(1)
		expect(AccountServiceClient).toHaveBeenCalledTimes(1)
	})

	test("(B-27) a superseded cross-profile bootstrap stops before running initAccount with stale state", async () => {
		const p2 = { id: "prof-2", name: "Second", type: "password" as const } as never
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(p2) // p2 wins

		// P1's initNetworks hangs; P2's resolves — so P2 (the later activation)
		// completes while P1 is still mid-init.
		let releaseP1Networks!: () => void
		netMock.getOrInitNetworks
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseP1Networks = () => resolve([{ id: "n1", chainId: 1, kind: "testnet" }])
					}),
			)
			.mockResolvedValue([{ id: "n2", chainId: 2, kind: "testnet" }])

		const { bootstrapActiveProfile } = useProfileBootstrap()
		const b1 = bootstrapActiveProfile(fakeProfile) // gen 1, hangs in initNetworks
		await Promise.resolve()
		await Promise.resolve()
		const b2 = bootstrapActiveProfile(p2) // gen 2 — supersedes P1
		await b2 // P2 completes: initNetworks + initAccount

		releaseP1Networks() // P1's initNetworks resolves → superseded → aborts before initAccount
		await b1

		// Only P2 constructed an account client. The superseded P1 stopped at the
		// fence and never ran initAccount with the now-stale profile/network.
		expect(AccountServiceClient).toHaveBeenCalledTimes(1)
	})

	test("bootstrapActiveProfile flips isLogined to true and returns true when its profile stays active", async () => {
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(fakeProfile)
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		expect(appStore.isLogined).toBe(false)
		const stillActive = await bootstrapActiveProfile(fakeProfile)
		expect(appStore.isLogined).toBe(true)
		expect(stillActive).toBe(true)
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

	// A lock right after a password change clears the active session while a stale
	// bootstrap is still running; that bootstrap must NOT resurrect isLogined afterward
	// (the lock must win). The end-guard re-reads the authoritative active profile
	// (getActiveProfile — serialized with lockActiveProfile under the profile service's
	// runExclusive) before the flip, and returns whether the profile is still active.
	test("bootstrapActiveProfile does not resurrect isLogined when the session was locked mid-bootstrap", async () => {
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue(null)
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		const stillActive = await bootstrapActiveProfile(fakeProfile)
		expect(appStore.isLogined).toBe(false)
		expect(stillActive).toBe(false)
	})

	test("bootstrapActiveProfile does not set isLogined when a different profile became active mid-bootstrap", async () => {
		;(managers.profile.getActiveProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
			id: "other",
			name: "Other",
			type: "password",
		} as never)
		const { bootstrapActiveProfile } = useProfileBootstrap()
		const appStore = useAppStore()
		const stillActive = await bootstrapActiveProfile(fakeProfile)
		expect(appStore.isLogined).toBe(false)
		expect(stillActive).toBe(false)
	})
})
