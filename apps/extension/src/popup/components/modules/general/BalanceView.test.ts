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

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
// tok-1 is price-mapped (mainnet cUSD); tok-2 is deliberately unmapped.
const SEED = [
	{
		id: "b1",
		account: "0xacct",
		token: { id: "tok-1", symbol: "AAA", decimals: 6, chainId: CHAIN_IDS.MAINNET, contract: CUSD },
		publicBalance: (250n * 10n ** 6n).toString(),
		privateBalance: (1_000n * 10n ** 6n).toString(),
	},
	{
		id: "b2",
		account: "0xacct",
		token: { id: "tok-2", symbol: "BBB", decimals: 18, chainId: 1, contract: "0xunmapped" },
		publicBalance: (5n * 10n ** 18n).toString(),
		privateBalance: "0",
	},
]

let seedRows: typeof SEED = SEED

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
			getTokenBalances: vi.fn().mockImplementation(async () => seedRows),
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

// Controllable fiat kill-switch for the S-A state-matrix cases.
let mockShowFiat = true
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onUpdate: { add: vi.fn(), remove: vi.fn() },
			getValue: vi.fn().mockImplementation(async () => mockShowFiat),
		}
	}),
}))

// Controllable price feed for the A1 fiat cases: tests set `mockQuotes`.
let mockQuotes: Record<string, unknown> = {}
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: { add: vi.fn(), remove: vi.fn() },
			onConnected: { add: vi.fn(), remove: vi.fn() },
			refreshIfStale: vi.fn().mockImplementation(async () => mockQuotes),
		}
	}),
}))

vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }
})

import { CHAIN_IDS } from "@/utils/chain-ids"
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
	mockQuotes = {}
	mockShowFiat = true
	seedRows = SEED
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

describe("BalanceView fiat (A1)", () => {
	const FRESH = () => ({
		"usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: Date.now(), providerUpdatedAt: null },
	})

	test("selected priced token shows the ≈ fiat secondary line", async () => {
		mockQuotes = FRESH()
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "tok-1"
		await flushPromises()

		const fiat = wrapper.find('[data-testid="balance-fiat"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $1,249.82") // (1,000 + 250) cUSD at $0.999857
	})

	test("selected UNPRICED token shows no fiat element at all", async () => {
		mockQuotes = FRESH()
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "tok-2"
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-fiat"]').exists()).toBe(false)
	})

	test("Account Value renders the REAL aggregate over priced tokens + partial label", async () => {
		mockQuotes = FRESH()
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		// Only tok-1 is priced → aggregate = its fiat value, flagged partial.
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,249.82")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})

	test("private-only aggregate sums only private sides", async () => {
		mockQuotes = FRESH()
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_private_balances"
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$999.86") // 1,000 cUSD private
	})

	test("no priced tokens → $0.00 with the 'priced assets only' caption, never an em-dash", async () => {
		mockQuotes = {}
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		const amount = wrapper.find('[data-testid="balance-amount"]').text()
		expect(amount).toContain("$0.00")
		expect(amount).not.toContain("—")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})
})

describe("BalanceView state matrix (S-A)", () => {
	test("EMPTY wallet (zero balances) → a truthful $0.00, not a dash", async () => {
		mockQuotes = {}
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		deletedHandler?.({ id: "b1", token: { id: "tok-1" } })
		deletedHandler?.({ id: "b2", token: { id: "tok-2" } })
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$0.00")
	})

	test("tokens held but none priced → $0.00 flagged partial (no em-dash)", async () => {
		mockQuotes = {}
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		const text = wrapper.find('[data-testid="balance-amount"]').text()
		expect(text).toContain("$0.00")
		expect(text).not.toContain("—")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})

	test("registered-but-EMPTY unpriced rows are $0.00 holdings, not a pricing gap (no em-dash)", async () => {
		mockQuotes = {}
		seedRows = [
			{
				id: "b9",
				account: "0xacct",
				token: { id: "tok-9", symbol: "ZZZ", decimals: 18, chainId: 1, contract: "0xunmapped9" },
				publicBalance: "0",
				privateBalance: "0",
			},
		]
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		const text = wrapper.find('[data-testid="balance-amount"]').text()
		expect(text).toContain("$0.00")
		expect(text).not.toContain("—")
	})

	test("a priced holding + an unpriced ZERO row is NOT 'partial' — zero rows are not holdings", async () => {
		mockQuotes = {
			"usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null },
		}
		seedRows = [
			SEED[0],
			{
				id: "b9",
				account: "0xacct",
				token: { id: "tok-9", symbol: "ZZZ", decimals: 18, chainId: 1, contract: "0xunmapped9" },
				publicBalance: "0",
				privateBalance: "0",
			},
		]
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,250.00")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(false)
	})

	test("fiat OFF + aggregate selected → the number slot is GONE (space reclaimed)", async () => {
		mockShowFiat = false
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "total_account_value"
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').exists()).toBe(false)
	})

	test("fiat OFF + a TOKEN selected → token display stays (explicit user pick)", async () => {
		mockShowFiat = false
		const { wrapper, appStore } = await mountView()
		appStore.displayOption = "tok-1"
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').exists()).toBe(true)
	})
})
