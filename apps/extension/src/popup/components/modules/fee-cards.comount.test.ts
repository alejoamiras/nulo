/**
 * Co-mount composition: BOTH fee cards subscribed to the SAME store key in one
 * document — the home popup + an operation window shape. The per-card suites
 * mount one card each, so the cross-card arcs (a fee card's ensure JOINING the
 * gas card's failing forced flight; a forced success resetting the gas overlay
 * WITHOUT re-entering the fee card's committed snapshot) were store-unit-pinned
 * only. Here they run through the real components + the real shared store.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { createPinia } from "pinia"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import FeeSettingsCard from "./send/FeeSettingsCard.vue"
import GasBalanceCard from "./general/GasBalanceCard.vue"

const mocks = vi.hoisted(() => ({
	getGasBalances: vi.fn(),
	peekGasBalances: vi.fn(),
	getFpcs: vi.fn(),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getGasBalances: mocks.getGasBalances,
			peekGasBalances: mocks.peekGasBalances,
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return {
			onFpcDeleted: { add: vi.fn(), remove: vi.fn() },
			onFpcUpdated: { add: vi.fn(), remove: vi.fn() },
			connect: vi.fn(),
			disconnect: vi.fn(),
			getFpcs: mocks.getFpcs,
		}
	}),
	FpcType: { DefaultSponsoredFpc: 1, PrivateFpc: 2 },
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
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: new EventHandler(),
			onConnected: new EventHandler(),
			refreshIfStale: vi.fn(async () => ({})),
		}
	}),
}))
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({
		profile: { id: "p1" },
		account: { address: "0xacct" },
		network: { id: "n1", chainId: 11155111 },
	})
	return { useAppStore: () => fake }
})

const profile = { id: "p1", name: "Profile 1" }
const network = { id: "n1", chainId: 11155111 }
const account = { id: "a1", address: "0xacct" }

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i></i>" },
	FeeMethodSelector: {
		props: ["modelValue", "methods"],
		emits: ["update:modelValue", "open", "close"],
		template: '<div data-testid="fee-method-selector" />',
	},
	FeeMethodRow: { template: '<div data-testid="fee-method-row" />' },
	FeeCostReadout: { template: '<div data-testid="fee-cost-readout" />' },
	FeePriorityRow: { template: '<div data-testid="fee-priority-row" />' },
}

const FJ = (n: bigint) => ({ publicFeeJuice: (n * 10n ** 18n).toString(), privateFeeJuice: null })

function stubChromeStorage() {
	const backing: Record<string, unknown> = {}
	const local = {
		get: async (keys: string | string[] | null | undefined) => {
			const result: Record<string, unknown> = {}
			const list = keys == null ? Object.keys(backing) : Array.isArray(keys) ? keys : [keys]
			for (const k of list) if (k in backing) result[k] = backing[k]
			return result
		},
		set: async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) backing[k] = v
		},
	}
	// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
	;(globalThis as any).chrome = { ...(globalThis as any).chrome, storage: { local } }
}

/** Find the handler a specific tx event was registered with, newest first. */
function txHandlerFor(event: "onTransactionAdded" | "onTransactionUpdated"): (tx: unknown) => void {
	const results = vi.mocked(TransactionServiceClient).mock.results
	for (let i = results.length - 1; i >= 0; i--) {
		const inst = results[i].value as Record<string, { add: ReturnType<typeof vi.fn> }>
		const handler = inst[event].add.mock.calls[0]?.[0]
		if (handler) return handler as (tx: unknown) => void
	}
	throw new Error(`no TransactionServiceClient instance subscribed to ${event}`)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	stubChromeStorage()
	mocks.getGasBalances.mockReset().mockResolvedValue(FJ(42n))
	mocks.peekGasBalances.mockReset().mockResolvedValue(null)
	mocks.getFpcs.mockReset().mockResolvedValue([{ id: "s1", type: 1, name: "Sponsor" }])
})

afterEach(() => {
	vi.useRealTimers()
})

