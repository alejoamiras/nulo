import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

// The fuel surface, with BRIDGE_FUEL CONFIGURED (the main spec runs with it undefined,
// which doubles as the toggle-off/legacy byte-identical pin).
const depositFn = vi.fn(async (_a: bigint, _p: boolean, _o?: { fuelSlice?: bigint }) => null)
const quoteFn = vi.fn(async (): Promise<bigint> => 487n * 10n ** 18n)

vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isSealTrusted: () => true,
	quoteFuelPath: (...args: unknown[]) => quoteFn(...(args as [])),
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: {
		router: "0xrouter",
		swapTarget: "0xswap",
		permit2: "0xpermit2",
		poolManager: "0xpm",
		quoter: "0xquoter",
		weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
		feeJuice: "0x762C132040fdA6183066Fa3B14d985ee55aA3C18",
		pools: { azloWeth: { fee: 500, tickSpacing: 10 }, ethFj: { fee: 987, tickSpacing: 10 } },
		slippageBps: 300,
		minFuelFj: 11n * 10n ** 18n,
	},
	L1_USDC: "0xA40A2FE147b7e96325d7c7D974B1f11C3ED82c68",
	BRIDGE_TOKEN: { toString: () => "0xtoken" },
	L1_PORTAL: "0xportal",
	BRIDGE: { toString: () => "0xbridge" },
	BRIDGE_TOKEN_SYMBOL: "AZLO",
	BRIDGE_TOKEN_DECIMALS: 18,
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr"), publicClient: {} }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useL1Usdc", () => ({
	useL1Usdc: () => ({
		balance: ref<bigint | null>(500n * 10n ** 18n),
		minting: ref(false),
		error: ref(null),
		refresh: vi.fn(),
		mint: vi.fn(),
	}),
}))
vi.mock("@/composables/useTokenBalance", () => ({
	useTokenBalance: () => ({
		publicBalance: ref<bigint | null>(200n * 10n ** 18n),
		privateBalance: ref<bigint | null>(50n * 10n ** 18n),
		loading: ref(false),
		error: ref(null),
		refresh: vi.fn(),
		dispose: vi.fn(),
	}),
}))
vi.mock("@/composables/useDeposit", () => ({
	useDepositFlow: () => ({ busy: ref(false), error: ref(null), deposit: depositFn }),
	providerFingerprint: () => "rabby",
}))
vi.mock("@/composables/useWithdraw", () => ({
	useWithdrawFlow: () => ({ busy: ref(false), error: ref(null), withdraw: vi.fn(async () => null) }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeForm from "./BridgeForm.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const settleQuote = async () => {
	await new Promise((r) => setTimeout(r, 550))
	await flushPromises()
}

describe("BridgeForm fuel surface", () => {
	beforeEach(() => {
		depositFn.mockClear()
		quoteFn.mockReset().mockResolvedValue(487n * 10n ** 18n)
	})

	it("the toggle renders on the deposit direction and hides after a flip", async () => {
		const w = mount(BridgeForm)
		expect(w.find(sel(TESTIDS.bridgeFuelToggle)).exists()).toBe(true)
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeFuelToggle)).exists()).toBe(false)
	})

	it("toggling on quotes the prefilled slice and shows the FJ estimate", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		const quote = w.find(sel(TESTIDS.bridgeFuelQuote))
		expect(quote.attributes("data-state")).toBe("ok")
		expect(quote.text()).toMatch(/487/)
		expect(quote.text()).toMatch(/FJ gas/)
	})

	it("submit passes the fuel slice in base units; toggle-off passes none", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledTimes(1)
		expect(depositFn.mock.calls[0][2]).toMatchObject({ fuelSlice: 25n * 10n ** 16n })

		depositFn.mockClear()
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click") // off
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledTimes(1)
		expect((depositFn.mock.calls[0][2] as { fuelSlice?: bigint })?.fuelSlice).toBeUndefined()
	})

	it("a failing quote blocks submit with honest copy", async () => {
		quoteFn.mockRejectedValue(
			Object.assign(new Error("No route available through hop 1 right now."), { name: "QuoteUnavailableError" }),
		)
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		expect(w.find(sel(TESTIDS.bridgeFuelQuote)).attributes("data-state")).toBe("error")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).not.toHaveBeenCalled()
	})

	it("a quote below the configured floor blocks with increase-it copy (floor read from config)", async () => {
		quoteFn.mockResolvedValue(5n * 10n ** 18n) // below the mocked 11 FJ floor
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		expect(w.find(sel(TESTIDS.bridgeFuelQuote)).text()).toMatch(/too little gas/)
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).not.toHaveBeenCalled()
	})

	it("an oversize slice (> 1 AZLO) blocks with the pool-impact warning", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await w.find(sel(TESTIDS.bridgeFuelSlice)).setValue("2")
		await settleQuote()
		expect(w.text()).toMatch(/Max fuel is 1 AZLO/)
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).not.toHaveBeenCalled()
	})

	it("PRIVATE bridges CAN carry private gas (gas-follows-token): fuel offered under either preset", async () => {
		const w = mount(BridgeForm)
		// private is the DEFAULT preset now - the fuel toggle is offered (no "coming soon" block).
		expect(w.find(sel(TESTIDS.bridgeFuelToggle)).exists()).toBe(true)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		// switching to PUBLIC keeps fuel available.
		await w.find(sel(TESTIDS.bridgePresetPublic)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeFuelToggle)).exists()).toBe(true)
	})

	it("switching presets keeps fuel ON (no guard) and a private+fuel submit passes the slice", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFuelToggle)).trigger("click")
		await settleQuote()
		expect(w.find(sel(TESTIDS.bridgeFuelQuote)).exists()).toBe(true)
		// public→private round-trip: fuel stays configured (no stale-state reset / guard).
		await w.find(sel(TESTIDS.bridgePresetPublic)).trigger("click")
		await w.find(sel(TESTIDS.bridgePresetPrivate)).trigger("click")
		await settleQuote()
		expect(w.find(sel(TESTIDS.bridgeFuelQuote)).exists()).toBe(true)
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledTimes(1)
		// private (default) + fuel: the slice IS passed (gas-follows-token).
		expect(depositFn.mock.calls[0][1]).toBe(true)
		expect((depositFn.mock.calls[0][2] as { fuelSlice?: bigint })?.fuelSlice).toBe(25n * 10n ** 16n)
	})
})
