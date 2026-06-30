import type { DepositJournalRecord } from "@nulo/bridge-core"
import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { RecordRuntime } from "@/composables/useBridgeJournal"
import { __resetPhaseClockForTests } from "@/lib/phase-clock"

const runtime = ref<Record<string, RecordRuntime>>({})

vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ runtime }),
}))

// The shared app clock is driven manually here (fake timers don't reach the module interval).
const mockNow = ref(10_000)
vi.mock("@/lib/clock", () => ({
	useNow: () => mockNow,
}))

import { TESTIDS } from "@/lib/testids"
import BridgePhaseRail from "./BridgePhaseRail.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const DEPLOY = { chainId: 11155111, portal: "0xp", bridge: "0xb" }

function dep(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xrail",
		direction: "deposit",
		isPrivate: true,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xa",
		secretHashHex: "0xrail",
		...DEPLOY,
		...over,
	}
}

describe("BridgePhaseRail", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(10_000)
		mockNow.value = 10_000
		runtime.value = {}
		__resetPhaseClockForTests()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("full rail: SYNC renders the block bar + counts + ETA", () => {
		runtime.value = { "0xt1": { step: "syncing", syncBlock: 102 } }
		const w = mount(BridgePhaseRail, {
			props: { record: dep({ id: "0xt1", depositTxHash: "0xt", leafIndex: "7", depositL2Block: 100 }) },
		})
		const sync = w.findAll(sel(TESTIDS.stepperPhase)).find((p) => p.attributes("data-phase") === "sync")
		expect(sync?.text()).toContain("102 / 103")
		expect(sync?.text()).toMatch(/▓+░+/)
		expect(sync?.text()).toMatch(/usually 1-4 min/)
		w.unmount()
	})

	it("full rail: a completed phase keeps its duration (labor record) after the transition", async () => {
		runtime.value = { "0xt2": { step: "sealing" } }
		const w = mount(BridgePhaseRail, { props: { record: dep({ id: "0xt2", secretHashHex: "0xt2" }) } })
		vi.setSystemTime(24_000) // stamps read the real (faked) clock; mockNow only drives renders.
		mockNow.value = 24_000
		runtime.value = { "0xt2": { step: "approving" } }
		await w.vm.$nextTick()
		const seal = w.findAll(sel(TESTIDS.stepperPhase)).find((p) => p.attributes("data-phase") === "seal")
		expect(seal?.attributes("data-state")).toBe("done")
		await w.vm.$nextTick()
		expect(seal?.text()).toMatch(/14s/)
		w.unmount()
	})

	it("compact rail: glyph strip + the live detail under the journalStep testid", () => {
		runtime.value = { "0xt3": { step: "confirming", stepDetail: "check 12 - the claim is processing on Aztec" } }
		const w = mount(BridgePhaseRail, {
			props: { record: dep({ id: "0xt3", depositTxHash: "0xt", leafIndex: "7", claimTxHash: "0xc" }), compact: true },
		})
		expect(w.find(sel(TESTIDS.journalRail)).exists()).toBe(true)
		expect(w.findAll(sel(TESTIDS.journalPhase))).toHaveLength(6)
		expect(w.find(sel(TESTIDS.journalStep)).text()).toContain("check 12")
		w.unmount()
	})

	it("compact rail: active phase shows its label + a ticking clock", async () => {
		runtime.value = { "0xt4": { step: "syncing" } }
		const w = mount(BridgePhaseRail, { props: { record: dep({ id: "0xt4", depositTxHash: "0xt", leafIndex: "7" }), compact: true } })
		mockNow.value = 73_000
		await w.vm.$nextTick()
		expect(w.text()).toContain("CROSSING")
		expect(w.text()).toMatch(/1m 03s/)
		w.unmount()
	})
})
