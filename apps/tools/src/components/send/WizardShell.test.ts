import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { nextTick } from "vue"
import type { Direction } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import WizardShell from "./WizardShell.vue"

const sel = (t: string) => `[data-testid="${t}"]`

// The step components are the other half of the wizard; the shell only has to place them.
const stubs = { StepStrip: { name: "StepStrip", props: ["steps", "active", "completed"], template: "<div data-strip />" } }

function shell(props: Partial<{ direction: Direction; step: 0 | 1 | 2; completed: number; canSwitchDirection: boolean }> = {}) {
	return mount(WizardShell, {
		props: { direction: "l1-to-l2", step: 0, completed: 0, canSwitchDirection: true, ...props },
		slots: { token: "<p>TOKEN SLOT</p>", amount: "<p>AMOUNT SLOT</p>", review: "<p>REVIEW SLOT</p>" },
		global: { stubs },
		attachTo: document.body,
	})
}

describe("WizardShell", () => {
	it("renders both directions as a tablist", () => {
		const w = shell()
		expect(w.find(sel(TESTIDS.sendDirection)).attributes("role")).toBe("tablist")
		expect(w.find(sel(TESTIDS.sendDirectionDeposit)).text()).toBe("Ethereum → Aztec")
		expect(w.find(sel(TESTIDS.sendDirectionExit)).text()).toBe("Aztec → Ethereum")
	})

	it("is ONE Tab stop: only the selected direction is tabbable", () => {
		const w = shell({ direction: "l2-to-l1" })
		expect(w.find(sel(TESTIDS.sendDirectionExit)).attributes("tabindex")).toBe("0")
		expect(w.find(sel(TESTIDS.sendDirectionDeposit)).attributes("tabindex")).toBe("-1")
	})

	it("marks the selected direction for assistive tech", () => {
		const w = shell()
		expect(w.find(sel(TESTIDS.sendDirectionDeposit)).attributes("aria-selected")).toBe("true")
		expect(w.find(sel(TESTIDS.sendDirectionExit)).attributes("aria-selected")).toBe("false")
	})

	it("clicking the other direction emits it", async () => {
		const w = shell()
		await w.find(sel(TESTIDS.sendDirectionExit)).trigger("click")
		expect(w.emitted("update:direction")).toEqual([["l2-to-l1"]])
	})

	it("clicking the direction already selected emits nothing", async () => {
		const w = shell()
		await w.find(sel(TESTIDS.sendDirectionDeposit)).trigger("click")
		expect(w.emitted("update:direction")).toBeUndefined()
	})

	it("→ and ← wrap around the segment and move focus with the selection", async () => {
		const w = shell()
		await w.find(sel(TESTIDS.sendDirectionDeposit)).trigger("keydown.right")
		expect(w.emitted("update:direction")).toEqual([["l2-to-l1"]])
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendDirectionExit)).element)
		await w.find(sel(TESTIDS.sendDirectionDeposit)).trigger("keydown.left")
		expect(w.emitted("update:direction")).toEqual([["l2-to-l1"], ["l2-to-l1"]])
	})

	it("canSwitchDirection=false disables the segment and refuses click + arrow", async () => {
		const w = shell({ canSwitchDirection: false })
		expect(w.find(sel(TESTIDS.sendDirection)).attributes("data-locked")).toBe("true")
		expect(w.find(sel(TESTIDS.sendDirectionExit)).attributes("disabled")).toBeDefined()
		await w.find(sel(TESTIDS.sendDirectionExit)).trigger("click")
		await w.find(sel(TESTIDS.sendDirectionDeposit)).trigger("keydown.right")
		expect(w.emitted("update:direction")).toBeUndefined()
	})

	it("hands the strip the three steps plus the active and completed indices", () => {
		const strip = shell({ step: 1, completed: 1 }).findComponent({ name: "StepStrip" })
		expect(strip.props("steps").map((s: { label: string }) => s.label)).toEqual(["Token", "Amount", "Review"])
		expect(strip.props("active")).toBe(1)
		expect(strip.props("completed")).toBe(1)
	})

	it("forwards the strip's select as goto", () => {
		const w = shell({ step: 2, completed: 2 })
		w.findComponent({ name: "StepStrip" }).vm.$emit("select", 0)
		expect(w.emitted("goto")).toEqual([[0]])
	})

	it("renders exactly the active step's slot", () => {
		expect(shell({ step: 0 }).text()).toContain("TOKEN SLOT")
		expect(shell({ step: 1 }).text()).toContain("AMOUNT SLOT")
		const review = shell({ step: 2 })
		expect(review.text()).toContain("REVIEW SLOT")
		expect(review.text()).not.toContain("TOKEN SLOT")
	})

	it("moves focus into the new step instead of dropping it on the body", async () => {
		const w = shell()
		document.body.focus()
		await w.setProps({ step: 1 })
		await nextTick()
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendStepPanel)).element)
	})

	it("leaves focus alone on arrival — only a step CHANGE takes it", () => {
		const w = shell({ step: 1 })
		expect(document.activeElement).not.toBe(w.find(sel(TESTIDS.sendStepPanel)).element)
	})

	it("announces the step politely, by position and name", async () => {
		const w = shell()
		const live = w.find(sel(TESTIDS.sendStepAnnounce))
		expect(live.attributes("aria-live")).toBe("polite")
		expect(live.text()).toBe("Step 1 of 3 — what are you sending?")
		await w.setProps({ step: 2 })
		expect(w.find(sel(TESTIDS.sendStepAnnounce)).text()).toBe("Step 3 of 3 — check it, then sign.")
	})

	it("never emits a positive tabindex anywhere in the segment", () => {
		const values = shell()
			.findAll("[tabindex]")
			.map((n) => Number(n.attributes("tabindex")))
		expect(values.every((v) => v <= 0)).toBe(true)
	})
})
