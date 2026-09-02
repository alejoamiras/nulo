import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const isRegistered = vi.fn(async () => false)
const addTokenFn = vi.fn(async () => {})
const addStatus = ref<{ kind: string; error?: Error }>({ kind: "idle" })
const watchAsset = vi.fn(async (_req: unknown) => true)
const l1Connected = ref(true)
const pushToast = vi.fn()

vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	BRIDGE_TOKEN_SYMBOL: "AZLO",
	BRIDGE_TOKEN_DECIMALS: 18,
	BRIDGE_TOKEN: { toString: () => "0xtoken" },
	L1_USDC: "0xl1token",
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: l1Connected, ensureWalletClient: () => ({ watchAsset }) }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useAddDripToken", () => ({
	useAddDripToken: () => ({ isRegistered, addToken: addTokenFn, status: addStatus, reset: vi.fn() }),
}))
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ push: pushToast }) }))

import { TESTIDS } from "@/lib/testids"
import BridgeAddToken from "./BridgeAddToken.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("BridgeAddToken", () => {
	beforeEach(() => {
		isRegistered.mockReset().mockResolvedValue(false)
		watchAsset.mockClear().mockResolvedValue(true)
		addStatus.value = { kind: "idle" }
		pushToast.mockClear()
	})

	it("unregistered: the Aztec button is an enabled ADD action", async () => {
		const w = mount(BridgeAddToken)
		await flushPromises()
		const btn = w.find(sel(TESTIDS.bridgeAddToken))
		expect(btn.text()).toContain("Add AZLO to Aztec wallet")
		expect(btn.attributes("disabled")).toBeUndefined()
		expect(btn.attributes("data-add-status")).toBe("idle")
	})

	it("registered: the button STAYS visible as a disabled green check (the flex)", async () => {
		isRegistered.mockResolvedValue(true)
		const w = mount(BridgeAddToken)
		await flushPromises()
		const btn = w.find(sel(TESTIDS.bridgeAddToken))
		expect(btn.exists()).toBe(true)
		expect(btn.text()).toContain("AZLO in Aztec wallet ✓")
		expect(btn.attributes("disabled")).toBeDefined()
		expect(btn.classes()).toContain("checked")
		expect(btn.attributes("data-add-status")).toBe("registered")
	})

	it("a successful add flips the button into the checked state", async () => {
		addTokenFn.mockImplementation(async () => {
			addStatus.value = { kind: "ok" }
		})
		const w = mount(BridgeAddToken)
		await flushPromises()
		await w.find(sel(TESTIDS.bridgeAddToken)).trigger("click")
		await flushPromises()
		expect(w.find(sel(TESTIDS.bridgeAddToken)).text()).toContain("AZLO in Aztec wallet ✓")
	})

	it("EVM button calls watchAsset with the L1 token and hides after success", async () => {
		const w = mount(BridgeAddToken)
		await flushPromises()
		await w.find(sel(TESTIDS.bridgeAddTokenEvm)).trigger("click")
		await flushPromises()
		expect(watchAsset).toHaveBeenCalledWith({
			type: "ERC20",
			options: { address: "0xl1token", symbol: "AZLO", decimals: 18 },
		})
		expect(w.find(sel(TESTIDS.bridgeAddTokenEvm)).exists()).toBe(false)
	})

	it("EVM decline keeps the button and surfaces a toast (fail-open)", async () => {
		watchAsset.mockRejectedValue(new Error("user rejected"))
		const w = mount(BridgeAddToken)
		await flushPromises()
		await w.find(sel(TESTIDS.bridgeAddTokenEvm)).trigger("click")
		await flushPromises()
		expect(pushToast).toHaveBeenCalledWith({ kind: "error", text: "user rejected" })
		expect(w.find(sel(TESTIDS.bridgeAddTokenEvm)).exists()).toBe(true)
	})
})
