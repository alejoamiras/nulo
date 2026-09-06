import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { ActivityRowModel } from "@/composables/useActivityFeed"
import { TESTIDS } from "@/lib/testids"
import { rowModel as row } from "@/test/activity-row"
import ActivityRow from "./ActivityRow.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const mountRow = (r: ActivityRowModel, extra: Record<string, unknown> = {}) => mount(ActivityRow, { props: { row: r, ...extra } })

describe("ActivityRow", () => {
	it("is two lines: the amount, then route · visibility; a button in the side slot takes the age's room", () => {
		const w = mountRow(row())
		expect(w.get(".amt").text()).toBe("0.5 WETH")
		expect(w.get(".meta").text()).toBe("ETH → Aztec · public + gas")
		expect(w.get(sel(TESTIDS.activityRowOpen)).attributes("aria-label")).toBe("Open 0.5 WETH, ETH → Aztec, public + gas, 26m ago")
		expect(w.get(sel(TESTIDS.activityRowAction)).text()).toBe("CLAIM")
		expect(w.get(sel(TESTIDS.activityRowAction)).classes()).toContain("filled")
	})

	it("running rows show the phase word and the age; done rows say Bridged ✓ and dim", () => {
		const running = mountRow(row({ group: "running", action: null, phase: "crossing", age: "3m ago" }))
		expect(running.find(sel(TESTIDS.activityRowAction)).exists()).toBe(false)
		expect(running.get(".side").text()).toBe("crossing")
		expect(running.get(".meta").text()).toBe("ETH → Aztec · public + gas · 3m ago")
		const done = mountRow(row({ group: "done", action: null, age: "yesterday" }))
		expect(done.get(".side").text()).toBe("Bridged ✓")
		expect(done.classes()).toContain("dim")
	})

	it("a blocked row offers no button — the word alone; the card on Activity has the decision", () => {
		const w = mountRow(row({ action: null, blocked: true }))
		expect(w.find(sel(TESTIDS.activityRowAction)).exists()).toBe(false)
		expect(w.get(".side").text()).toBe("blocked")
	})

	it("every action has its label; a done row's gas recovery is an outline, never a second accent", () => {
		expect(
			mountRow(row({ action: "finish", direction: "withdraw" }))
				.get(sel(TESTIDS.activityRowAction))
				.text(),
		).toBe("FINISH")
		expect(
			mountRow(row({ action: "retry" }))
				.get(sel(TESTIDS.activityRowAction))
				.text(),
		).toBe("RETRY")
		const gas = mountRow(row({ group: "done", action: "claim-gas" })).get(sel(TESTIDS.activityRowAction))
		expect(gas.text()).toBe("CLAIM GAS")
		expect(gas.classes()).not.toContain("filled")
	})

	it("emits act with its id and action — never open with it; the row and its amount button open", async () => {
		const w = mountRow(row())
		await w.get(sel(TESTIDS.activityRowAction)).trigger("click")
		expect(w.emitted("act")).toEqual([["rec-1", "claim"]])
		expect(w.emitted("open")).toBeUndefined()
		await w.get(sel(TESTIDS.activityRowOpen)).trigger("click")
		await w.get(sel(TESTIDS.activityRow)).trigger("click")
		expect(w.emitted("open")).toEqual([["rec-1"], ["rec-1"]])
	})

	it("SWITCH is disabled while another operation runs, with the card's reason; acting rows are busy and inert", async () => {
		const sw = mountRow(row({ action: "switch", switchTarget: "0xother" }), { switchLocked: true })
		const btn = sw.get(sel(TESTIDS.activityRowAction))
		expect(btn.attributes("disabled")).toBeDefined()
		expect(btn.attributes("title")).toBe("Finish the current operation to switch.")
		await btn.trigger("click")
		expect(sw.emitted("act")).toBeUndefined()
		const acting = mountRow(row({ group: "done", action: "claim-gas" }), { acting: true })
		expect(acting.get(sel(TESTIDS.activityRowAction)).text()).toBe("CLAIMING…")
		expect(acting.get(sel(TESTIDS.activityRowAction)).attributes("aria-busy")).toBe("true")
	})
})
