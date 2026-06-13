import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import { ref } from "vue"

// The production constants run AZLO/18 - this spec pins the parse path AT 18 decimals
// (the main BridgeForm spec keeps its 6-dec mock to exercise parameterization itself).
const depositFn = vi.fn(async (_a: bigint, _p: boolean, _o?: unknown) => null)

vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isSealTrusted: () => true,
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	L1_USDC: "0xl1token",
	BRIDGE_TOKEN: { toString: () => "0xtoken" },
	L1_PORTAL: "0xportal",
	BRIDGE: { toString: () => "0xbridge" },
	BRIDGE_TOKEN_SYMBOL: "AZLO",
	BRIDGE_TOKEN_DECIMALS: 18,
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr") }),
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

describe("BridgeForm at 18 decimals (AZLO)", () => {
	it("parses fractional input to exact 18-dec base units - no Number() precision loss", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("1.5")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledWith(1_500_000_000_000_000_000n, false, expect.anything())
	})

	it("renders 18-dec balances + the AZLO symbol", () => {
		const w = mount(BridgeForm)
		expect(w.find(sel(TESTIDS.bridgeBalanceL1)).text()).toContain("500.00 AZLO")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).text()).toContain("200.00 AZLO")
	})
})
