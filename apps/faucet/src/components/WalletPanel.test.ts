import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TESTIDS } from "@/lib/testids"

// Mock the wallet-sdk and aztec node clients so importing the composable
// doesn't trip on missing browser-only globals.
vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: { configure: () => ({ getAvailableWallets: () => ({}) }) },
}))
vi.mock("@aztec/aztec.js/node", () => ({ createAztecNodeClient: () => ({ getContract: async () => null }) }))
vi.mock("@/lib/emoji", () => ({ hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤", toGrid: (s: string) => Array.from(s).slice(0, 9) }))
vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0x1" },
	USDC: { toString: () => "0x2" },
	ETH: { toString: () => "0x3" },
	rebuildDripperInstance: vi.fn(async () => ({ address: { toString: () => "0x1" } })),
	rebuildUsdcInstance: vi.fn(async () => ({ address: { toString: () => "0x2" } })),
	rebuildEthInstance: vi.fn(async () => ({ address: { toString: () => "0x3" } })),
}))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", () => ({ DripperContractArtifact: { name: "Dripper" } }))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({ TokenContractArtifact: { name: "Token" } }))

import { __resetWalletConnectionForTests, useWalletConnection } from "@/composables/useWalletConnection"
import WalletPanel from "./WalletPanel.vue"

describe("WalletPanel", () => {
	beforeEach(() => {
		__resetWalletConnectionForTests()
	})
	afterEach(() => {
		__resetWalletConnectionForTests()
	})

	it("idle: shows 'Connect wallet' button", () => {
		const w = mount(WalletPanel)
		const btn = w.get(`[data-testid="${TESTIDS.btnConnect}"]`)
		expect(btn.text()).toBe("Connect wallet")
	})

	it("idle with a remembered wallet: split button — 'Connect <name>' + picker caret", () => {
		const c = useWalletConnection()
		c.preferredWalletName.value = "Nulo"
		const w = mount(WalletPanel)
		const btn = w.get(`[data-testid="${TESTIDS.btnConnect}"]`)
		expect(btn.text()).toBe("Connect Nulo")
		const caret = w.get(`[data-testid="${TESTIDS.btnSwitchWallet}"]`)
		expect(caret.attributes("aria-label")).toBe("Choose a different wallet")
	})

	it("discovering: button label becomes 'Searching for wallet…' and is loading", async () => {
		const c = useWalletConnection()
		c.status.value = "discovering"
		const w = mount(WalletPanel)
		const btn = w.get(`[data-testid="${TESTIDS.btnConnect}"]`)
		expect(btn.text()).toContain("Searching for wallet")
		expect(btn.attributes("aria-busy")).toBe("true")
		// H2 (round-2 P7): the brutalist Button doesn't disable-on-loading, so the migration added an
		// explicit :disabled to this connect button — pin it so a press during discovery can't re-fire.
		expect(btn.attributes("disabled")).toBeDefined()
	})

	it("verifying: button label becomes 'Verify in wallet' and the modal mounts when emojis are set", async () => {
		const c = useWalletConnection()
		c.status.value = "verifying"
		c.verificationEmojis.value = "🟢🔵🟡🟣🔴⚪⚫🟠🟤"
		mount(WalletPanel, { attachTo: document.body })
		expect(document.querySelector(`[data-testid="${TESTIDS.verificationModal}"]`)).not.toBeNull()
	})

	it("capability-approval: the button morphs to the awaiting state in the same footprint", async () => {
		const c = useWalletConnection()
		c.status.value = "capability-approval"
		const w = mount(WalletPanel)
		expect(w.find(`[data-testid="${TESTIDS.capabilityApproval}"]`).exists()).toBe(true)
		const btn = w.get(`[data-testid="${TESTIDS.btnCapabilityRetry}"]`)
		expect(btn.text()).toContain("Approve in your wallet")
		expect(btn.attributes("aria-busy")).toBe("true")
	})

	it("capability-rejected (error state): denied retry button in the same footprint", async () => {
		const c = useWalletConnection()
		c.status.value = "error"
		c.error.value = { category: "capability-rejected", message: "x", raw: null }
		const w = mount(WalletPanel)
		const btn = w.get(`[data-testid="${TESTIDS.btnCapabilityRetry}"]`)
		expect(btn.text()).toContain("Permissions denied")
	})

	it("no-wallet (error state): shows install-Nulo CTA", async () => {
		const c = useWalletConnection()
		c.status.value = "error"
		c.error.value = { category: "no-wallet", message: "x", raw: null }
		const w = mount(WalletPanel)
		expect(w.text()).toContain("No Aztec wallet detected")
		expect(w.find(`[data-testid="${TESTIDS.btnInstallNulo}"]`).exists()).toBe(true)
	})

	it("connected: shows the selected account chip and a disconnect button", async () => {
		const c = useWalletConnection()
		c.status.value = "connected"
		c.selectedAccount.value = "0xa1b2c3d4e5f6"
		const w = mount(WalletPanel)
		// Connected chip mirrors BridgeWalletPanel: an "Aztec" label + the address + a ✕ disconnect.
		expect(w.text()).toContain("Aztec")
		expect(w.find(`[data-testid="${TESTIDS.account}"]`).exists()).toBe(true)
		expect(w.find(`[data-testid="${TESTIDS.btnDisconnect}"]`).exists()).toBe(true)
	})

	it("error (generic, non-capability, non-no-wallet): red retry button, message delegated to the strip", async () => {
		const c = useWalletConnection()
		c.status.value = "error"
		c.error.value = { category: "network", message: "Alpha-testnet is not responding. Try again.", raw: null }
		const w = mount(WalletPanel)
		const btn = w.get(`[data-testid="${TESTIDS.btnConnect}"]`)
		expect(btn.text()).toBe("Retry connection")
		expect(btn.classes()).toContain("denied")
		// The message itself now lives in ConnectionErrorStrip, above the panel row.
		expect(w.text()).not.toContain("Alpha-testnet is not responding")
	})
})
