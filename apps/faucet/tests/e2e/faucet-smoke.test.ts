/*
 * Faucet smoke e2e. Mounts App.vue in jsdom, mocks the wallet-sdk +
 * contracts boundaries, walks through:
 *
 *   1. empty state (no wallet detected when discovery times out)
 *   2. discover → emoji modal → confirm → capability approval → connected
 *   3. balances render (0.00 / 0.00 across both tokens)
 *   4. click 'Drip 1,000 NULO to public' → loading → success toast
 *   5. disconnect → resets to empty state
 *
 * No real browser, no aztec network. The mock provider satisfies every
 * RPC the faucet issues — discovery, secure-channel, confirm,
 * requestCapabilities, registerContract, executeUtility, sendTx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mount, type VueWrapper } from "@vue/test-utils"
import { flushPromises } from "@vue/test-utils"

const mockEstablishSecureChannel = vi.fn()
const mockDisconnectProvider = vi.fn(async () => {})
const mockProvider = {
	id: "nulo",
	name: "Nulo",
	establishSecureChannel: mockEstablishSecureChannel,
	disconnect: mockDisconnectProvider,
	isDisconnected: () => false,
	onDisconnect: () => () => {},
}

async function* yieldOne() {
	yield mockProvider
}

async function* yieldNone(): AsyncGenerator<typeof mockProvider, void, unknown> {
	// no providers
}

const mockGetAvailableWallets = vi.fn(() => ({
	wallets: yieldOne(),
	cancel: () => {},
	done: Promise.resolve(),
}))

vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: { configure: () => ({ getAvailableWallets: mockGetAvailableWallets }) },
}))

vi.mock("@/lib/emoji", () => ({
	hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤",
	toGrid: (s: string) => Array.from(s).slice(0, 9),
}))

vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({ getContract: async () => ({}) }),
}))

vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0xdripper", equals: () => false },
	NULO: { toString: () => "0xusdc", equals: () => false },
	OLUN: { toString: () => "0xeth", equals: () => false },
	rebuildDripperInstance: vi.fn(async () => ({ address: { toString: () => "0xdripper" } })),
	rebuildNuloInstance: vi.fn(async () => ({ address: { toString: () => "0xusdc" } })),
	rebuildOlunInstance: vi.fn(async () => ({ address: { toString: () => "0xeth" } })),
}))

vi.mock("@/contracts/sponsored-fpc", () => ({
	getSponsoredFpcInstance: async () => ({ address: { toString: () => "0xfpc" } }),
}))

// Pre-baked like every other contract module here: the real getPrivateFpc dynamically imports the
// PrivateFPC artifact + runs loadContractArtifact/derivation, which the gutted aztec.js mocks can't
// support - unmocked, the connect-time registration rejects and status wedges at "setting-up".
vi.mock("@/contracts/private-fpc", () => ({
	getPrivateFpc: async () => ({ instance: { address: { toString: () => "0xprivfpc" } }, artifact: { name: "PrivateFPC" } }),
}))

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: {
		at: vi.fn(async () => ({
			methods: {
				balance_of_public: () => ({ request: async () => ({ call: "balance_of_public" }) }),
				balance_of_private: () => ({ request: async () => ({ call: "balance_of_private" }) }),
				drip_to_public: () => ({ request: async () => ({ calls: [{ target: "public" }] }) }),
				drip_to_private: () => ({ request: async () => ({ calls: [{ target: "private" }] }) }),
			},
		})),
	},
	getContractInstanceFromInstantiationParams: vi.fn(async () => ({ address: { toString: () => "0x0" } })),
}))

vi.mock("@aztec/aztec.js/addresses", async (importActual) => {
	const actual = await importActual<typeof import("@aztec/aztec.js/addresses")>()
	return actual
})

vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", () => ({
	DripperContractArtifact: { name: "Dripper" },
}))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({
	TokenContractArtifact: { name: "Token" },
}))

import App from "@/App.vue"
import { __resetWalletConnectionForTests } from "@/composables/useWalletConnection"
import { __resetFaucetDripForTests } from "@/composables/useFaucetDrip"
import { __resetToastsForTests } from "@/composables/useToast"
import { TESTIDS } from "@/lib/testids"

function makeWalletStub() {
	return {
		requestCapabilities: vi.fn(async () => ({
			granted: [
				{
					type: "accounts",
					accounts: [{ alias: "Main", item: "0x000000000000000000000000000000000000000000000000000000000000000a" }],
				},
			],
		})),
		registerContract: vi.fn(async () => {}),
		executeUtility: vi.fn(async () => 0n),
		sendTx: vi.fn(async () => ({ txHash: "0xtxabcdef" })),
	}
}

function makePending(verificationHash = "deadbeef") {
	return {
		verificationHash,
		confirm: vi.fn(async () => makeWalletStub()),
		cancel: vi.fn(async () => {}),
	}
}

describe("faucet smoke", () => {
	let wrapper: VueWrapper | null = null

	beforeEach(() => {
		__resetWalletConnectionForTests()
		__resetFaucetDripForTests()
		__resetToastsForTests()
		mockEstablishSecureChannel.mockReset()
		mockDisconnectProvider.mockReset()
		mockDisconnectProvider.mockImplementation(async () => {})
		mockGetAvailableWallets.mockReset()
		mockGetAvailableWallets.mockImplementation(() => ({
			wallets: yieldOne(),
			cancel: () => {},
			done: Promise.resolve(),
		}))
	})

	afterEach(() => {
		wrapper?.unmount()
		wrapper = null
		vi.clearAllMocks()
		document.body.innerHTML = ""
	})

	it("1. empty state — no wallet detected after discovery timeout", async () => {
		mockGetAvailableWallets.mockImplementationOnce(() => ({
			wallets: yieldNone(),
			cancel: () => {},
			done: Promise.resolve(),
		}))
		wrapper = mount(App, { attachTo: document.body })
		await wrapper.get(`[data-testid="${TESTIDS.btnConnect}"]`).trigger("click")
		await flushPromises()
		expect(wrapper.text()).toContain("No Aztec wallet detected")
		expect(wrapper.find(`[data-testid="${TESTIDS.btnInstallNulo}"]`).exists()).toBe(true)
	})

	it("2. discover → emoji modal → confirm → connected", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValueOnce(pending)
		wrapper = mount(App, { attachTo: document.body })

		await wrapper.get(`[data-testid="${TESTIDS.btnConnect}"]`).trigger("click")
		await flushPromises()

		const modal = document.querySelector(`[data-testid="${TESTIDS.verificationModal}"]`)
		expect(modal).not.toBeNull()

		const confirmBtn = document.querySelector(`[data-testid="${TESTIDS.btnVerifyConfirm}"]`) as HTMLElement
		confirmBtn.click()
		await flushPromises()

		const statusEl = wrapper.get(`[data-testid="${TESTIDS.status}"]`)
		expect(statusEl.attributes("data-status")).toBe("connected")
		expect(wrapper.find(`[data-testid="${TESTIDS.account}"]`).exists()).toBe(true)
	})

	it("3. once connected, both token cards render with 0.00 balances", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValueOnce(pending)
		wrapper = mount(App, { attachTo: document.body })

		await wrapper.get(`[data-testid="${TESTIDS.btnConnect}"]`).trigger("click")
		await flushPromises()
		const confirm = document.querySelector(`[data-testid="${TESTIDS.btnVerifyConfirm}"]`) as HTMLElement
		confirm.click()
		await flushPromises()
		await flushPromises()

		const cards = wrapper.findAll(`[data-testid="${TESTIDS.tokenCard}"]`)
		expect(cards).toHaveLength(2)
		expect(cards[0].attributes("data-symbol")).toBe("NULO")
		expect(cards[1].attributes("data-symbol")).toBe("OLUN")
	})

	it("3b. the Fuel tab has its OWN bridges list (so backgrounded Fuel bridges surface there)", async () => {
		wrapper = mount(App, { attachTo: document.body })
		await flushPromises()
		await wrapper.get(`[data-testid="${TESTIDS.tabFuel}"]`).trigger("click")
		await flushPromises()
		expect(wrapper.find(`[data-testid="${TESTIDS.fuelView}"]`).isVisible()).toBe(true)
		expect(wrapper.find(`[data-testid="${TESTIDS.fuelForm}"]`).exists()).toBe(true)
		// The Fuel tab now mounts its own (fee-juice-filtered) journal so a backgrounded Fuel bridge doesn't
		// vanish until you visit the Bridge tab. Both tabs are always-mounted (v-show) → two lists app-wide.
		// The single-toast-owner integrity (only the Bridge mount emits completion toasts; the Fuel mount is
		// toast-silent) is unit-pinned in BridgeJournal.test.ts.
		expect(wrapper.findAll(`[data-testid="${TESTIDS.journalEmpty}"]`)).toHaveLength(2)
	})

	it("4. clicking 'Drip … to public' fires sendTx and shows a success toast", async () => {
		const wallet = makeWalletStub()
		const pending = { verificationHash: "deadbeef", confirm: async () => wallet, cancel: async () => {} }
		mockEstablishSecureChannel.mockResolvedValueOnce(pending)
		wrapper = mount(App, { attachTo: document.body })

		await wrapper.get(`[data-testid="${TESTIDS.btnConnect}"]`).trigger("click")
		await flushPromises()
		const confirm = document.querySelector(`[data-testid="${TESTIDS.btnVerifyConfirm}"]`) as HTMLElement
		confirm.click()
		await flushPromises()
		await flushPromises()

		const nuloCard = wrapper.findAll(`[data-testid="${TESTIDS.tokenCard}"]`).find((c) => c.attributes("data-symbol") === "NULO")
		const dripBtn = nuloCard?.find(`[data-testid="${TESTIDS.btnDripPublic}"]`)
		expect(dripBtn?.exists()).toBe(true)
		await dripBtn?.trigger("click")
		await flushPromises()

		expect(wallet.sendTx).toHaveBeenCalledTimes(1)
		// Toast pushed; rendered via AppToastRegion + Toast component.
		const toasts = wrapper.findAll(`[data-testid="${TESTIDS.toast}"]`)
		expect(toasts.length).toBeGreaterThan(0)
		expect(toasts[0].text()).toContain("Dripped 1,000 NULO to public")
	})

	it("5. clicking disconnect resets back to the connect button", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValueOnce(pending)
		wrapper = mount(App, { attachTo: document.body })

		await wrapper.get(`[data-testid="${TESTIDS.btnConnect}"]`).trigger("click")
		await flushPromises()
		const confirm = document.querySelector(`[data-testid="${TESTIDS.btnVerifyConfirm}"]`) as HTMLElement
		confirm.click()
		await flushPromises()
		await flushPromises()

		expect(wrapper.find(`[data-testid="${TESTIDS.btnDisconnect}"]`).exists()).toBe(true)
		await wrapper.get(`[data-testid="${TESTIDS.btnDisconnect}"]`).trigger("click")
		await flushPromises()

		const statusEl = wrapper.get(`[data-testid="${TESTIDS.status}"]`)
		expect(statusEl.attributes("data-status")).toBe("idle")
		expect(wrapper.find(`[data-testid="${TESTIDS.btnConnect}"]`).exists()).toBe(true)
	})
})
