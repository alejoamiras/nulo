import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import StepStrip, { type Step } from "./StepStrip.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const STEPS: readonly Step[] = [
	{ key: "token", label: "Token" },
	{ key: "amount", label: "Amount" },
	{ key: "review", label: "Review" },
]

function strip(props: Partial<{ steps: readonly Step[]; active: number; completed: number }> = {}) {
	return mount(StepStrip, {
		attachTo: document.body,
		props: { steps: STEPS, active: 1, completed: 1, ...props },
	})
}

describe("StepStrip", () => {
	it("renders one tab per step inside a tablist, numbering the steps still ahead", () => {
		const w = strip()
		expect(w.find(sel(TESTIDS.sendStepStrip)).attributes("role")).toBe("tablist")
		const tabs = w.findAll(sel(TESTIDS.sendStep))
		expect(tabs).toHaveLength(3)
		// The done step carries a check instead of its number.
		expect(tabs.map((t) => t.text())).toEqual(["Token", "2Amount", "3Review"])
		w.unmount()
	})

	it("a done step shows what was chosen there, and keeps its name for assistive tech", () => {
		const w = strip({ steps: [{ key: "token", label: "Token", value: "USDC" }, ...STEPS.slice(1)], active: 1, completed: 1 })
		const first = w.findAll(sel(TESTIDS.sendStep))[0]
		expect(first?.text()).toBe("USDC")
		expect(first?.attributes("aria-label")).toBe("Token: USDC")
		// The value is only shown once the step is behind the user.
		const again = strip({ steps: [{ key: "token", label: "Token", value: "USDC" }, ...STEPS.slice(1)], active: 0, completed: 0 })
		expect(again.findAll(sel(TESTIDS.sendStep))[0]?.text()).toBe("1Token")
		w.unmount()
		again.unmount()
	})

	it("lights the rule up to every step the user has reached", () => {
		const w = strip({ active: 1, completed: 1 })
		expect(w.findAll(".rule").map((r) => r.attributes("data-reached") !== undefined)).toEqual([true, false])
		w.unmount()
	})

	it("is ONE tab stop: only the active step is tabbable", () => {
		const w = strip({ active: 1, completed: 2 })
		expect(w.findAll(sel(TESTIDS.sendStep)).map((t) => t.attributes("tabindex"))).toEqual(["-1", "0", "-1"])
		w.unmount()
	})

	it("marks each step done / active / todo", () => {
		const w = strip({ active: 1, completed: 1 })
		expect(w.findAll(sel(TESTIDS.sendStep)).map((t) => t.attributes("data-state"))).toEqual(["done", "active", "todo"])
		w.unmount()
	})

	it("clicking a reached step selects it", async () => {
		const w = strip({ active: 1, completed: 1 })
		await w.findAll(sel(TESTIDS.sendStep))[0]?.trigger("click")
		expect(w.emitted("select")).toEqual([[0]])
		w.unmount()
	})

	it("clicking a step past `completed` selects nothing", async () => {
		const w = strip({ active: 1, completed: 1 })
		const locked = w.findAll(sel(TESTIDS.sendStep))[2]
		expect(locked?.attributes("aria-disabled")).toBe("true")
		await locked?.trigger("click")
		expect(w.emitted("select")).toBeUndefined()
		w.unmount()
	})

	it("→ moves focus to the next step and selects it when reached", async () => {
		const w = strip({ active: 0, completed: 2 })
		await w.findAll(sel(TESTIDS.sendStep))[0]?.trigger("keydown", { key: "ArrowRight" })
		expect(document.activeElement).toBe(w.findAll(sel(TESTIDS.sendStep))[1]?.element)
		expect(w.emitted("select")).toEqual([[1]])
		w.unmount()
	})

	it("← wraps to the last step, and a locked one takes focus without selecting", async () => {
		const w = strip({ active: 0, completed: 0 })
		await w.findAll(sel(TESTIDS.sendStep))[0]?.trigger("keydown", { key: "ArrowLeft" })
		expect(document.activeElement).toBe(w.findAll(sel(TESTIDS.sendStep))[2]?.element)
		expect(w.emitted("select")).toBeUndefined()
		w.unmount()
	})

	it("Enter and Space activate the focused step", async () => {
		const w = strip({ active: 1, completed: 2 })
		const tabs = w.findAll(sel(TESTIDS.sendStep))
		await tabs[0]?.trigger("keydown", { key: "Enter" })
		await tabs[2]?.trigger("keydown", { key: " " })
		expect(w.emitted("select")).toEqual([[0], [2]])
		w.unmount()
	})

	it("vertical: says so for assistive tech, stacks the hints, drops the rules, and ↑/↓ move like ←/→", async () => {
		const w = mount(StepStrip, {
			props: { steps: STEPS.map((s, i) => ({ ...s, hint: `hint ${i}` })), active: 1, completed: 1, orientation: "vertical" },
			attachTo: document.body,
		})
		expect(w.get(sel(TESTIDS.sendStepStrip)).attributes("aria-orientation")).toBe("vertical")
		expect(w.findAll(".rule")).toHaveLength(0)
		expect(w.findAll(".hint").map((h) => h.text())).toEqual(["hint 0", "hint 1", "hint 2"])
		await w.findAll(sel(TESTIDS.sendStep))[1]?.trigger("keydown", { key: "ArrowUp" })
		expect(w.emitted("select")).toEqual([[0]])
		expect(document.activeElement).toBe(w.findAll(sel(TESTIDS.sendStep))[0]?.element)
		await w.findAll(sel(TESTIDS.sendStep))[0]?.trigger("keydown", { key: "ArrowDown" })
		expect(w.emitted("select")).toEqual([[0], [1]])
		w.unmount()
	})

	it("horizontal: ↑/↓ are not navigation, and hints stay off the strip", async () => {
		const w = mount(StepStrip, {
			props: { steps: STEPS.map((s) => ({ ...s, hint: "h" })), active: 1, completed: 1 },
			attachTo: document.body,
		})
		expect(w.get(sel(TESTIDS.sendStepStrip)).attributes("aria-orientation")).toBe("horizontal")
		expect(w.findAll(".hint")).toHaveLength(0)
		await w.findAll(sel(TESTIDS.sendStep))[1]?.trigger("keydown", { key: "ArrowUp" })
		expect(w.emitted("select")).toBeUndefined()
		w.unmount()
	})
})
