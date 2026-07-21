import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { enableAutoUnmount, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

// A stale mounted form from a prior test still watches the SHARED journal refs and its fail-open
// guard would fire (and count a releaseForeground call) during the next test - unmount between tests.
enableAutoUnmount(afterEach)

const isConnected = ref(true)
const bridgeStatus = ref<string>("connected")
const balance = ref<bigint | null>(1000n * 10n ** 18n)
const fuelError = ref<string | null>(null)
const activeFlowId = ref<string | null>(null)
const records = ref<BridgeJournalRecord[]>([])
const feeRefresh = vi.fn()
const claimForeground = vi.fn((id: string) => {
	activeFlowId.value = id
})
const releaseForeground = vi.fn((id: string) => {
	if (activeFlowId.value === id) activeFlowId.value = null
})
function fuelRecord(over: Partial<BridgeJournalRecord> = {}): BridgeJournalRecord {
	return {
		id: "rec-1",
		assetKind: "fee-juice",
		direction: "deposit",
		amount: "20000000000000000000",
		isPrivate: true,
		createdAt: 1000,
		depositTxHash: "0xdep",
		claimTxHash: "0xclaim",
		...over,
	} as unknown as BridgeJournalRecord
}

const deposit = vi.fn(async (_units: bigint, _isPrivate: boolean, opts: { onRecord: (id: string) => void }) => {
	records.value = [fuelRecord()]
	opts.onRecord("rec-1")
})

vi.mock("@/composables/useL1Wallet", () => ({ useL1Wallet: () => ({ isConnected }) }))
vi.mock("@/composables/useBridgeWallet", () => ({ useBridgeWallet: () => ({ status: bridgeStatus }) }))
vi.mock("@/composables/useL1FeeAsset", () => ({ FUEL_ASSET_DECIMALS: 18, useL1FeeAsset: () => ({ balance, refresh: feeRefresh }) }))
vi.mock("@/composables/useFuel", () => ({ useFuelFlow: () => ({ error: fuelError, deposit }) }))
vi.mock("@/composables/useBridgeBackup", () => ({ useBridgeBackup: () => ({ exportBridgeWithToast: vi.fn() }) }))
vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ activeFlowId, records, claimForeground, releaseForeground }),
}))
// Deterministic minimum for the debounce cases (the real constant is deployment-derived).
vi.mock("@/contracts/bridge-deployments", () => ({ FUEL_MIN_FJ: 16n * 10n ** 18n }))

import { TESTIDS } from "@/lib/testids"
import FuelForm from "./FuelForm.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const STUBS = {
	BridgeStepper: { template: '<div data-testid="stub-stepper" />' },
	BridgeReceipt: {
		props: ["snapshot", "ctaLabel"],
		template:
			'<div data-testid="stub-receipt" :data-cta="ctaLabel" :data-kind="snapshot.assetKind"><button data-testid="stub-newfuel" @click="$emit(\'new-bridge\')" /></div>',
		emits: ["new-bridge"],
	},
}

