import { describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { CHAIN_IDS } from "@/utils/chain-ids"
import type { PriceState } from "@/wallet/services/price/spec"
import TokenCard from "./TokenCard.vue"

// TokenCard imports useAppStore but never reads from it. The store body calls
// syncedRef which touches chrome.storage.local — not stubbed in vitest.setup.ts.
// Bypass by stubbing the module entirely.
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({}),
}))

// Controllable price feed: tests set `mockQuotes` before mounting.
let mockQuotes: PriceState = {}
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: new EventHandler(),
			onConnected: new EventHandler(),
			refreshIfStale: vi.fn().mockImplementation(async () => mockQuotes),
		}
	}),
}))

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Spinner: { template: '<i data-testid="stub-spinner" />' },
	RouterLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
}

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"

const tokenInfo = {
	id: 1,
	chainId: 1,
	contract: "0x1234",
	name: "Test Token",
	symbol: "TST",
	decimals: 18,
}

const factory = (overrides: Record<string, unknown> = {}, tokenOverrides: Record<string, unknown> = {}) => {
	const tokenBalance = {
		id: 42,
		token: { ...tokenInfo, ...tokenOverrides },
		account: "0xacct",
		publicBalance: "0",
		privateBalance: "0",
		updatedAt: 0,
		isUpdating: false,
		isMinting: false,
		...overrides,
	}
	return mount(TokenCard, {
		props: { tokenBalance } as never,
		global: { stubs: STUBS },
	})
}

