/**
 * D2 gas-card fiat lines: `≈ $x.xx` under non-zero Fee Juice balances, only
 * when a usable AZTEC quote exists; zero balances and quoteless states render
 * token-only (no fake fiat).
 */

import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { PriceState } from "@/wallet/services/price/spec"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import GasBalanceCard from "./GasBalanceCard.vue"

// Reactive so tests can drive identity changes (the card's `scope` computed
// and the store's belt watcher both read it live).
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({
		profile: { id: "p1" },
		account: { address: "0xacct" },
		network: { id: "n1", chainId: 111 },
	})
	return { useAppStore: () => fake, __mockAppStore: fake }
})

async function appStoreMock() {
	const mod = (await import("@/stores/app.store")) as unknown as {
		__mockAppStore: { profile: { id: string }; account: { address: string }; network: { id: string; chainId: number } }
	}
	return mod.__mockAppStore
}

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

type Balances = { publicFeeJuice: string | null; privateFeeJuice: string | null }
let mockBalances: Balances = { publicFeeJuice: "0", privateFeeJuice: null }
let mockPeek: { balances: Balances; stale: boolean } | null = null
/** When set, peekGasBalances runs this instead of returning mockPeek. */
let mockPeekImpl: (() => Promise<{ balances: Balances; stale: boolean } | null>) | null = null
let mockGetGasBalances: () => Promise<Balances> = async () => mockBalances
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getGasBalances: vi.fn().mockImplementation(() => mockGetGasBalances()),
			peekGasBalances: vi.fn().mockImplementation(async () => (mockPeekImpl ? mockPeekImpl() : mockPeek)),
		}
	}),
}))

vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
			onTransactionUpdated: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))

vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), getFpcs: vi.fn(async () => []) }
	}),
}))