describe("FuelForm: completion → receipt → new fuel", () => {
	beforeEach(() => {
		isConnected.value = true
		bridgeStatus.value = "connected"
		activeFlowId.value = null
		records.value = []
		fuelError.value = null
		deposit.mockClear()
		releaseForeground.mockClear()
	})

	it("submit → stepper; the record completes → receipt (NEW FUEL, fee-juice); NEW FUEL resets to the form", async () => {
		const w = mount(FuelForm, { global: { stubs: STUBS } })
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)

		// submit → deposit → onRecord → stepper takeover
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await w.vm.$nextTick()
		expect(deposit).toHaveBeenCalled()
		expect(w.find('[data-testid="stub-stepper"]').exists()).toBe(true)
		expect(w.find('[data-testid="stub-receipt"]').exists()).toBe(false)

		// the record completes → watch flips to the receipt (this is the gap the user hit)
		records.value = [fuelRecord({ completedAt: 5000 } as Partial<BridgeJournalRecord>)]
		await w.vm.$nextTick()
		const receipt = w.find('[data-testid="stub-receipt"]')
		expect(receipt.exists()).toBe(true)
		expect(receipt.attributes("data-cta")).toBe("NEW FUEL")
		expect(receipt.attributes("data-kind")).toBe("fee-juice")
		expect(w.find('[data-testid="stub-stepper"]').exists()).toBe(false)
		// Completion released the takeover so the finished record surfaces in "Your fuels".
		expect(releaseForeground).toHaveBeenCalledWith("rec-1")

		// NEW FUEL → reset to the form (the record stays in the journal history)
		await w.find('[data-testid="stub-newfuel"]').trigger("click")
		await w.vm.$nextTick()
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)
	})

	it("a rejected fuel (record discarded pre-deposit) self-heals to the form instead of soft-bricking", async () => {
		const w = mount(FuelForm, { global: { stubs: STUBS } })
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await w.vm.$nextTick()
		expect(w.find('[data-testid="stub-stepper"]').exists()).toBe(true)
		// The rejection path discards the record; the foreground id keeps pointing at the dead id.
		records.value = []
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		expect(releaseForeground).toHaveBeenCalledWith("rec-1")
		// The form is back AND submittable (formStage reset - the old bug left it stuck in "stepper").
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		expect(deposit).toHaveBeenCalledTimes(2)
	})

	it("a Bridge-tab takeover (foreground re-pointed at a token record) stands this form down without releasing", async () => {
		const w = mount(FuelForm, { global: { stubs: STUBS } })
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await w.vm.$nextTick()
		expect(w.find('[data-testid="stub-stepper"]').exists()).toBe(true)
		// Both forms stay mounted (App.vue v-show); a bridge submit overwrites the shared foreground.
		// Our record STAYS in the journal - only the foreground moved.
		records.value = [fuelRecord(), fuelRecord({ id: "rec-2", assetKind: "bridge-token" } as Partial<BridgeJournalRecord>)]
		activeFlowId.value = "rec-2"
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		// This form resets but must NOT release the OTHER form's live takeover.
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)
		expect(releaseForeground).not.toHaveBeenCalled()
		expect(activeFlowId.value).toBe("rec-2")
	})

	it("RACE: a completion and a foreground usurp in the same flush still produce the receipt", async () => {
		// The fresh-eyes audit's Medium: the other form's onRecord can re-point activeFlowId between the
		// completion WRITE and the Vue flush. A foreground-derived watcher would follow the usurper and
		// silently drop the receipt (with the toast suppressed by the synchronous foreground capture).
		// The ownedId-keyed watcher receipts our record regardless.
		const w = mount(FuelForm, { global: { stubs: STUBS } })
		await w.find(sel(TESTIDS.fuelSubmit)).trigger("click")
		await w.vm.$nextTick()
		expect(w.find('[data-testid="stub-stepper"]').exists()).toBe(true)
		// Same tick, no flush between: our record completes AND the Bridge form takes the foreground.
		records.value = [
			fuelRecord({ completedAt: 5000 } as Partial<BridgeJournalRecord>),
			fuelRecord({ id: "rec-2", assetKind: "bridge-token" } as Partial<BridgeJournalRecord>),
		]
		activeFlowId.value = "rec-2"
		await w.vm.$nextTick()
		await w.vm.$nextTick()
		expect(w.find('[data-testid="stub-receipt"]').exists()).toBe(true)
	})
})

describe("FuelForm: minimum-amount error display is settle-debounced", () => {
	beforeEach(() => {
		isConnected.value = true
		bridgeStatus.value = "connected"
		activeFlowId.value = null
		records.value = []
		fuelError.value = null
	})

	it("typing a below-minimum amount shows no error until the settle window elapses", async () => {
		vi.useFakeTimers()
		try {
			const w = mount(FuelForm, { global: { stubs: STUBS } })
			await w.find(sel(TESTIDS.fuelAmount)).setValue("15")
			expect(w.find(sel(TESTIDS.fuelFormError)).exists()).toBe(false)
			vi.advanceTimersByTime(600)
			await w.vm.$nextTick()
			expect(w.find(sel(TESTIDS.fuelFormError)).text()).toContain("Minimum is 16")
		} finally {
			vi.useRealTimers()
		}
	})

	it("blur settles instantly — no window wait for a deliberate leave", async () => {
		vi.useFakeTimers()
		try {
			const w = mount(FuelForm, { global: { stubs: STUBS } })
			const input = w.find(sel(TESTIDS.fuelAmount))
			await input.setValue("15")
			expect(w.find(sel(TESTIDS.fuelFormError)).exists()).toBe(false)
			await input.trigger("blur")
			expect(w.find(sel(TESTIDS.fuelFormError)).text()).toContain("Minimum is 16")
		} finally {
			vi.useRealTimers()
		}
	})
})
