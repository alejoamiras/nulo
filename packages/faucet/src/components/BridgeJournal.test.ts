import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick, ref } from "vue"

const visibleRecords = ref<BridgeJournalRecord[]>([])
const lastCompleted = ref<{ id: string; direction: "deposit" | "withdraw"; amount: string; isPrivate: boolean; txHash?: string } | null>(
	null,
)
const push = vi.fn()

vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ visibleRecords, lastCompleted, runtime: ref({}) }),
}))
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({ push }),
}))

const restoreFile = vi.fn(async (_raw: string) => ({ id: "0xrestored", direction: "deposit" as const, amount: "5000000" }))
vi.mock("@/composables/useBridgeBackup", () => ({
	useBridgeBackup: () => ({ restoreFile, exportBridge: vi.fn() }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeJournal from "./BridgeJournal.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const GOOD_HASH = `0x${"ab".repeat(32)}`

describe("BridgeJournal", () => {
	beforeEach(() => {
		visibleRecords.value = []
		lastCompleted.value = null
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
		expect(push).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok", text: expect.stringContaining("Restored: 5 USDC") }))

		push.mockClear()
		restoreFile.mockRejectedValueOnce(new Error("This bridge is already tracked here - nothing to restore."))
		Object.defineProperty(input.element, "files", { value: [file], configurable: true })
		await input.trigger("change")
		await vi.waitFor(() =>
			expect(push).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", text: expect.stringContaining("already tracked") })),
		)
	})

	it("renders the empty state from visibleRecords (the hide filter feeds this list)", () => {
		const w = mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		expect(w.find(sel(TESTIDS.journalEmpty)).exists()).toBe(true)
	})

	it("a completion pushes the toast with the explorer link (pin for the lastCompleted watcher)", async () => {
		const w = mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = { id: "0xa", direction: "deposit", amount: "100000000", isPrivate: false, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "ok",
				text: expect.stringContaining("Bridged 100 USDC to Aztec"),
				link: expect.objectContaining({ href: expect.stringContaining(GOOD_HASH) }),
			}),
		)
		expect(w.exists()).toBe(true)
	})

	it("withdraw completions toast the Ethereum wording with the etherscan link", async () => {
		mount(BridgeJournal, { global: { stubs: { BridgeJournalCard: true } } })
		lastCompleted.value = { id: "0xb", direction: "withdraw", amount: "40000000", isPrivate: true, txHash: GOOD_HASH }
		await nextTick()
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Released 40 USDC to Ethereum"),
				link: expect.objectContaining({ href: `https://sepolia.etherscan.io/tx/${GOOD_HASH}` }),
			}),
		)
	})
})
