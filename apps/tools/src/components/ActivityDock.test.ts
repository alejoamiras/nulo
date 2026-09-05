import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { computed, nextTick, ref } from "vue"
import type { ActivityFeed, ActivityRowModel } from "@/composables/useActivityFeed"
import { __resetDockStateForTests, DOCK_KEY, DOCK_SEEN_KEY, useDockState } from "@/composables/useDockState"
import { __resetShellForTests, useShell } from "@/composables/useShell"
import { groupRecords, needsYouCount } from "@/lib/activity"
import { TESTIDS } from "@/lib/testids"
import { rowModel } from "@/test/activity-row"

const runDepositClaim = vi.fn(async (_id: string) => {})
const runWithdrawConsume = vi.fn(async (_id: string) => {})
vi.mock("@/composables/useBridgeJournal", () => ({ useBridgeJournal: () => ({ runDepositClaim, runWithdrawConsume }) }))
const opsBusy = ref(false)
vi.mock("@/composables/useOpsInFlight", () => ({ useOpsInFlight: () => ({ busy: opsBusy }) }))
const switchActiveAccount = vi.fn((_address: string) => true)
vi.mock("@/composables/useWalletConnection", () => ({ switchActiveAccount: (a: string) => switchActiveAccount(a) }))
let releaseGas = (): void => {}
let failGas = (_e: unknown): void => {}
const claimFuelStandalone = vi.fn(
	(_id: string) =>
		new Promise<void>((resolve, reject) => {
			releaseGas = resolve
			failGas = reject
		}),
)
vi.mock("@/composables/fuel-recovery", () => ({ claimFuelStandalone: (id: string) => claimFuelStandalone(id) }))
const push = vi.fn()
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ push }) }))

import ActivityDock from "./ActivityDock.vue"

const sel = (t: string) => `[data-testid="${t}"]`

/** A feed the test drives by hand: the same derived shape `useActivityFeed` produces. */
const rows = ref<ActivityRowModel[]>([])
const feed: ActivityFeed = {
	rows: computed(() => rows.value),
	grouped: computed(() => groupRecords(rows.value)),
	count: computed(() => needsYouCount(rows.value)),
	autoOpenIds: computed(() => rows.value.filter((r) => r.group === "needs-you" && !r.blocked).map((r) => r.id)),
	liveIds: computed(() => new Set(rows.value.map((r) => r.id))),
}

const dock = () => mount(ActivityDock, { props: { feed }, attachTo: document.body })

