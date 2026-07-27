import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick, ref } from "vue"

// Each mount registers a watcher on the module-shared lastCompleted; without unmounting, zombie instances
// from earlier tests fire on a later test's completion (breaks the toasts=false single-owner assertion).
enableAutoUnmount(afterEach)

const visibleRecords = ref<BridgeJournalRecord[]>([])
const lastCompleted = ref<{
	id: string
	direction: "deposit" | "withdraw"
	amount: string
	isPrivate: boolean
	assetKind?: "bridge-token" | "fee-juice"
	txHash?: string
	foreground?: boolean
} | null>(null)
const push = vi.fn()

const activeFlowId = ref<string | null>(null)
vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ visibleRecords, lastCompleted, runtime: ref({}), activeFlowId }),
}))
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({ push }),
}))

const restoreFile = vi.fn(async (_raw: string) => ({ id: "0xrestored", direction: "deposit" as const, amount: (5n * UNIT).toString() }))
vi.mock("@/composables/useBridgeBackup", () => ({
	useBridgeBackup: () => ({ restoreFile, exportBridge: vi.fn() }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeJournal from "./BridgeJournal.vue"
import BridgeJournalCard from "./BridgeJournalCard.vue"
// Amounts + symbol derive from the LIVE manifest (the token cutover changes both — a hardcoded
// 18-dec "AZLO" fixture breaks on a 6-dec USDC manifest).
import { BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
const UNIT = 10n ** BigInt(BRIDGE_TOKEN_DECIMALS)

const sel = (t: string) => `[data-testid="${t}"]`
const GOOD_HASH = `0x${"ab".repeat(32)}`
const recOf = (over: Partial<BridgeJournalRecord>): BridgeJournalRecord =>
	({ id: "0x", direction: "deposit", isPrivate: false, amount: (1n * UNIT).toString(), createdAt: 1, ...over }) as BridgeJournalRecord

describe("BridgeJournal", () => {
	beforeEach(() => {
		visibleRecords.value = []
		lastCompleted.value = null
		activeFlowId.value = null
		push.mockClear()
	})

	it("RESTORE: picking a file runs the ladder and toasts the result; failures toast the ladder copy", async () => {
		const w = mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		expect(w.find(sel(TESTIDS.journalRestore)).exists()).toBe(true)
		const input = w.find(sel(TESTIDS.journalRestoreInput))
		const file = new File(['{"format":"nulo-bridge-backup"}'], "b.json", { type: "application/json" })
		Object.defineProperty(input.element, "files", { value: [file], configurable: true })
		await input.trigger("change")
		await vi.waitFor(() => expect(restoreFile).toHaveBeenCalled())
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "ok", text: expect.stringContaining(`Restored: 5.00 ${BRIDGE_TOKEN_SYMBOL}`) }),
		)

		push.mockClear()
		restoreFile.mockRejectedValueOnce(new Error("This bridge is already tracked here - nothing to restore."))
		Object.defineProperty(input.element, "files", { value: [file], configurable: true })
		await input.trigger("change")
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", text: expect.stringContaining("already tracked") })),
		)
	})

	it("a FOREGROUND completion does not toast (the receipt already announced it)", async () => {
		// `foreground` is the SYNCHRONOUS capture from completion time - the live activeFlowId is
		// already released (null) by the time this watcher runs, so it cannot be the key.
		mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = {
			id: "0xfg",
			direction: "deposit",
			amount: (100n * UNIT).toString(),
			isPrivate: false,
			txHash: GOOD_HASH,
			foreground: true,
		}
		await nextTick()
		expect(push).not.toHaveBeenCalled()
	})

	it("renders the empty state from visibleRecords (the hide filter feeds this list)", () => {
		const w = mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		expect(w.find(sel(TESTIDS.journalEmpty)).exists()).toBe(true)
	})

	it("a completion pushes the toast with the explorer link (pin for the lastCompleted watcher)", async () => {
		const w = mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = { id: "0xa", direction: "deposit", amount: (100n * UNIT).toString(), isPrivate: false, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "ok",
				text: expect.stringContaining(`Bridged 100.00 ${BRIDGE_TOKEN_SYMBOL} to Aztec`),
				link: expect.objectContaining({ href: expect.stringContaining(GOOD_HASH) }),
			}),
		)
		expect(w.exists()).toBe(true)
	})

	it("withdraw completions toast the Ethereum wording with the etherscan link", async () => {
		mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = { id: "0xb", direction: "withdraw", amount: (40n * UNIT).toString(), isPrivate: true, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining(`Released 40.00 ${BRIDGE_TOKEN_SYMBOL} to Ethereum`),
				link: expect.objectContaining({ href: `https://sepolia.etherscan.io/tx/${GOOD_HASH}` }),
			}),
		)
	})

	it("kind='fee-juice' lists ONLY fuel records (the Fuel tab's own bridges)", () => {
		visibleRecords.value = [recOf({ id: "0xtok", assetKind: "bridge-token" }), recOf({ id: "0xfuel", assetKind: "fee-juice" })]
		const w = mount(BridgeJournal, { props: { kind: "fee-juice" }, global: { stubs: { BridgeJournalCard: true } } })
		const cards = w.findAllComponents(BridgeJournalCard)
		expect(cards).toHaveLength(1)
		expect(cards[0].props("record")).toMatchObject({ id: "0xfuel" })
	})

	it("toasts=false suppresses the completion toast (the Fuel tab's list-only mount — single toast owner)", async () => {
		mount(BridgeJournal, { props: { toasts: false }, global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = {
			id: "0xc",
			direction: "deposit",
			amount: (15n * 10n ** 18n).toString(), // Fee Juice — ALWAYS 18-dec, independent of the bridged token
			isPrivate: false,
			assetKind: "fee-juice",
			txHash: GOOD_HASH,
		}
		await nextTick()
		expect(push).not.toHaveBeenCalled()
	})

	it("a fee-juice completion toasts as Fee Juice, not the token (private → Private FJ)", async () => {
		mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = {
			id: "0xfj",
			direction: "deposit",
			amount: (15n * 10n ** 18n).toString(), // Fee Juice — ALWAYS 18-dec, independent of the bridged token
			isPrivate: true,
			assetKind: "fee-juice",
			txHash: GOOD_HASH,
		}
		await nextTick()
		expect(push).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Fueled Aztec with 15.00 Private FJ") }))
	})
})