const STUBS = { Flex: { template: "<div><slot /></div>" } }
const AZTEC_FRESH = () => ({ aztec: { coingeckoId: "aztec", usd: 0.02, fetchedAt: Date.now(), providerUpdatedAt: null } })
/** Must mirror the mocked app.store identity — it is what the card's `scope` computed derives. */
const SCOPE = { profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xacct" }

beforeEach(async () => {
	vi.clearAllMocks()
	mockQuotes = {}
	mockBalances = { publicFeeJuice: "0", privateFeeJuice: null }
	mockPeek = null
	mockPeekImpl = null
	mockGetGasBalances = async () => mockBalances
	// The reactive mock persists across tests — reset the identity.
	const app = await appStoreMock()
	app.profile = { id: "p1" }
	app.account = { address: "0xacct" }
	app.network = { id: "n1", chainId: 111 }
})

/** Two tx-client instances exist per mount (the store's settle subscriber and
 *  the card's added subscriber) — find the one that registered `event`. */
function txHandlerFor(event: "onTransactionAdded" | "onTransactionUpdated"): (tx: unknown) => void {
	const results = vi.mocked(TransactionServiceClient).mock.results
	for (let i = results.length - 1; i >= 0; i--) {
		const inst = results[i].value as Record<string, { add: ReturnType<typeof vi.fn> }>
		const handler = inst[event].add.mock.calls[0]?.[0]
		if (handler) return handler as (tx: unknown) => void
	}
	throw new Error(`no TransactionServiceClient instance subscribed to ${event}`)
}

async function mountCard() {
	// A FRESH pinia is INJECTED per mount: `setActivePinia` in a beforeEach
	// does not isolate here (the SFC's transform chain resolves a different
	// pinia module copy than this file's import, so the active-pinia global
	// it writes is never the one the component reads — stores would silently
	// SHARE state across tests). The injected plugin wins inside the
	// component, and pinia re-points its own active-pinia to it during setup,
	// so post-mount `useBalancesStore()` calls in tests see the same instance.
	const w = mount(GasBalanceCard, { global: { stubs: STUBS, plugins: [createPinia()] } })
	await flushPromises()
	return w
}

describe("GasBalanceCard fiat (D2)", () => {
	test("non-zero public balance + usable quote → ≈ fiat line", async () => {
		mockQuotes = AZTEC_FRESH()
		mockBalances = { publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null }
		const w = await mountCard()
		const fiat = w.find('[data-testid="gas-fiat-public"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $0.84") // 42 FJ × $0.02
		expect(w.find('[data-testid="gas-fiat-private"]').exists()).toBe(false) // null → rendered as 0 → no fiat
	})

	test("private balance gets its own fiat line", async () => {
		mockQuotes = AZTEC_FRESH()
		mockBalances = { publicFeeJuice: "0", privateFeeJuice: (10n * 10n ** 18n).toString() }
		const w = await mountCard()
		expect(w.find('[data-testid="gas-fiat-public"]').exists()).toBe(false) // zero balance → no fiat
		expect(w.find('[data-testid="gas-fiat-private"]').text()).toBe("≈ $0.20")
	})

	test("no usable quote → token-only display, no fiat elements", async () => {
		mockQuotes = {}
		mockBalances = { publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: (1n * 10n ** 18n).toString() }
		const w = await mountCard()
		expect(w.find('[data-testid="gas-fiat-public"]').exists()).toBe(false)
		expect(w.find('[data-testid="gas-fiat-private"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})
})

describe("GasBalanceCard — 2-decimal display (home card)", () => {
	// The ONLY signal for the 4→2 change: every other fixture in this file is whole-FJ, where the
	// truncation width is invisible. Truncates (rounds down), so shown ≤ actual.
	test("a fractional balance truncates to 2 decimals", async () => {
		mockQuotes = {}
		// 42.1239 FJ → "42.12" (truncated, NOT rounded to 42.13)
		mockBalances = { publicFeeJuice: (421239n * 10n ** 14n).toString(), privateFeeJuice: (98765n * 10n ** 13n).toString() }
		const w = await mountCard()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42.12 FJ")
		// 0.98765 FJ → "0.98"
		expect(w.find('[data-testid="gas-balance-private"]').text()).toBe("0.98 FJ")
	})

	test("an exactly-2-decimal balance renders unchanged (boundary)", async () => {
		mockQuotes = {}
		mockBalances = { publicFeeJuice: (4212n * 10n ** 16n).toString(), privateFeeJuice: "0" }
		const w = await mountCard()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42.12 FJ")
		expect(w.find('[data-testid="gas-balance-private"]').text()).toBe("0 FJ")
	})
})

describe("GasBalanceCard — stale-while-revalidate", () => {
	function deferredBalances() {
		let resolve!: (v: Balances) => void
		mockGetGasBalances = () =>
			new Promise<Balances>((r) => {
				resolve = r
			})
		return { resolve: (v: Balances) => resolve(v) }
	}

	test("(BUG PIN) fresh peeked value paints instantly — no skeleton while the fetch round-trip is pending", async () => {
		mockQuotes = {}
		mockPeek = { balances: { publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null }, stale: false }
		const d = deferredBalances()
		const w = await mountCard()

		expect(w.find('[data-testid="gas-balance-public"]').exists()).toBe(true)
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		// Fresh cache — no refreshing indicator either.
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)

		// Cleanup only: settle the in-flight fetch so no real 20s timeout leaks.
		d.resolve({ publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null })
		await flushPromises()
	})

	test("(BUG PIN) stale peeked value shows dimmed last-known + refreshing marker until the refresh lands", async () => {
		mockQuotes = {}
		mockPeek = { balances: { publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null }, stale: true }
		const d = deferredBalances()
		const w = await mountCard()

		// Last-known value visible immediately, marked as refreshing.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(true)

		d.resolve({ publicFeeJuice: (43n * 10n ** 18n).toString(), privateFeeJuice: null })
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("43 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)
	})

	test("no cached value at all → skeleton until the first fetch resolves", async () => {
		mockQuotes = {}
		mockPeek = null
		const d = deferredBalances()
		const w = await mountCard()

		expect(w.find('[data-testid="gas-balance-public"]').exists()).toBe(false)

		d.resolve({ publicFeeJuice: (7n * 10n ** 18n).toString(), privateFeeJuice: null })
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("7 FJ")
	})

	test("a FAILED refresh keeps the stale dim but clears the activity dot — stale is never blessed fresh", async () => {
		mockQuotes = {}
		mockPeek = { balances: { publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null }, stale: true }
		mockGetGasBalances = async () => {
			throw new Error("SW unreachable")
		}
		const w = await mountCard()

		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		// The attempt settled: dot gone. The data did NOT refresh: dim stays.
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)
		// CSS-module class names are hashed — match by substring.
		const classes = w.find('[data-testid="gas-balance-public"]').classes()
		expect(classes.some((c) => c.includes("amount_stale"))).toBe(true)
	})

	test("a peek failure never blocks the real fetch", async () => {
		mockQuotes = {}
		let peekCalled = false
		mockGetGasBalances = async () => ({ publicFeeJuice: (9n * 10n ** 18n).toString(), privateFeeJuice: null })
		mockPeekImpl = async () => {
			peekCalled = true
			throw new Error("peek RPC failed")
		}
		try {
			const w = await mountCard()
			expect(peekCalled).toBe(true)
			expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("9 FJ")
		} finally {
			mockPeekImpl = null
		}
	})

	test("(BUG PIN) settled-tx forced refresh dims the value — never re-skeletons", async () => {
		mockQuotes = {}
		mockPeek = null
		mockGetGasBalances = async () => ({ publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null })
		const w = await mountCard()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")

		// Force-refresh path: a settled tx for this account, delivered via the
		// STORE's settle subscription (the card no longer owns that trigger).
		const d = deferredBalances()
		txHandlerFor("onTransactionUpdated")({ account: "0xacct", status: "Finalized" })
		await flushPromises()

		// Old value stays visible, dimmed (it is known-invalidated) with the
		// activity dot — never a skeleton.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(true)
		const midRefreshClasses = w.find('[data-testid="gas-balance-public"]').classes()
		expect(midRefreshClasses.some((c) => c.includes("amount_stale"))).toBe(true)

		d.resolve({ publicFeeJuice: (40n * 10n ** 18n).toString(), privateFeeJuice: null })
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)
	})
})

describe("GasBalanceCard — null public balance (unknown wire slot)", () => {
	test("a NULL public balance renders an em dash, never a confident zero", async () => {
		mockQuotes = {}
		mockGetGasBalances = async () => ({ publicFeeJuice: null, privateFeeJuice: null })
		const w = await mountCard()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("— FJ")
	})

	test("optimistic deduction is skipped on a NULL balance — no silent BigInt throw", async () => {
		// BigInt(null) throws; EventHandler swallows it, so pre-fix this was a
		// silent no-op regression on an entirely untested path.
		const { AccountFeePaymentMethodOptions } = await import("@aztec/entrypoints/account")
		mockQuotes = {}
		mockGetGasBalances = async () => ({ publicFeeJuice: null, privateFeeJuice: null })
		const w = await mountCard()

		txHandlerFor("onTransactionAdded")({
			account: "0xacct",
			estimatedFee: "1000",
			feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		})
		await flushPromises()
		// Still the honest unknown — not NaN, not a crash, not a fabricated number.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("— FJ")
	})
})

describe("GasBalanceCard — identity switch", () => {
	test("an account switch re-leases the store key, resets the overlay, and fetches the new identity", async () => {
		const { AccountFeePaymentMethodOptions } = await import("@aztec/entrypoints/account")
		mockQuotes = {}
		mockGetGasBalances = async () => ({ publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null })
		const w = await mountCard()
		// Seed a deduction overlay on the OLD identity.
		txHandlerFor("onTransactionAdded")({
			account: "0xacct",
			estimatedFee: (2n * 10n ** 18n).toString(),
			feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		})
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")

		mockGetGasBalances = async () => ({ publicFeeJuice: (10n * 10n ** 18n).toString(), privateFeeJuice: null })
		const app = await appStoreMock()
		app.account = { address: "0xother" }
		await flushPromises()
		// Fresh identity: overlay gone (10, not 8), value from a fresh ensure.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("10 FJ")
	})
})

describe("GasBalanceCard — optimistic-deduction overlay reset (D9)", () => {
	const FJ = (n: bigint) => ({ publicFeeJuice: (n * 10n ** 18n).toString(), privateFeeJuice: null })

	async function mountWithDeduction() {
		const { AccountFeePaymentMethodOptions } = await import("@aztec/entrypoints/account")
		const { useBalancesStore } = await import("@/stores/balances.store")
		mockQuotes = {}
		mockGetGasBalances = async () => FJ(42n)
		const w = await mountCard()
		txHandlerFor("onTransactionAdded")({
			account: "0xacct",
			estimatedFee: (2n * 10n ** 18n).toString(),
			feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		})
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")
		return { w, store: useBalancesStore() }
	}

	test("a generic (non-forced) refresh commit never clears the overlay", async () => {
		const { w, store } = await mountWithDeduction()
		// Same 42 re-committed via a plain ensure: gas.version bumps, forcedVersion does not.
		await store.ensure(SCOPE, { legs: ["gas"] })
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")
	})

	test("a FAILED forced refresh retains the overlay — only a successful forced commit clears it", async () => {
		const { w } = await mountWithDeduction()

		mockGetGasBalances = async () => {
			throw new Error("SW unreachable")
		}
		txHandlerFor("onTransactionUpdated")({ account: "0xacct", status: "Finalized" })
		await flushPromises()
		// Failure → no forcedVersion bump → the deducted last-known stays (dimmed).
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")

		mockGetGasBalances = async () => FJ(41n)
		txHandlerFor("onTransactionUpdated")({ account: "0xacct", status: "Finalized" })
		await flushPromises()
		// Success → forcedVersion bump → overlay reset: the real balance, undeducted.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("41 FJ")
	})
})
