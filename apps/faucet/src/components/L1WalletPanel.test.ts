import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const address = ref<string | null>(null)
const isConnected = ref(false)
const wrongChain = ref(false)
const isConnecting = ref(false)
const connect = vi.fn()
const disconnect = vi.fn()
const switchL1Network = vi.fn()

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ address, isConnected, wrongChain, isConnecting, connect, disconnect, switchL1Network }),
}))

import { TESTIDS } from "@/lib/testids"
import L1WalletPanel from "./L1WalletPanel.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("L1WalletPanel", () => {
	beforeEach(() => {
		address.value = null
		isConnected.value = false
		wrongChain.value = false
		isConnecting.value = false
		connect.mockClear()
		disconnect.mockClear()
		switchL1Network.mockClear()
	})

	it("disconnected: shows the connect button, no account chip", () => {
		const w = mount(L1WalletPanel)
		expect(w.find(sel(TESTIDS.l1Connect)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.l1Account)).exists()).toBe(false)
	})

	it("connected + wrong chain: shows account, switch, disconnect; wires their handlers", async () => {
		isConnected.value = true
		address.value = `0x${"b".repeat(40)}`
		wrongChain.value = true
		const w = mount(L1WalletPanel)
		expect(w.find(sel(TESTIDS.l1Account)).exists()).toBe(true)
		await w.find(sel(TESTIDS.l1SwitchChain)).trigger("click")
		expect(switchL1Network).toHaveBeenCalled()
		await w.find(sel(TESTIDS.l1Disconnect)).trigger("click")
		expect(disconnect).toHaveBeenCalled()
	})

	it("connected on the right chain: no switch-chain button", () => {
		isConnected.value = true
		address.value = `0x${"b".repeat(40)}`
		const w = mount(L1WalletPanel)
		expect(w.find(sel(TESTIDS.l1SwitchChain)).exists()).toBe(false)
	})
})
