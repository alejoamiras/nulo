import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const depositFn = vi.fn(async (_a: bigint, _p: boolean) => {})
const withdrawFn = vi.fn(async (_a: bigint, _p: boolean) => {})
const sealTrusted = vi.fn(() => false)
const l1Balance = ref<bigint | null>(500_000_000n)
const publicBalance = ref<bigint | null>(200_000_000n)
const privateBalance = ref<bigint | null>(50_000_000n)

vi.mock("@nulo/bridge-core", () => ({
	isSealTrusted: (...args: unknown[]) => sealTrusted(...(args as [])),
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_TOKEN: { toString: () => "0xtoken" },
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr") }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useL1Usdc", () => ({
	useL1Usdc: () => ({ balance: l1Balance, minting: ref(false), error: ref(null), refresh: vi.fn(), mint: vi.fn() }),
}))
vi.mock("@/composables/useTokenBalance", () => ({
	useTokenBalance: () => ({
		publicBalance,
		privateBalance,
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
	useWithdrawFlow: () => ({ busy: ref(false), error: ref(null), withdraw: withdrawFn }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeForm from "./BridgeForm.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("BridgeForm", () => {
	beforeEach(() => {
		depositFn.mockClear()
		withdrawFn.mockClear()
		sealTrusted.mockReturnValue(false)
		l1Balance.value = 500_000_000n
	})

	it("defaults to Ethereum→Aztec with both balances placed correctly", () => {
		const w = mount(BridgeForm)
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("ethereum")
		expect(w.find(sel(TESTIDS.bridgeTo)).attributes("data-chain")).toBe("aztec")
		expect(w.find(sel(TESTIDS.bridgeBalanceL1)).text()).toContain("500")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2)).text()).toContain("200")
		expect(w.find(sel(TESTIDS.bridgeSubmit)).text()).toContain("BRIDGE TO AZTEC")
	})

	it("flip swaps the chains, the balance positions, and the submit copy", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("aztec")
		expect(w.find(sel(TESTIDS.bridgeTo)).attributes("data-chain")).toBe("ethereum")
		expect(w.find(sel(TESTIDS.bridgeFrom)).find(sel(TESTIDS.bridgeBalanceL2)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.bridgeSubmit)).text()).toContain("BRIDGE TO ETHEREUM")
	})

	it("privacy ON switches the Aztec balance to private (data-privacy) and shows the bearer note", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgePrivacyToggle)).trigger("click")
		const l2 = w.find(sel(TESTIDS.bridgeBalanceL2))
		expect(l2.attributes("data-privacy")).toBe("private")
		expect(l2.text()).toContain("50")
		expect(w.find(sel(TESTIDS.bridgePrivacyNote)).text()).toMatch(/bearer credential/i)
	})

	it("the withdraw-direction privacy note explains there is no bearer secret", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		await w.find(sel(TESTIDS.bridgePrivacyToggle)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgePrivacyNote)).text()).toMatch(/no bearer secret/i)
	})

	it("seal note shows first-time copy on an untrusted wallet, trusted copy after", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgePrivacyToggle)).trigger("click")
		const note = w.find(sel(TESTIDS.bridgeSealNote))
		expect(note.attributes("data-first")).toBe("true")
		expect(note.text()).toMatch(/twice/i)

		sealTrusted.mockReturnValue(true)
		const w2 = mount(BridgeForm)
		await w2.find(sel(TESTIDS.bridgePrivacyToggle)).trigger("click")
		expect(w2.find(sel(TESTIDS.bridgeSealNote)).attributes("data-first")).toBe("false")
		expect(w2.find(sel(TESTIDS.bridgeSealNote)).text()).toMatch(/sign once/i)
	})

	it("submit threads (amount, isPrivate) to the right flow per direction", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("100")
		await w.find(sel(TESTIDS.bridgePrivacyToggle)).trigger("click")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledWith(100_000_000n, true)

		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("40")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(withdrawFn).toHaveBeenCalledWith(40_000_000n, true)
	})

	it("an amount over the From balance blocks submit with a validation error", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("9999")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).not.toHaveBeenCalled()
		expect(w.find(sel(TESTIDS.bridgeFormError)).text()).toMatch(/exceeds/i)
	})

	it("zero L1 balance shows the mint hint", async () => {
		l1Balance.value = 0n
		const w = mount(BridgeForm)
		expect(w.text()).toContain("mint some below")
	})
})
