import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

// A stale mounted form from a prior test still watches the SHARED journal refs (activeFlowId /
// records) and would release the next test's foreground at completion - unmount between tests.
enableAutoUnmount(afterEach)

const depositFn = vi.fn(async (_a: bigint, _p: boolean) => {})
const depositErr = ref<string | null>(null)
const withdrawFn = vi.fn(async (_a: bigint, _p: boolean) => {})
const sealTrusted = vi.fn(() => false)
const l1Balance = ref<bigint | null>(500_000_000n)
const publicBalance = ref<bigint | null>(200_000_000n)
const privateBalance = ref<bigint | null>(50_000_000n)

vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	isSealTrusted: (...args: unknown[]) => sealTrusted(...(args as [])),
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	L1_USDC: "0xl1token",
	BRIDGE_TOKEN_SYMBOL: "USDC",
	BRIDGE_TOKEN_DECIMALS: 6,
	BRIDGE_TOKEN: { toString: () => "0xtoken" },
	L1_PORTAL: "0xportal",
	BRIDGE: { toString: () => "0xbridge" },
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true), address: ref("0xl1addr") }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected"), selectedAccount: ref(`0x${"10".repeat(32)}`), wallet: ref({}) }),
}))
vi.mock("@/composables/useL1Usdc", () => ({
	useL1Usdc: () => ({ balance: l1Balance, minting: ref(false), error: ref(null), refresh: vi.fn(), mint: vi.fn() }),
}))
vi.mock("@/composables/useTokenBalance", () => ({
	useTokenBalance: () => ({
		publicBalance,
		privateBalance,
		loading: ref(false),
		error: ref(null),
		refresh: vi.fn(),
		dispose: vi.fn(),
	}),
}))
vi.mock("@/composables/useDeposit", () => ({
	useDepositFlow: () => ({ busy: ref(false), error: depositErr, deposit: depositFn }),
	providerFingerprint: () => "rabby",
}))
vi.mock("@/composables/useWithdraw", () => ({
	useWithdrawFlow: () => ({ busy: ref(false), error: ref(null), withdraw: withdrawFn }),
}))

import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { __resetJournalForTests, addRecord, rekeyJournalRecord, updateRecord, useBridgeJournal } from "@/composables/useBridgeJournal"
import { TESTIDS } from "@/lib/testids"
import BridgeForm from "./BridgeForm.vue"

const sel = (t: string) => `[data-testid="${t}"]`

function activeFixture(id: string): DepositJournalRecord {
	return {
		schema: 1,
		id,
		direction: "deposit",
		isPrivate: false,
		amount: "100000000",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		chainId: 11155111,
		portal: "0xportal",
		bridge: "0xbridge",
		recipient: `0x${"10".repeat(32)}`,
		secretHashHex: id,
		secret: "0xs",
		leafIndex: "7",
	}
}

