import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

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
const releaseForeground = vi.fn(() => {
	activeFlowId.value = null
})
// `hideCompleted` is a NAMED export referenced eagerly in the mock's return object (not inside a lazy
// factory arrow like the refs), so it must be hoisted above the vi.mock call.
const hideCompleted = vi.hoisted(() => vi.fn())

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
	hideCompleted,
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
		hideCompleted.mockClear()
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

		// NEW FUEL → hide the completed card + reset to the form
		await w.find('[data-testid="stub-newfuel"]').trigger("click")
		await w.vm.$nextTick()
		expect(hideCompleted).toHaveBeenCalledWith("rec-1")
		expect(w.find(sel(TESTIDS.fuelSubmit)).exists()).toBe(true)
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
