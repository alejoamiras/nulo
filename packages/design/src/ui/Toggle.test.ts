import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import Toggle from "./Toggle.vue"

const STUBS = {
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size"] },
}

const mountToggle = (props: Record<string, unknown> = {}) => mount(Toggle, { props, global: { stubs: STUBS } })

describe("ui/Toggle", () => {
	test("renders with data-testid='toggle-switch' for e2e selectors", () => {
		const w = mountToggle()
		expect(w.attributes("data-testid")).toBe("toggle-switch")
	})

	test("modelValue=false sets data-toggle-active='false'", () => {
		const w = mountToggle({ modelValue: false })
		expect(w.attributes("data-toggle-active")).toBe("false")
	})

	test("modelValue=true sets data-toggle-active='true' and adds active class", () => {
		const w = mountToggle({ modelValue: true })
		expect(w.attributes("data-toggle-active")).toBe("true")
		expect(w.attributes("class") ?? "").toMatch(/active/)
	})

	test("click toggles emits update:modelValue with the inverse boolean", async () => {
		const w = mountToggle({ modelValue: false })
		await w.trigger("click")
		expect(w.emitted("update:modelValue")?.[0]).toEqual([true])
	})

	test("click on disabled toggle does NOT emit update:modelValue", async () => {
		const w = mountToggle({ disabled: true, modelValue: false })
		await w.trigger("click")
		expect(w.emitted("update:modelValue")).toBeUndefined()
	})

	test("click on protected toggle does NOT emit update:modelValue", async () => {
		const w = mountToggle({ protected: true, modelValue: true })
		await w.trigger("click")
		expect(w.emitted("update:modelValue")).toBeUndefined()
	})

	test("disabled state shows the lock icon instead of the slider", () => {
		const w = mountToggle({ disabled: true })
		const lock = w.find('[data-name="lock"]')
		expect(lock.exists()).toBe(true)
	})
})
