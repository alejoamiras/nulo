import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import ProcessingErrorNote from "./ProcessingErrorNote.vue"

const STUBS = {
	Tooltip: {
		props: ["disabled"],
		template: `<div data-testid="note" :data-tooltip-disabled="String(disabled)"><slot /><slot name="content" /></div>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

describe("ProcessingErrorNote", () => {
	test("hidden while show is false", () => {
		const w = mount(ProcessingErrorNote, { props: { show: false, title: "x" }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="note"]').exists()).toBe(false)
	})

	test("renders the title when shown", () => {
		const w = mount(ProcessingErrorNote, {
			props: { show: true, title: "Failed to add contact.", tooltip: "boom" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Failed to add contact.")
		expect(w.text()).toContain("boom")
	})

	test("tooltip is disabled when there is no detail", () => {
		const w = mount(ProcessingErrorNote, { props: { show: true, title: "t" }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="note"]').attributes("data-tooltip-disabled")).toBe("true")
	})

	test("tooltip is enabled when detail exists", () => {
		const w = mount(ProcessingErrorNote, {
			props: { show: true, title: "t", tooltip: "detail" },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-testid="note"]').attributes("data-tooltip-disabled")).toBe("false")
	})
})