describe("ActivityDock", () => {
	beforeEach(() => {
		localStorage.clear()
		rows.value = []
		opsBusy.value = false
		__resetDockStateForTests()
		__resetShellForTests()
		vi.clearAllMocks()
		document.body.innerHTML = ""
	})

	it("is hidden by default: the strip, no badge while nothing needs you", () => {
		const w = dock()
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.dockStrip)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.dockBadge)).exists()).toBe(false)
	})

	it("running never badges; needs-you does, blocked rows included", async () => {
		rows.value = [rowModel({ id: "a", group: "running", action: null })]
		const w = dock()
		expect(w.find(sel(TESTIDS.dockBadge)).exists()).toBe(false)
		rows.value = [...rows.value, rowModel({ id: "b", action: null, blocked: true })]
		await nextTick()
		expect(w.get(sel(TESTIDS.dockBadge)).text()).toBe("1")
		// A blocked record counts but never opened the dock.
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(false)
	})

	it("show persists the choice; hide persists it, marks the needs-you rows seen, and moves focus to the strip", async () => {
		rows.value = [rowModel({ id: "a", action: null, blocked: true })]
		const w = dock()
		await w.get(sel(TESTIDS.dockOpen)).trigger("click")
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(true)
		expect(localStorage.getItem(DOCK_KEY)).toBe("open")
		await w.get(sel(TESTIDS.dockHide)).trigger("click")
		await nextTick()
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(false)
		expect(localStorage.getItem(DOCK_KEY)).toBe("hidden")
		expect(JSON.parse(localStorage.getItem(DOCK_SEEN_KEY) ?? "[]")).toEqual(["a"])
		expect(document.activeElement).toBe(w.get(sel(TESTIDS.dockOpen)).element)
	})

	it("opens itself once for a record that starts needing you — never for a blocked one, never twice, never touching the choice", async () => {
		rows.value = [rowModel({ id: "blocked", action: null, blocked: true })]
		const w = dock()
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(false)
		rows.value = [...rows.value, rowModel({ id: "claim" })]
		await nextTick()
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(true)
		expect(localStorage.getItem(DOCK_KEY)).toBeNull()
		await w.get(sel(TESTIDS.dockHide)).trigger("click")
		// The same record re-entering needs-you (a RETRY, a reload) does not reopen it.
		rows.value = [rows.value[0] as ActivityRowModel]
		await nextTick()
		rows.value = [...rows.value, rowModel({ id: "claim", action: "retry" })]
		await nextTick()
		expect(w.find(sel(TESTIDS.dock)).exists()).toBe(false)
		expect(w.get(sel(TESTIDS.dockBadge)).text()).toBe("2")
	})

	it("groups rows under Needs you / Running / Done with counts, and an empty dock says so", async () => {
		useDockState().show()
		const w = dock()
		expect(w.text()).toContain("Bridges you start or background land here.")
		rows.value = [
			rowModel({ id: "n", createdAt: 3 }),
			rowModel({ id: "r", group: "running", action: null, phase: "crossing", createdAt: 2 }),
			rowModel({ id: "d", group: "done", action: null, createdAt: 1 }),
		]
		await nextTick()
		const groups = w.findAll(sel(TESTIDS.dockGroup))
		expect(groups.map((g) => g.attributes("data-group"))).toEqual(["needs-you", "running", "done"])
		expect(groups.map((g) => g.get("h3").text())).toEqual(["Needs you1", "Running1", "Done1"])
		expect(w.text()).toContain("3 records")
	})

	it("dispatches each action to the engine entry the card uses, by the row's direction", async () => {
		useDockState().show()
		rows.value = [
			rowModel({ id: "dep", action: "claim" }),
			rowModel({ id: "wd", direction: "withdraw", action: "finish" }),
			rowModel({ id: "rt", direction: "withdraw", action: "retry" }),
			rowModel({ id: "sw", action: "switch", switchTarget: "0xcanon" }),
		]
		const w = dock()
		const buttons = w.findAll(sel(TESTIDS.activityRowAction))
		for (const b of buttons) await b.trigger("click")
		expect(runDepositClaim).toHaveBeenCalledWith("dep")
		expect(runWithdrawConsume.mock.calls.map(([id]) => id)).toEqual(["wd", "rt"])
		expect(switchActiveAccount).toHaveBeenCalledWith("0xcanon")
	})

	it("SWITCH is refused while an operation runs; CLAIM GAS cannot double-fire and reports a failure as a toast", async () => {
		useDockState().show()
		opsBusy.value = true
		rows.value = [
			rowModel({ id: "sw", action: "switch", switchTarget: "0xcanon" }),
			rowModel({ id: "gas", group: "done", action: "claim-gas" }),
		]
		const w = dock()
		const [sw, gas] = w.findAll(sel(TESTIDS.activityRowAction))
		expect(sw?.attributes("disabled")).toBeDefined()
		await gas?.trigger("click")
		await gas?.trigger("click")
		expect(claimFuelStandalone).toHaveBeenCalledTimes(1)
		expect(gas?.text()).toBe("CLAIMING…")
		failGas(new Error("Fee juice already claimed"))
		await flushPromises()
		expect(push).toHaveBeenCalledWith({ kind: "error", text: "Fee juice already claimed" })
		expect(gas?.text()).toBe("CLAIM GAS")
		await gas?.trigger("click")
		expect(claimFuelStandalone).toHaveBeenCalledTimes(2)
		releaseGas()
	})

	it("a row body opens Activity on that record; the foot opens the page", async () => {
		useDockState().show()
		rows.value = [rowModel({ id: "rec-9", group: "running", action: null })]
		const w = dock()
		await w.get(sel(TESTIDS.activityRowOpen)).trigger("click")
		expect(useShell().section.value).toBe("activity")
		expect(useShell().highlightedId.value).toBe("rec-9")
		__resetShellForTests()
		await w.get(sel(TESTIDS.dockAll)).trigger("click")
		expect(useShell().section.value).toBe("activity")
		expect(useShell().highlightedId.value).toBeNull()
	})
})
