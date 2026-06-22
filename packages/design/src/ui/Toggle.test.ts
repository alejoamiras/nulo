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

	// (round-3 P4 reconciliation pin) the package Toggle adds a `color` prop the deleted extension-local
	// shadow lacked: it paints the ON-state background. Pin it so the round-1 shadow cleanup is a
	// knowing behavior adoption, not a silent one.
	test("color prop paints the ON-state background; OFF leaves it unset", () => {
		const color = "rgb(1, 2, 3)"
		expect(mountToggle({ modelValue: true, color }).html()).toContain("background: rgb(1, 2, 3)")
		expect(mountToggle({ modelValue: false, color }).html()).not.toContain("rgb(1, 2, 3)")
	})

	// (frontend-ux-fixes P5a) the toggle is a <div> — it needs an explicit tabindex to be focusable, and
	// keyboard activation to be operable. Was `tabindex="1"` (a positive value corrupts whole-document tab
	// order) with @click only; now `tabindex="0"` (or -1 when locked) + Enter/Space.
	test("is keyboard-focusable (tabindex=0) when enabled, out of tab order (-1) when locked", () => {
		expect(mountToggle().attributes("tabindex")).toBe("0")
		expect(mountToggle({ disabled: true }).attributes("tabindex")).toBe("-1")
		expect(mountToggle({ protected: true }).attributes("tabindex")).toBe("-1")
	})

	test("Enter activates the toggle (keyboard parity with click)", async () => {
		const w = mountToggle({ modelValue: false })
		await w.trigger("keydown", { key: "Enter" })
		expect(w.emitted("update:modelValue")?.[0]).toEqual([true])
	})

	test("Space activates the toggle", async () => {
		const w = mountToggle({ modelValue: false })
		await w.trigger("keydown", { key: " " })
		expect(w.emitted("update:modelValue")?.[0]).toEqual([true])
	})

	test("disabled toggle ignores keyboard activation", async () => {
		const w = mountToggle({ disabled: true, modelValue: false })
		await w.trigger("keydown", { key: "Enter" })
		expect(w.emitted("update:modelValue")).toBeUndefined()
	})

	test("exposes role=switch + aria-checked for assistive tech", () => {
		expect(mountToggle({ modelValue: true }).attributes("role")).toBe("switch")
		expect(mountToggle({ modelValue: true }).attributes("aria-checked")).toBe("true")
		expect(mountToggle({ modelValue: false }).attributes("aria-checked")).toBe("false")
	})
})
