import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import FeePriorityRow from "./FeePriorityRow.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
}

const factory = (props: Record<string, unknown> = { modelValue: "normal" }) => mount(FeePriorityRow, { props, global: { stubs: STUBS } })

describe("FeePriorityRow", () => {
	test("renders the three priority buttons with stable testids", () => {
		const w = factory()
		expect(w.find('[data-testid="send-fee-priority-normal"]').exists()).toBe(true)
		expect(w.find('[data-testid="send-fee-priority-fast"]').exists()).toBe(true)
		expect(w.find('[data-testid="send-fee-priority-urgent"]').exists()).toBe(true)
	})

	test("the active button gets the priority_active class", () => {
		const w = factory({ modelValue: "fast" })
		const cls = w.find('[data-testid="send-fee-priority-fast"]').attributes("class") || ""
		expect(cls).toContain("priority_active")
	})

	test("inactive buttons don't get priority_active", () => {
		const w = factory({ modelValue: "fast" })
		const cls = w.find('[data-testid="send-fee-priority-normal"]').attributes("class") || ""
		expect(cls).not.toContain("priority_active")
	})

	test("clicking a button emits update:modelValue with that level", async () => {
		const w = factory({ modelValue: "normal" })
		await w.find('[data-testid="send-fee-priority-urgent"]').trigger("click")
		expect(w.emitted("update:modelValue")?.[0]).toEqual(["urgent"])
	})

	test("renders the 'Priority' section label", () => {
		const w = factory()
		expect(w.text()).toContain("Priority")
	})
})
