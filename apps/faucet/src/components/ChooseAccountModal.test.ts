import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TESTIDS } from "@/lib/testids"

// Real-session harness (same SDK mocks as useWalletConnection.test.ts): the modal is driven
// through the ACTUAL choose-account pause, so Continue exercises the real single-use token,
// not a spied method.
const mockEstablishSecureChannel = vi.fn()
const mockGetAvailableWallets = vi.fn()

vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: { configure: vi.fn(() => ({ getAvailableWallets: mockGetAvailableWallets })) },
}))
vi.mock("@aztec/aztec.js/node", () => ({ createAztecNodeClient: () => ({ getContract: async () => null }) }))
vi.mock("@/lib/emoji", () => ({ hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤", toGrid: (s: string) => Array.from(s).slice(0, 9) }))
vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0x1" },
	NULO: { toString: () => "0x2" },
	OLUN: { toString: () => "0x3" },
	rebuildDripperInstance: vi.fn(async () => ({ address: { toString: () => "0x1" } })),
	rebuildNuloInstance: vi.fn(async () => ({ address: { toString: () => "0x2" } })),
	rebuildOlunInstance: vi.fn(async () => ({ address: { toString: () => "0x3" } })),
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	L1_USDC: "0xl1token",
	BRIDGE_TOKEN_SYMBOL: "USDC",
	BRIDGE_TOKEN_DECIMALS: 6,
	BRIDGE: { toString: () => "0x4" },
	BRIDGE_TOKEN: { toString: () => "0x5" },
	BRIDGE_PROXY: { toString: () => "0x6" },
	rebuildBridgeInstance: vi.fn(async () => ({ address: { toString: () => "0x4" } })),
	rebuildBridgeTokenInstance: vi.fn(async () => ({ address: { toString: () => "0x5" } })),
	rebuildBridgeProxyInstance: vi.fn(async () => ({ address: { toString: () => "0x6" } })),
}))
vi.mock("@nulo/bridge-core/artifacts", () => ({
	bridgeProxyArtifact: { name: "BridgeProxy" },
	tokenBridgeArtifact: { name: "TokenBridge" },
}))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", () => ({ DripperContractArtifact: { name: "Dripper" } }))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({ TokenContractArtifact: { name: "Token" } }))
vi.mock("@/contracts/sponsored-fpc", () => ({ getSponsoredFpcInstance: async () => ({ address: { toString: () => "0xfpc" } }) }))
vi.mock("@/contracts/private-fpc", () => ({
	getPrivateFpc: async () => ({ instance: { address: { toString: () => "0xprivatefpc" } }, artifact: {} }),
}))

import { __resetWalletConnectionForTests, useWalletConnection } from "@/composables/useWalletConnection"
import ChooseAccountModal from "./ChooseAccountModal.vue"

const ADDR_A = `0x${"aa".padStart(64, "0")}`
const ADDR_B = `0x${"bb".padStart(64, "0")}`

const mockProvider = {
	id: "nulo",
	name: "Nulo",
	type: "extension",
	establishSecureChannel: mockEstablishSecureChannel,
	disconnect: vi.fn(async () => {}),
	isDisconnected: () => false,
	onDisconnect: () => () => {},
}

async function* yieldOne() {
	yield mockProvider
}

function makeWallet(grantedAccounts: Array<{ alias?: string; item?: string }>) {
	return {
		requestCapabilities: vi.fn(async () => ({ granted: [{ type: "accounts", accounts: grantedAccounts }] })),
		registerContract: vi.fn(async () => {}),
	}
}

async function driveTo(grantedAccounts: Array<{ alias?: string; item?: string }>) {
	const wallet = makeWallet(grantedAccounts)
	mockEstablishSecureChannel.mockResolvedValue({
		verificationHash: "deadbeef",
		confirm: vi.fn(async () => wallet),
		cancel: vi.fn(async () => {}),
	})
	const c = useWalletConnection()
	await c.connect()
	c.selectWallet(c.discoveredWallets.value[0].key)
	for (let i = 0; i < 6; i++) await Promise.resolve()
	await c.confirmVerification()
	return c
}

function mountModal() {
	// Teleport stubbed so the dialog renders inside the wrapper (jsdom-friendly queries).
	return mount(ChooseAccountModal, { global: { stubs: { teleport: true } } })
}