async function mountBoth() {
	// ONE pinia for both mounts: the cards must land on the SAME store.
	const pinia = createPinia()
	const gas = mount(GasBalanceCard, { global: { plugins: [pinia], stubs: STUBS } })
	const fee = mount(FeeSettingsCard, {
		props: { profile, network, account, feeEstimate: null, isEstimating: false, embedded: false },
		global: { plugins: [pinia], stubs: STUBS },
	})
	await vi.advanceTimersByTimeAsync(0)
	await flushPromises()
	return { gas, fee }
}

describe("fee cards co-mounted on one key", () => {
	test("a fee-card ensure joining the gas card's failing forced flight degrades WITH a live recovery", async () => {
		const { gas, fee } = await mountBoth()
		expect(gas.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		expect(fee.find('[data-testid="fee-init-degraded"]').exists()).toBe(false)

		// A settle fires the forced refresh; its raw flight will fail.
		let rejectRaw!: (e: unknown) => void
		mocks.getGasBalances.mockImplementationOnce(() => new Promise((_r, rej) => (rejectRaw = rej))).mockResolvedValue(FJ(43n))
		txHandlerFor("onTransactionUpdated")({ account: "0xacct", status: "Proven" })
		await vi.advanceTimersByTimeAsync(0)

		// The fee card's same-identity refire JOINS the in-flight forced run —
		// proven by count: mount fetch + forced fetch, and the refire adds NO
		// third gas RPC of its own.
		const gasCallsBeforeRefire = mocks.getGasBalances.mock.calls.length
		await fee.setProps({ profile: { ...profile } })
		await vi.advanceTimersByTimeAsync(0)
		expect(mocks.getGasBalances.mock.calls.length).toBe(gasCallsBeforeRefire)
		rejectRaw(new Error("SW unreachable"))
		await vi.advanceTimersByTimeAsync(0)
		await flushPromises()

		// Fee card: degraded notice up — and the loop must actually be running.
		expect(fee.find('[data-testid="fee-init-degraded"]').exists()).toBe(true)
		// Gas card: SWR keeps the last-known figure, dimmed (known-invalidated).
		expect(gas.find('[data-testid="gas-balance-public"]').text()).toBe("42 FJ")
		expect(
			gas
				.find('[data-testid="gas-balance-public"]')
				.classes()
				.some((c) => c.includes("amount_stale")),
		).toBe(true)

		// One backoff tick later the retry lands and the RECOVERY re-commits.
		await vi.advanceTimersByTimeAsync(5_050)
		await flushPromises()
		expect(fee.find('[data-testid="fee-init-degraded"]').exists()).toBe(false)
		expect(gas.find('[data-testid="gas-balance-public"]').text()).toBe("43 FJ")
		expect(
			gas
				.find('[data-testid="gas-balance-public"]')
				.classes()
				.some((c) => c.includes("amount_stale")),
		).toBe(false)
		gas.unmount()
		fee.unmount()
	})

	test("a forced success resets the gas overlay without re-entering the fee card's snapshot", async () => {
		const { AccountFeePaymentMethodOptions } = await import("@aztec/entrypoints/account")
		const { gas, fee } = await mountBoth()
		const feeEmits = (fee.emitted<unknown[]>("update:modelValue") ?? []).length
		expect(feeEmits).toBeGreaterThan(0) // the fee card committed (sponsored auto-select)

		// Seed the gas card's optimistic-deduction overlay.
		txHandlerFor("onTransactionAdded")({
			account: "0xacct",
			estimatedFee: (2n * 10n ** 18n).toString(),
			feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		})
		await flushPromises()
		expect(gas.find('[data-testid="gas-balance-public"]').text()).toBe("40 FJ")

		// Settle → forced refresh succeeds with the post-settle balance.
		mocks.getGasBalances.mockResolvedValue(FJ(44n))
		txHandlerFor("onTransactionUpdated")({ account: "0xacct", status: "Proven" })
		await vi.advanceTimersByTimeAsync(0)
		await flushPromises()

		// Overlay reset by forcedVersion: the REAL balance, undeducted.
		expect(gas.find('[data-testid="gas-balance-public"]').text()).toBe("44 FJ")
		// D4: the fee card's committed snapshot is untouched — no new emissions.
		expect((fee.emitted<unknown[]>("update:modelValue") ?? []).length).toBe(feeEmits)
		gas.unmount()
		fee.unmount()
	})
})
