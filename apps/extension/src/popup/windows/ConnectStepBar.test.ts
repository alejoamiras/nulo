import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import ConnectStepBar from "./ConnectStepBar.vue"

describe("windows/ConnectStepBar", () => {
	test("step 1 fills one of two segments, step 2 both, and the bar is hidden from assistive tech", async () => {
		const w = mount(ConnectStepBar, { props: { step: 1 } })
		const filled = () => w.findAll('[data-filled="true"]').length
		expect(w.attributes("aria-hidden")).toBe("true")
		expect(w.findAll("[data-filled]")).toHaveLength(2)
		expect(filled()).toBe(1)
		await w.setProps({ step: 2 })
		expect(filled()).toBe(2)
	})
})