describe("TokenCard", () => {
	test("updatedAt===0 renders the loading block (spinner + 'Loading balance…')", () => {
		mockQuotes = {}
		const w = factory()
		const loader = w.find('[data-testid="token-balance-loading"]')
		expect(loader.exists()).toBe(true)
		expect(loader.find('[data-testid="stub-spinner"]').exists()).toBe(true)
		expect(loader.text()).toContain("Loading balance")
		// And the misleading "0" amount column must not be rendered
		expect(w.text()).not.toMatch(/^0$/m)
	})

	test("updatedAt>0 with zero balances renders genuine '0' (not the loader)", () => {
		mockQuotes = {}
		const w = factory({ updatedAt: 1, publicBalance: "0", privateBalance: "0" })
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		expect(w.text()).toContain("0")
	})

	test("isUpdating after first sync keeps the real amount visible + shows the refreshing dot", () => {
		// The old pin here asserted isUpdating produced NO visual change (the
		// dead-branch era). Consciously replaced: a refresh in flight now shows a
		// pulsing dot beside the still-visible amount.
		mockQuotes = {}
		const w = factory({
			updatedAt: 1700_000_000_000,
			publicBalance: "5000000000000000000",
			privateBalance: "0",
			isUpdating: true,
		})
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		expect(w.find('[data-testid="token-balance-refreshing"]').exists()).toBe(true)
		// Total = 5 TST (decimals 18) — formatter renders as "5"
		expect(w.text()).toContain("5")
	})

	test("no refreshing dot when idle or during the initial sync", () => {
		mockQuotes = {}
		const idle = factory({ updatedAt: 1700_000_000_000, publicBalance: "0", privateBalance: "0" })
		expect(idle.find('[data-testid="token-balance-refreshing"]').exists()).toBe(false)
		const initial = factory({ updatedAt: 0, publicBalance: "0", privateBalance: "0", isUpdating: true })
		expect(initial.find('[data-testid="token-balance-refreshing"]').exists()).toBe(false)
		expect(initial.find('[data-testid="token-balance-loading"]').exists()).toBe(true)
	})

	test("a persisted syncFailure dims the last-known amount and says why", () => {
		mockQuotes = {}
		const w = factory({
			updatedAt: 1700_000_000_000,
			publicBalance: "5000000000000000000",
			privateBalance: "0",
			syncFailure: { at: 1700_000_000_001, message: "sim failed" },
		})
		const failed = w.find('[data-testid="token-balance-failed"]')
		expect(failed.exists()).toBe(true)
		expect(failed.text()).toContain("Couldn't refresh")
		// The last-known amount stays visible (dimmed, never blanked).
		expect(w.text()).toContain("5")
	})

	test("the failed caption yields to the refreshing dot while a retry is in flight", () => {
		mockQuotes = {}
		const w = factory({
			updatedAt: 1700_000_000_000,
			publicBalance: "5000000000000000000",
			privateBalance: "0",
			isUpdating: true,
			syncFailure: { at: 1700_000_000_001, message: "sim failed" },
		})
		expect(w.find('[data-testid="token-balance-failed"]').exists()).toBe(false)
		expect(w.find('[data-testid="token-balance-refreshing"]').exists()).toBe(true)
	})

	test("a FAILED first sync shows the failure, never an infinite loading spinner", () => {
		// A never-synced row (updatedAt 0) whose first projection failed used to
		// spin forever — the exact failed-vs-still-running ambiguity the
		// persisted record exists to close. The failed state wins the block.
		mockQuotes = {}
		const w = factory({ updatedAt: 0, publicBalance: "0", privateBalance: "0", syncFailure: { at: 1, message: "x" } })
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		expect(w.find('[data-testid="token-balance-failed"]').exists()).toBe(true)
	})

	test("B1: a priced token renders the holding's fiat line", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const w = factory(
			{ updatedAt: 1, privateBalance: (1_000n * 10n ** 6n).toString(), publicBalance: (250n * 10n ** 6n).toString() },
			{ chainId: CHAIN_IDS.MAINNET, contract: CUSD, decimals: 6, symbol: "cUSD" },
		)
		await flushPromises()
		const fiat = w.find('[data-testid="token-fiat"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $1,249.82")
	})

	test("B1: an unpriced token renders NO fiat element (no fake $0.00)", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const w = factory({ updatedAt: 1, publicBalance: "5000000000000000000" })
		await flushPromises()
		expect(w.find('[data-testid="token-fiat"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})

	test("B1: with an empty price state (kill-switch / offline) nothing fiat renders", async () => {
		mockQuotes = {}
		const w = factory(
			{ updatedAt: 1, publicBalance: (250n * 10n ** 6n).toString() },
			{ chainId: CHAIN_IDS.MAINNET, contract: CUSD, decimals: 6 },
		)
		await flushPromises()
		expect(w.find('[data-testid="token-fiat"]').exists()).toBe(false)
	})
})

describe("TokenCard — R5 layout (fiat left, dot split right)", () => {
	test("priced: fiat REPLACES the static PRIVATE/PUBLIC label in the left column", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const w = factory(
			{ updatedAt: 1, privateBalance: (1_000n * 10n ** 6n).toString(), publicBalance: (250n * 10n ** 6n).toString() },
			{ chainId: CHAIN_IDS.MAINNET, contract: CUSD, decimals: 6, symbol: "cUSD" },
		)
		await flushPromises()
		expect(w.find('[data-testid="token-fiat"]').exists()).toBe(true)
		expect(w.text()).not.toContain("PRIVATE / PUBLIC")
	})

	test("unpriced: the label survives (it keeps teaching the split)", async () => {
		mockQuotes = {}
		const w = factory({ updatedAt: 1, publicBalance: "5" })
		await flushPromises()
		expect(w.text()).toContain("PRIVATE / PUBLIC")
	})

	test("the split line renders both sides with the ●/○ dot marks", async () => {
		mockQuotes = {}
		const w = factory({ updatedAt: 1, privateBalance: (7n * 10n ** 18n).toString(), publicBalance: (3n * 10n ** 18n).toString() })
		await flushPromises()
		const dots = w.findAll('span[class*="split_dot"]')
		expect(dots.length).toBe(2)
		expect(w.text()).toContain("7")
		expect(w.text()).toContain("3")
	})
})

describe("TokenCard — §3 catching-up indicator", () => {
	const mountCard = (overrides: Record<string, unknown> = {}, backfilling = false, tokenOverrides: Record<string, unknown> = {}) => {
		const tokenBalance = {
			id: 42,
			token: { ...tokenInfo, ...tokenOverrides },
			account: "0xacct",
			publicBalance: "0",
			privateBalance: "0",
			updatedAt: 0,
			isUpdating: false,
			isMinting: false,
			...overrides,
		}
		return mount(TokenCard, { props: { tokenBalance, backfilling } as never, global: { stubs: STUBS } })
	}

	test("backfilling with a resolved balance → 'Catching up…' caption beside the still-visible balance", () => {
		mockQuotes = {}
		const w = mountCard({ updatedAt: 1, publicBalance: (5n * 10n ** 18n).toString() }, true)
		expect(w.find('[data-testid="token-catching-up"]').exists()).toBe(true)
		expect(w.text()).toContain("Catching up")
		// the balance is shown, NOT the loading block
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		expect(w.text()).toContain("5")
	})

	test("backfilling AND balance unresolved (updatedAt===0) → escalates to the shimmer, not the spinner", () => {
		mockQuotes = {}
		const w = mountCard({ updatedAt: 0 }, true)
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(true)
		expect(w.find('[data-testid="token-balance-shimmer"]').exists()).toBe(true)
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(false) // spinner escalated away
		expect(w.text()).toContain("Catching up")
	})

	test("NOT backfilling: no catching-up caption; updatedAt===0 keeps the plain spinner loader", () => {
		mockQuotes = {}
		const resolved = mountCard({ updatedAt: 1, publicBalance: "5" }, false)
		expect(resolved.find('[data-testid="token-catching-up"]').exists()).toBe(false)

		const loading = mountCard({ updatedAt: 0 }, false)
		expect(loading.find('[data-testid="token-balance-shimmer"]').exists()).toBe(false)
		expect(loading.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})
})
