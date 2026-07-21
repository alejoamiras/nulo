import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const status = ref("idle")
const verificationEmojis = ref<string | null>(null)
const selectedAccount = ref<string | null>(null)
const error = ref<{ message: string } | null>(null)
const preferredWalletName = ref<string | null>(null)
const connect = vi.fn()
const switchWallet = vi.fn()
const confirmVerification = vi.fn()
const cancelVerification = vi.fn()
const retryCapabilities = vi.fn()
const disconnect = vi.fn()

vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({
		status,
		verificationEmojis,
		selectedAccount,
		error,
		preferredWalletName,
		connect,
		switchWallet,
		confirmVerification,
		cancelVerification,
		retryCapabilities,
		disconnect,
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

	it("connected: shows the account chip + disconnect wires its handler", async () => {
		status.value = "connected"
		selectedAccount.value = `0x${"a".repeat(64)}`
		const w = mount(BridgeWalletPanel)
		expect(w.find(sel(TESTIDS.bridgeL2Account)).exists()).toBe(true)
		await w.find(sel(TESTIDS.bridgeL2Disconnect)).trigger("click")
		expect(disconnect).toHaveBeenCalled()
	})

	// Guards the Phase-2 .capability div -> <Flex> class-preserving swap: the copy must survive.
	it("capability-approval: renders the permissions copy in the (Flex-wrapped) block", () => {
		status.value = "capability-approval"
		const w = mount(BridgeWalletPanel)
		expect(w.text()).toMatch(/approve the bridge's permissions/i)
	})
})
