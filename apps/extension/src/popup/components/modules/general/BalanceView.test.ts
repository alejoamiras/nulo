/**
 * Pins the `onBalanceDeleted` ordering contract: the home view's display
 * selection must reset when the *currently displayed* token's balance is
 * deleted. `tokenToDisplay` is computed from `tokenBalances`, so the
 * selected-token check has to read the PRE-delete list. A regression that
 * filtered the list before the check left `displayOption` pointing at the
 * deleted token, sticking the home balance on a stale/blank selection — these
 * tests fail against that ordering.
 *
 * Mounted (not exercised via e2e) because the bug only manifests through the
 * computed's reactive recompute; the network suites never delete the displayed
 * balance, which is exactly why it slipped through.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { createTestingPinia } from "@pinia/testing"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// Captures the handler the component registers on onTokenBalanceDeleted so the
// test can drive a deletion directly.
let deletedHandler: ((tb: unknown) => void) | undefined
const noopEvent = { add: vi.fn(), remove: vi.fn() }

const SEED = [
	{ id: "b1", account: "0xacct", token: { id: "tok-1", symbol: "AAA", decimals: 18 }, publicBalance: "0", privateBalance: "0" },
	{ id: "b2", account: "0xacct", token: { id: "tok-2", symbol: "BBB", decimals: 18 }, publicBalance: "0", privateBalance: "0" },
]

vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenBalanceAdded: noopEvent,
			onTokenBalanceUpdated: noopEvent,
			onTokenBalanceDeleted: {
				add: vi.fn((fn: (tb: unknown) => void) => {
					deletedHandler = fn
				}),
				remove: vi.fn(),
			},
			getTokenBalances: vi.fn().mockResolvedValue(SEED),
			refreshTokenBalance: vi.fn(),
		}
	}),
}))

vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenDeleted: noopEvent }
	}),
}))

vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getTasks: vi.fn().mockResolvedValue([]),
			onTaskCreated: { add: vi.fn(), remove: vi.fn() },
			onTaskUpdated: { add: vi.fn(), remove: vi.fn() },
			onTaskDeleted: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))

vi.mock("@/wallet/services/task/spec", () => ({
	ContentKind: { Step: 0, BalanceUpdate: 1, TokenMint: 2, ExecuteOperation: 3, Transfer: 4, RevokeAuthwits: 5 },
}))

vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }
})

import { useAppStore } from "@/stores/app.store"
import BalanceView from "./BalanceView.vue"

async function mountView() {
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	// Set before mount so onMounted's migration reads valid profile/network/account.
	appStore.profile = { id: "p1" } as never
	appStore.network = { id: "n1" } as never
	appStore.account = { address: "0xacct" } as never
	appStore.displayOption = "total_account_value"

	const wrapper = mount(BalanceView, { shallow: true, global: { plugins: [pinia] } })
	await flushPromises()
	return { wrapper, appStore }
}

// The shared chrome stub (tests/vitest.setup.ts) leaves chrome.storage.local
// undefined; the real app store (useSyncedRef) and BalanceView's display-option
// load/save both touch it. Provide a minimal in-memory backing that supports
// both the callback (useSyncedRef) and promise (BalanceView) call styles.
beforeEach(() => {
	const backing: Record<string, unknown> = {}
	const local = {
		get(keys: string | string[] | undefined, cb?: (r: Record<string, unknown>) => void) {
			const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(backing)
			const result: Record<string, unknown> = {}
			for (const k of list) if (k in backing) result[k] = backing[k]
			if (cb) {
				cb(result)
				return undefined
			}
			return Promise.resolve(result)
		},
		set(items: Record<string, unknown>, cb?: () => void) {
			Object.assign(backing, items)
			if (cb) {
				cb()
				return undefined
			}
			return Promise.resolve()
		},
		remove(keys: string | string[], cb?: () => void) {
			for (const k of Array.isArray(keys) ? keys : [keys]) delete backing[k]
			if (cb) {
				cb()
				return undefined
			}
			return Promise.resolve()
		},
	}
	const g = globalThis as unknown as { chrome: Record<string, unknown> }
	g.chrome = {
		...g.chrome,
		storage: { local, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
	}
})

afterEach(() => {
	vi.clearAllMocks()
	deletedHandler = undefined
})

describe("BalanceView onBalanceDeleted", () => {
	test("deleting the displayed token's balance resets displayOption to total_account_value", async () => {
		const { appStore } = await mountView()
		appStore.displayOption = "tok-1"
		await flushPromises()

		expect(deletedHandler).toBeTypeOf("function")
		deletedHandler?.({ id: "b1", token: { id: "tok-1" } })

		expect(appStore.displayOption).toBe("total_account_value")
	})

	test("deleting a non-displayed balance leaves displayOption unchanged", async () => {
		const { appStore } = await mountView()
		appStore.displayOption = "tok-1"
		await flushPromises()

		deletedHandler?.({ id: "b2", token: { id: "tok-2" } })

		expect(appStore.displayOption).toBe("tok-1")
	})
})