describe("ChooseAccountModal", () => {
	beforeEach(() => {
		localStorage.clear()
		__resetWalletConnectionForTests()
		mockEstablishSecureChannel.mockReset()
		mockGetAvailableWallets.mockReset()
		mockGetAvailableWallets.mockImplementation(() => ({ wallets: yieldOne(), cancel: () => {}, done: Promise.resolve() }))
	})
	afterEach(() => {
		__resetWalletConnectionForTests()
		vi.clearAllMocks()
	})

	it("is not rendered outside the choosing-account state", () => {
		const w = mountModal()
		expect(w.find(`[data-testid="${TESTIDS.accountChoice}"]`).exists()).toBe(false)
	})

	it("never appears for a single-account grant (flow auto-selects)", async () => {
		const w = mountModal()
		const c = await driveTo([{ alias: "Only", item: ADDR_A }])
		expect(c.status.value).toBe("connected")
		expect(w.find(`[data-testid="${TESTIDS.accountChoice}"]`).exists()).toBe(false)
	})

	it("renders one radio row per account with alias fallback, first pre-selected, no truncation row", async () => {
		const w = mountModal()
		await driveTo([
			{ alias: "Main", item: ADDR_A },
			{ alias: "", item: ADDR_B },
		])
		await w.vm.$nextTick()

		const rows = w.findAll(`[data-testid="${TESTIDS.accountChoiceRow}"]`)
		expect(rows).toHaveLength(2)
		expect(rows[0].attributes("aria-checked")).toBe("true")
		expect(rows[0].text()).toContain("Main")
		expect(rows[1].attributes("aria-checked")).toBe("false")
		expect(rows[1].text()).toContain("—") // empty alias falls back to a dash
		expect(rows[1].text()).toContain(`${ADDR_B.slice(0, 6)}…${ADDR_B.slice(-4)}`)
		expect(w.find(`[data-testid="${TESTIDS.accountChoiceTruncation}"]`).exists()).toBe(false)
	})

	it("picking a row and pressing Continue resumes the REAL flow to connected", async () => {
		const w = mountModal()
		const c = await driveTo([
			{ alias: "Main", item: ADDR_A },
			{ alias: "Savings", item: ADDR_B },
		])
		expect(c.status.value).toBe("choosing-account")
		await w.vm.$nextTick()

		await w.findAll(`[data-testid="${TESTIDS.accountChoiceRow}"]`)[1].trigger("click")
		await w.find(`[data-testid="${TESTIDS.accountChoiceContinue}"]`).trigger("click")
		// The real registerAllContracts chains several awaits — poll until the flow settles.
		await vi.waitFor(() => expect(c.status.value).toBe("connected"))
		expect(c.selectedAccount.value).toBe(ADDR_B)
	})

	it("Escape cancels the whole connect (idle), not just the dialog", async () => {
		const w = mountModal()
		const c = await driveTo([
			{ alias: "Main", item: ADDR_A },
			{ alias: "Savings", item: ADDR_B },
		])
		await w.vm.$nextTick()

		await w.find('[role="dialog"]').trigger("keydown", { key: "Escape" })
		for (let i = 0; i < 4; i++) await Promise.resolve()
		expect(c.status.value).toBe("idle")
		expect(w.find(`[data-testid="${TESTIDS.accountChoice}"]`).exists()).toBe(false)
	})

	it("backdrop click cancels the connect", async () => {
		const w = mountModal()
		const c = await driveTo([
			{ alias: "Main", item: ADDR_A },
			{ alias: "Savings", item: ADDR_B },
		])
		await w.vm.$nextTick()

		await w.find(`[data-testid="${TESTIDS.accountChoice}"]`).trigger("click")
		for (let i = 0; i < 4; i++) await Promise.resolve()
		expect(c.status.value).toBe("idle")
	})

	it("mounting WHILE already in choosing-account still pre-selects the first account (immediate watcher)", async () => {
		const c = await driveTo([
			{ alias: "Main", item: ADDR_A },
			{ alias: "Savings", item: ADDR_B },
		])
		expect(c.status.value).toBe("choosing-account")
		const w = mountModal() // mounted AFTER the pause began — remount/HMR path
		await w.vm.$nextTick()
		const rows = w.findAll(`[data-testid="${TESTIDS.accountChoiceRow}"]`)
		expect(rows[0].attributes("aria-checked")).toBe("true")
		expect(w.find(`[data-testid="${TESTIDS.accountChoiceContinue}"]`).attributes("disabled")).toBeUndefined()
	})

	it("discloses grant truncation ('Showing 16 of 17')", async () => {
		const w = mountModal()
		const seventeen = Array.from({ length: 17 }, (_, i) => ({
			alias: `Acct ${i}`,
			item: `0x${(i + 1).toString(16).padStart(64, "0")}`,
		}))
		await driveTo(seventeen)
		await w.vm.$nextTick()

		const note = w.find(`[data-testid="${TESTIDS.accountChoiceTruncation}"]`)
		expect(note.exists()).toBe(true)
		expect(note.text()).toContain("Showing 16 of 17")
	})
})