describe("BridgeForm", () => {
	beforeEach(() => {
		depositFn.mockClear()
		withdrawFn.mockClear()
		depositErr.value = null
		sealTrusted.mockReturnValue(false)
		l1Balance.value = 500_000_000n
	})

	it("defaults to Ethereum→Aztec, PRIVATE preset, with BOTH Aztec balances always visible", () => {
		const w = mount(BridgeForm)
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("ethereum")
		expect(w.find(sel(TESTIDS.bridgeTo)).attributes("data-chain")).toBe("aztec")
		expect(w.find(sel(TESTIDS.bridgeBalanceL1)).text()).toContain("500")
		// Both lines visible regardless of preset - the user is never blind.
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).text()).toContain("200")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Private)).text()).toContain("50")
		// PRIVATE is the default preset: the private balance is the active one.
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Private)).attributes("data-active")).toBe("true")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).attributes("data-active")).toBe("false")
		expect(w.find(sel(TESTIDS.bridgeSubmit)).text()).toContain("BRIDGE PRIVATELY TO AZTEC")
	})

	it("selecting the PUBLIC preset switches the active balance + submit copy", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgePresetPublic)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).attributes("data-active")).toBe("true")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Private)).attributes("data-active")).toBe("false")
		expect(w.find(sel(TESTIDS.bridgeSubmit)).text()).toContain("BRIDGE TO AZTEC")
	})

	it("flip swaps the chains, keeps the stacked pair on the Aztec side, and flips the submit copy", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeFrom)).attributes("data-chain")).toBe("aztec")
		expect(w.find(sel(TESTIDS.bridgeTo)).attributes("data-chain")).toBe("ethereum")
		expect(w.find(sel(TESTIDS.bridgeFrom)).find(sel(TESTIDS.bridgeBalanceL2Private)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.bridgeTo)).find(sel(TESTIDS.bridgeBalanceL1)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.bridgeSubmit)).text()).toContain("BRIDGE TO ETHEREUM")
	})

	it("the privacy toggle highlights the ACTIVE balance (both stay visible)", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgePresetPrivate)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Private)).attributes("data-active")).toBe("true")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).attributes("data-active")).toBe("false")
		expect(w.find(sel(TESTIDS.bridgeBalanceL2Public)).exists()).toBe(true)
	})

	it("no validation error on first render - only after the user touches the amount AND it settles", async () => {
		l1Balance.value = 50_000_000n // default "100" exceeds it
		const w = mount(BridgeForm)
		expect(w.find(sel(TESTIDS.bridgeFormError)).exists()).toBe(false)
		const input = w.find(sel(TESTIDS.bridgeAmount))
		await input.setValue("100")
		// Display is settle-debounced: mid-typing shows nothing; blur settles instantly.
		expect(w.find(sel(TESTIDS.bridgeFormError)).exists()).toBe(false)
		await input.trigger("blur")
		expect(w.find(sel(TESTIDS.bridgeFormError)).text()).toMatch(/exceeds/i)
	})

	it("submit threads (amount, isPrivate) to the right flow per direction", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("100")
		await w.find(sel(TESTIDS.bridgePresetPrivate)).trigger("click")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledWith(100_000_000n, true, expect.objectContaining({ onRecord: expect.any(Function) }))

		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("40")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(withdrawFn).toHaveBeenCalledWith(40_000_000n, true, expect.objectContaining({ onRecord: expect.any(Function) }))
	})

	it("an amount over the From balance blocks submit with a validation error", async () => {
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("9999")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		expect(depositFn).not.toHaveBeenCalled()
		expect(w.find(sel(TESTIDS.bridgeFormError)).text()).toMatch(/exceeds/i)
	})

	it("zero L1 balance shows the mint hint", async () => {
		l1Balance.value = 0n
		const w = mount(BridgeForm)
		expect(w.text()).toContain("mint some below")
	})

	it("takeover: submit flips to the stepper, suppresses the card, BACKGROUND frees the form (one-surface pin)", async () => {
		__resetJournalForTests()
		depositFn.mockImplementationOnce(async (_a: bigint, _p: boolean, opts?: { onRecord?: (id: string) => void }) => {
			addRecord(activeFixture("0xtakeover"))
			opts?.onRecord?.("0xtakeover")
			await new Promise(() => {}) // the flow keeps running - the stepper must not depend on it settling
		})
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("100")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		await w.vm.$nextTick()
		// Stepper owns the surface; the journal hides the record (xor).
		expect(w.find(sel(TESTIDS.stepper)).exists()).toBe(true)
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xtakeover")).toBe(false)
		// RUN IN BACKGROUND: card appears, form is IMMEDIATELY usable (never gated on flow busy).
		await w.find(sel(TESTIDS.stepperBackground)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeSubmit)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.bridgeSubmit)).attributes("disabled")).toBeUndefined()
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xtakeover")).toBe(true)
	})

	it("CRITICAL pin: the withdraw provisional→exit rekey keeps the stepper alive (never zero surfaces)", async () => {
		__resetJournalForTests()
		const provisional: WithdrawJournalRecord = {
			schema: 1,
			id: "wd-pending-x",
			direction: "withdraw",
			isPrivate: false,
			amount: "40000000",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			chainId: 11155111,
			portal: "0xportal",
			bridge: "0xbridge",
			recipientL1: "0xl1addr",
		}
		withdrawFn.mockImplementationOnce(async (_a: bigint, _p: boolean, opts?: { onRecord?: (id: string) => void }) => {
			addRecord(provisional)
			opts?.onRecord?.("wd-pending-x")
			// The flow rekeys to the exit hash mid-stepper (engine transfers foreground ownership).
			rekeyJournalRecord("wd-pending-x", { ...provisional, id: "0xexit99", exitTxHash: "0xexit99", updatedAt: Date.now() })
			await new Promise(() => {})
		})
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeFlip)).trigger("click")
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("40")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		// The stepper follows the NEW id (the form reads the engine's activeFlowId - no stale copy)…
		expect(w.find(sel(TESTIDS.stepper)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.stepper)).attributes("data-id")).toBe("0xexit99")
		// …and the journal still suppresses it (exactly ONE surface for a non-completed record).
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xexit99")).toBe(false)
	})

	it("NEW BRIDGE clears stale flow errors (no 'wallet locked' ghost on the fresh form)", async () => {
		__resetJournalForTests()
		depositErr.value = "Wallet locked"
		depositFn.mockImplementationOnce(async (_a: bigint, _p: boolean, opts?: { onRecord?: (id: string) => void }) => {
			addRecord(activeFixture("0xghost"))
			opts?.onRecord?.("0xghost")
			await new Promise(() => {})
		})
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("100")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		await w.vm.$nextTick()
		updateRecord("0xghost", { depositTxHash: `0x${"ab".repeat(32)}`, claimTxHash: `0x${"cd".repeat(32)}`, completedAt: Date.now() })
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(depositErr.value).toBeNull()
		expect(w.find(sel(TESTIDS.bridgeFlowError)).exists()).toBe(false)
	})

	it("completion flips stepper→receipt with a SNAPSHOT that survives the record vanishing", async () => {
		__resetJournalForTests()
		depositFn.mockImplementationOnce(async (_a: bigint, _p: boolean, opts?: { onRecord?: (id: string) => void }) => {
			addRecord(activeFixture("0xdone"))
			opts?.onRecord?.("0xdone")
			await new Promise(() => {})
		})
		const w = mount(BridgeForm)
		await w.find(sel(TESTIDS.bridgeAmount)).setValue("100")
		await w.find(sel(TESTIDS.bridgeSubmit)).trigger("click")
		await w.vm.$nextTick()
		updateRecord("0xdone", { depositTxHash: `0x${"ab".repeat(32)}`, claimTxHash: `0x${"cd".repeat(32)}`, completedAt: Date.now() })
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		expect(w.find(sel(TESTIDS.receipt)).exists()).toBe(true)
		expect(w.findAll(sel(TESTIDS.receiptLink))).toHaveLength(2)
		// Completion releases the takeover: the finished record surfaces in the journal history
		// alongside the receipt (the bug: it used to stay foreground-suppressed, then get hidden).
		expect(useBridgeJournal().activeFlowId.value).toBeNull()
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xdone")).toBe(true)
		// Cross-tab discard cannot blank the receipt - it renders the snapshot.
		__resetJournalForTests()
		await w.vm.$nextTick()
		expect(w.find(sel(TESTIDS.receipt)).exists()).toBe(true)
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(w.find(sel(TESTIDS.bridgeSubmit)).exists()).toBe(true)
	})
})
