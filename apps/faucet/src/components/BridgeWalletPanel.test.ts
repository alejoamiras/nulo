import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const status = ref("idle")
const verificationEmojis = ref<string | null>(null)
const selectedAccount = ref<string | null>(null)
const error = ref<{ message: string } | null>(null)
const preferredWalletName = ref<string | null>(null)
const autoReconnectDisabled = ref(false)
const connect = vi.fn()
const switchWallet = vi.fn()
const confirmVerification = vi.fn()
const cancelVerification = vi.fn()
const retryCapabilities = vi.fn()
const disconnect = vi.fn()
const accounts = ref<Array<{ address: string; alias: string }>>([])
const hiddenAccountsCount = ref(0)
const selectAccount = vi.fn(() => true)

vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({
		status,
		verificationEmojis,
		selectedAccount,
		error,
		preferredWalletName,
		autoReconnectDisabled,
		connect,
		switchWallet,
		confirmVerification,
		cancelVerification,
		retryCapabilities,
		disconnect,
		accounts,
		hiddenAccountsCount,
		selectAccount,
	}),
}))

// AccountSwitcher (inside the panel) reads the SAME session via useWalletConnection —
// mirror the mock so the suite stays hermetic (in prod both names return one singleton).
vi.mock("@/composables/useWalletConnection", () => ({
	useWalletConnection: () => ({
		status,
		verificationEmojis,
		selectedAccount,
		error,
		preferredWalletName,
		autoReconnectDisabled,
		connect,
		switchWallet,
		confirmVerification,
		cancelVerification,
		retryCapabilities,
		disconnect,
		accounts,
		hiddenAccountsCount,
		selectAccount,
	}),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeWalletPanel from "./BridgeWalletPanel.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("BridgeWalletPanel", () => {
	beforeEach(() => {
		status.value = "idle"
		selectedAccount.value = null
		error.value = null
		preferredWalletName.value = null
		autoReconnectDisabled.value = false
		verificationEmojis.value = null
		disconnect.mockClear()
		connect.mockClear()
		retryCapabilities.mockClear()
	})

	it("disconnected: shows the connect button, no account chip", () => {
		const w = mount(BridgeWalletPanel)
		expect(w.find(sel(TESTIDS.bridgeL2Connect)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.bridgeL2Account)).exists()).toBe(false)
	})

	it("connected: shows the account chip; Disconnect (in the menu) wires its handler", async () => {
		status.value = "connected"
		selectedAccount.value = `0x${"a".repeat(64)}`
		const w = mount(BridgeWalletPanel)
		expect(w.find(sel(TESTIDS.bridgeL2Account)).exists()).toBe(true)
		// Disconnect moved into the account menu — open it from the chip first.
		await w.find(sel(TESTIDS.accountChip)).trigger("click")
		await w.find(sel(TESTIDS.bridgeL2Disconnect)).trigger("click")
		expect(disconnect).toHaveBeenCalled()
	})

	// Guards the Phase-2 .capability div -> <Flex> class-preserving swap: the copy must survive.
	it("capability-approval: the button morphs to the awaiting state", () => {
		status.value = "capability-approval"
		const w = mount(BridgeWalletPanel)
		expect(w.text()).toContain("Approve in your wallet")
	})
})
