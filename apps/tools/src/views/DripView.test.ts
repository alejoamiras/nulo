import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defineComponent, nextTick } from "vue"

// Mock the wallet-sdk and aztec node clients so importing the singleton composable
// doesn't trip on missing browser-only globals (same set as WalletPanel.test.ts).
vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: { configure: () => ({ getAvailableWallets: () => ({}) }) },
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
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", () => ({ DripperContractArtifact: { name: "Dripper" } }))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({ TokenContractArtifact: { name: "Token" } }))

import { __resetWalletConnectionForTests, useWalletConnection } from "@/composables/useWalletConnection"
import DripView from "./DripView.vue"

const ADDR_A = `0x${"aa".padStart(64, "0")}`
const ADDR_B = `0x${"bb".padStart(64, "0")}`

/** Every SETUP of this stub records the account it was created with — a new entry means the
 *  real TokenCard would have re-run its setup and re-bound useDrip/useTokenBalance to
 *  that account: cards must REMOUNT when the active account changes. */
const captured: string[] = []
const TokenCardStub = defineComponent({
	name: "TokenCard",
	props: ["token", "tokenAddress", "wallet", "account"],
	setup(props: { account?: { toString(): string } }) {
		captured.push(props.account?.toString() ?? "none")
	},
	template: '<div class="token-card-stub" />',
})

function mountView() {
	return mount(DripView, {
		global: { stubs: { TokenCard: TokenCardStub, WalletPanel: true } },
	})
}

describe("DripView — account-keyed token cards (D-1)", () => {
	beforeEach(() => {
		__resetWalletConnectionForTests()
		captured.length = 0
	})
	afterEach(() => {
		__resetWalletConnectionForTests()
	})

	it("switching the active account REMOUNTS every card bound to the new account", async () => {
		const c = useWalletConnection()
		mountView()
		const cardCount = captured.length
		expect(cardCount).toBeGreaterThan(0) // disconnected cards render (account "none")
		expect(captured.every((a) => a === "none")).toBe(true)

		// Connect as A: every card re-mounts bound to A.
		c.status.value = "connected"
		// biome-ignore lint/suspicious/noExplicitAny: minimal wallet stand-in for prop plumbing
		c.wallet.value = {} as any
		c.selectedAccount.value = ADDR_A
		await nextTick()
		expect(captured).toHaveLength(cardCount * 2)
		expect(captured.slice(cardCount).every((a) => a === ADDR_A)).toBe(true)

		// Switch to B: every card re-mounts again, now bound to B — the old drip/balance
		// handles (created at setup with A) are gone with the old instances.
		c.selectedAccount.value = ADDR_B
		await nextTick()
		expect(captured).toHaveLength(cardCount * 3)
		expect(captured.slice(cardCount * 2).every((a) => a === ADDR_B)).toBe(true)
	})

	it("disconnecting re-mounts cards without an account", async () => {
		const c = useWalletConnection()
		c.status.value = "connected"
		// biome-ignore lint/suspicious/noExplicitAny: minimal wallet stand-in for prop plumbing
		c.wallet.value = {} as any
		c.selectedAccount.value = ADDR_A
		mountView()
		const cardCount = captured.length
		expect(captured.every((a) => a === ADDR_A)).toBe(true)

		c.status.value = "idle"
		c.selectedAccount.value = null
		c.wallet.value = null
		await nextTick()
		expect(captured.slice(cardCount).every((a) => a === "none")).toBe(true)
	})
})
