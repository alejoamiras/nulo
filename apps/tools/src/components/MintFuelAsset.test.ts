import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const isConnected = ref(false)
const wrongChain = ref(false)
const connect = vi.fn()
const switchL1Network = vi.fn()
const minting = ref(false)
const mintError = ref<string | null>(null)
const mint = vi.fn()

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected, wrongChain, connect, switchL1Network }),
}))
vi.mock("@/composables/useL1FeeAsset", () => ({
	useL1FeeAsset: () => ({ minting, mintError, mint }),
}))

import { TESTIDS } from "@/lib/testids"
import MintFuelAsset from "./MintFuelAsset.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const btn = (w: ReturnType<typeof mount>) => w.find(sel(TESTIDS.fuelMintBtn))

describe("MintFuelAsset", () => {
	beforeEach(() => {
		isConnected.value = false
		wrongChain.value = false
		minting.value = false
		mintError.value = null
		connect.mockClear()
		switchL1Network.mockClear()
		mint.mockClear()
	})

	it("renders the mint card + button", () => {
		const w = mount(MintFuelAsset)
		expect(w.find(sel(TESTIDS.fuelMintCard)).exists()).toBe(true)
		expect(btn(w).exists()).toBe(true)
	})

	it("disconnected: prompts to connect and the click connects (no mint)", async () => {
		const w = mount(MintFuelAsset)
		expect(btn(w).text()).toMatch(/connect your ethereum wallet/i)
		await btn(w).trigger("click")
		expect(connect).toHaveBeenCalledTimes(1)
		expect(mint).not.toHaveBeenCalled()
	})

	it("wrong chain: prompts to switch and the click switches to Sepolia (no mint)", async () => {
		isConnected.value = true
		wrongChain.value = true
		const w = mount(MintFuelAsset)
		expect(btn(w).text()).toMatch(/switch to sepolia/i)
		await btn(w).trigger("click")
		expect(switchL1Network).toHaveBeenCalledTimes(1)
		expect(mint).not.toHaveBeenCalled()
	})

	it("connected on Sepolia: the click mints", async () => {
		isConnected.value = true
		const w = mount(MintFuelAsset)
		expect(btn(w).text()).toMatch(/mint test \$aztec/i)
		await btn(w).trigger("click")
		expect(mint).toHaveBeenCalledTimes(1)
	})

	it("minting: button is disabled and the status narrates", () => {
		isConnected.value = true
		minting.value = true
		const w = mount(MintFuelAsset)
		expect(btn(w).attributes("disabled")).toBeDefined()
		expect(w.find(sel(TESTIDS.fuelMintStatus)).text()).toMatch(/minting/i)
	})

	it("a mint error surfaces in the status line", () => {
		isConnected.value = true
		mintError.value = "Mint failed: rate limited"
		const w = mount(MintFuelAsset)
		expect(w.find(sel(TESTIDS.fuelMintStatus)).text()).toMatch(/rate limited/i)
	})
})
