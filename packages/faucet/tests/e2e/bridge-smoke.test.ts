/*
 * Bridge smoke e2e. Mounts BridgeView in jsdom with the REAL journal engine on the REAL
 * (jsdom) localStorage; only the chain/wallet boundaries are faked. Pins the contracts:
 *
 *   1. legacy single-pending keys are DELETED on journal init (no migration)
 *   2. persisted journal records render as cards — and NOTHING auto-claims
 *   3. an explicit CLAIM click drives the record to done through the engine
 *   4. the form's direction flip swaps the panels' data-chain
 *
 * Selectors are data-testid only.
 */

import { type DepositJournalRecord, JOURNAL_KEY, LEGACY_KEYS, type WithdrawJournalRecord } from "@nulo/bridge-core"
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

// Simulate succeeds until the claim is sent, then reverts message-gone — the engine's
// tx-identity probe requires exactly that flip before it marks a record done.
let claimSent = false
const claimDep = vi.fn(async () => ({
	simulate: async () => {
		if (claimSent) throw new Error("No L1 to L2 message found for message hash 0xdead")
		return {}
	},
	send: async () => {
		claimSent = true
		return { txHash: "0xclaimtx" }
	},
}))
const signL1 = vi.fn(async () => `0x${"a".repeat(130)}`)

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr") }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useL1Usdc", () => ({
	useL1Usdc: () => ({ balance: ref(500_000_000n), minting: ref(false), error: ref(null), refresh: vi.fn(), mint: vi.fn() }),
}))
vi.mock("@/composables/useTokenBalance", () => ({
	useTokenBalance: () => ({
		publicBalance: ref(0n),
		privateBalance: ref(0n),
		loading: ref(false),
		error: ref(null),
		refresh: vi.fn(),
		dispose: vi.fn(),
	}),
}))
vi.mock("@/composables/useDeposit", () => ({
	useDepositFlow: () => ({ busy: ref(false), error: ref(null), deposit: vi.fn() }),
	providerFingerprint: () => "rabby",
}))
vi.mock("@/composables/useWithdraw", () => ({
	useWithdrawFlow: () => ({ busy: ref(false), error: ref(null), withdraw: vi.fn() }),
}))

import { L1_PORTAL } from "@/contracts/bridge-deployments"
import { BRIDGE } from "@/contracts/bridge-deployments"
import { __resetJournalForTests, connectJournalDeps, resumeSessionWork } from "@/composables/useBridgeJournal"
import { TESTIDS } from "@/lib/testids"
import BridgeView from "@/views/BridgeView.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const DEPLOY = { chainId: 11155111, portal: L1_PORTAL, bridge: BRIDGE.toString() }

function seedJournal(records: (DepositJournalRecord | WithdrawJournalRecord)[]): void {
	localStorage.setItem(JOURNAL_KEY, JSON.stringify({ schema: 1, records }))
}

function claimableDeposit(): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xdep1",
		direction: "deposit",
		isPrivate: false,
		amount: "100000000",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		recipient: `0x${"10".repeat(32)}`,
		secret: "0xpublicsecret",
		secretHashHex: "0xdep1",
		leafIndex: "7",
		...DEPLOY,
	}
}

function provingWithdraw(): WithdrawJournalRecord {
	return {
		schema: 1,
		id: "0xwd1",
		direction: "withdraw",
		isPrivate: true,
		amount: "40000000",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		recipientL1: "0xl1addr",
		exitTxHash: "0xwd1",
		...DEPLOY,
	}
}

function mountBridge() {
	return mount(BridgeView, {
		global: {
			stubs: { L1WalletPanel: true, BridgeWalletPanel: true, BridgeAddToken: true },
		},
	})
}

describe("bridge smoke", () => {
	beforeEach(() => {
		localStorage.clear()
		__resetJournalForTests()
		claimDep.mockClear()
		signL1.mockClear()
		claimSent = false
		connectJournalDeps({
			kv: localStorage,
			waitMs: async () => {},
			now: () => 4242,
			connectedL1: () => "0xl1addr",
			connectedAztec: () => `0x${"10".repeat(32)}`,
			signL1,
			claim: claimDep as never,
			claimReceiptStatus: async () => "success",
			waitConsumeReceipt: async () => true,
			verifyConsumeIdentity: async () => true,
			consume: async () => ({ consumeTxHash: "0xconsume" }),
		})
	})

	it("deletes the legacy single-pending keys on init and shows the empty journal", async () => {
		localStorage.setItem(LEGACY_KEYS[0], JSON.stringify({ secret: "0xold", recipient: "0xr", amount: "5" }))
		localStorage.setItem(LEGACY_KEYS[1], JSON.stringify({ exitTxHash: "0xold" }))
		const w = mountBridge()
		await flushPromises()
		expect(localStorage.getItem(LEGACY_KEYS[0])).toBeNull()
		expect(localStorage.getItem(LEGACY_KEYS[1])).toBeNull()
		expect(w.find(sel(TESTIDS.journalEmpty)).exists()).toBe(true)
	})

	it("renders persisted records as cards and NEVER auto-claims them", async () => {
		seedJournal([claimableDeposit(), provingWithdraw()])
		const w = mountBridge()
		await flushPromises()
		resumeSessionWork()
		await flushPromises()
		const cards = w.findAll(sel(TESTIDS.journalCard))
		expect(cards).toHaveLength(2)
		const stages = cards.map((c) => `${c.attributes("data-direction")}:${c.attributes("data-stage")}`)
		expect(stages).toContain("deposit:claimable")
		expect(stages).toContain("withdraw:proving")
		expect(claimDep).not.toHaveBeenCalled()
		expect(signL1).not.toHaveBeenCalled()
	})

	it("an explicit CLAIM click drives the deposit to done through the engine", async () => {
		seedJournal([claimableDeposit()])
		const w = mountBridge()
		await flushPromises()
		await w.find(sel(TESTIDS.journalClaim)).trigger("click")
		await flushPromises()
		expect(claimDep).toHaveBeenCalled()
		expect(w.find(sel(TESTIDS.journalCard)).attributes("data-stage")).toBe("done")
		expect(w.find(sel(TESTIDS.journalClear)).exists()).toBe(true)
	})

	it("the form flip swaps the panels' data-chain", async () => {
		const w = mountBridge()
		await flushPromises()
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("ethereum")
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("aztec")
		expect(w.find(sel(TESTIDS.bridgeTo)).attributes("data-chain")).toBe("ethereum")
	})
})
