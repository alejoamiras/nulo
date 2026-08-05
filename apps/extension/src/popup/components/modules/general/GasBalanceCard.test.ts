/**
 * D2 gas-card fiat lines: `≈ $x.xx` under non-zero Fee Juice balances, only
 * when a usable AZTEC quote exists; zero balances and quoteless states render
 * token-only (no fake fiat).
 */

import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { PriceState } from "@/wallet/services/price/spec"
import GasBalanceCard from "./GasBalanceCard.vue"

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ account: { address: "0xacct" }, network: { id: "n1" } }),
}))

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

type Balances = { publicFeeJuice: string; privateFeeJuice: string | null }
let mockBalances: Balances = { publicFeeJuice: "0", privateFeeJuice: null }
let mockPeek: { balances: Balances; stale: boolean } | null = null
let mockGetGasBalances: () => Promise<Balances> = async () => mockBalances
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getGasBalances: vi.fn().mockImplementation(() => mockGetGasBalances()),
			peekGasBalances: vi.fn().mockImplementation(async () => mockPeek),
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

const STUBS = { Flex: { template: "<div><slot /></div>" } }
const AZTEC_FRESH = () => ({ aztec: { coingeckoId: "aztec", usd: 0.02, fetchedAt: Date.now(), providerUpdatedAt: null } })

async function mountCard() {
	const w = mount(GasBalanceCard, { global: { stubs: STUBS } })
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
		deferredBalances()
		const w = await mountCard()

		expect(w.find('[data-testid="gas-balance-public"]').exists()).toBe(true)
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		// Fresh cache — no refreshing indicator either.
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)
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

	test("(BUG PIN) settled-tx forced refresh dims the value — never re-skeletons", async () => {
		const { TransactionServiceClient } = await import("@/wallet/services/transaction/client")
		mockQuotes = {}
		mockPeek = null
		mockGetGasBalances = async () => ({ publicFeeJuice: (42n * 10n ** 18n).toString(), privateFeeJuice: null })
		const w = await mountCard()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")

		// Force-refresh path: a settled tx for this account.
		const d = deferredBalances()
		const txInstances = vi.mocked(TransactionServiceClient).mock.results
		const txInstance = txInstances[txInstances.length - 1].value as {
			onTransactionUpdated: { add: ReturnType<typeof vi.fn> }
		}
		const handler = txInstance.onTransactionUpdated.add.mock.calls[0]?.[0] as (tx: unknown) => void
		handler({ account: "0xacct", status: "Finalized" })
		await flushPromises()

		// Old value stays visible (dimmed via the refreshing marker), no skeleton.
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(true)

		d.resolve({ publicFeeJuice: (40n * 10n ** 18n).toString(), privateFeeJuice: null })
		await flushPromises()
		expect(w.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")
		expect(w.find('[data-testid="gas-balance-refreshing"]').exists()).toBe(false)
	})
})
