import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { RecordRuntime } from "@/composables/useBridgeJournal"

const runtime = ref<Record<string, RecordRuntime>>({})
const runDepositClaim = vi.fn(async () => {})
const runWithdrawConsume = vi.fn(async () => {})

vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ runtime, runDepositClaim, runWithdrawConsume }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeStepper from "./BridgeStepper.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const DEPLOY = { chainId: 11155111, portal: "0xp", bridge: "0xb" }

function dep(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xd",
		direction: "deposit",
		isPrivate: true,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xa",
		secretHashHex: "0xd",
		...DEPLOY,
		...over,
	}
}

describe("BridgeStepper", () => {
	beforeEach(() => {
		runtime.value = {}
		runDepositClaim.mockClear()
		runWithdrawConsume.mockClear()
	})

	it("renders the phase rail with data-phase/data-state from the mapper", () => {
		runtime.value = { "0xd": { step: "sealing" } }
		const w = mount(BridgeStepper, { props: { record: dep() } })
		const phases = w.findAll(sel(TESTIDS.stepperPhase))
		expect(phases.map((p) => p.attributes("data-phase"))).toEqual(["seal", "approve", "deposit", "sync", "claim", "confirm"])
		expect(phases[0].attributes("data-state")).toBe("active")
		expect(phases[0].text()).toMatch(/encrypts this bridge's recovery secret/i)
	})

	it("skipped APPROVE renders the badge", () => {
		runtime.value = { "0xd": { approveOutcome: "skipped" } }
		const w = mount(BridgeStepper, { props: { record: dep({ depositTxHash: "0xt" }) } })
		const approve = w.findAll(sel(TESTIDS.stepperPhase)).find((p) => p.attributes("data-phase") === "approve")
		expect(approve?.attributes("data-state")).toBe("skipped")
		expect(approve?.text()).toContain("SKIPPED")
	})

	it("RETRY shows only for engine-drivable failed phases and routes to the engine action", async () => {
		// Failed SYNC (engine phase) ⇒ RETRY visible, routes to runDepositClaim.
		runtime.value = { "0xd": { attention: "error", note: "boom" } }
		const w = mount(BridgeStepper, { props: { record: dep({ depositTxHash: "0xt", leafIndex: "7" }) } })
		await w.find(sel(TESTIDS.stepperRetry)).trigger("click")
		expect(runDepositClaim).toHaveBeenCalledWith("0xd")

		// Failed DEPOSIT leg (flow phase, post-tx-less) ⇒ NO retry button (plan S9 honest routing).
		const w2 = mount(BridgeStepper, { props: { record: dep() } })
		expect(w2.find(sel(TESTIDS.stepperRetry)).exists()).toBe(false)
	})

	it("the ⤓ export icon emits backup with the record", async () => {
		const w = mount(BridgeStepper, { props: { record: dep() } })
		await w.find(sel(TESTIDS.stepperBackup)).trigger("click")
		expect(w.emitted("backup")?.[0]?.[0]).toMatchObject({ id: "0xd" })
	})

	it("background emits", async () => {
		const w = mount(BridgeStepper, { props: { record: dep() } })
		await w.find(sel(TESTIDS.stepperBackground)).trigger("click")
		expect(w.emitted("background")).toHaveLength(1)
	})

	it("withdraw rail renders the countdown detail on PROVE", () => {
		const rec: WithdrawJournalRecord = {
			schema: 1,
			id: "0xw",
			direction: "withdraw",
			isPrivate: false,
			amount: "40000000",
			createdAt: 1,
			updatedAt: 1,
			recipientL1: "0xe",
			exitTxHash: "0xw",
			...DEPLOY,
		}
		runtime.value = { "0xw": { provenBlock: 5, targetBlock: 9 } }
		const w = mount(BridgeStepper, { props: { record: rec } })
		const prove = w.findAll(sel(TESTIDS.stepperPhase)).find((p) => p.attributes("data-phase") === "prove")
		expect(prove?.attributes("data-state")).toBe("active")
		expect(prove?.text()).toContain("Proven block 5 of 9")
	})
})
