import { Input } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OnboardingProfileNameField from "./OnboardingProfileNameField.vue"

const stubs = {
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
}

const mountField = (props = {}) =>
	mount(OnboardingProfileNameField, { props, attachTo: document.body, global: { stubs, components: { Input } } })

describe("OnboardingProfileNameField", () => {
	test("the e2e testid sits on the field root and the native input keeps its placeholder and type", () => {
		const w = mountField()
		expect(w.find("[data-testid='onboarding-name-input']").exists()).toBe(true)
		const input = w.find("[data-testid='onboarding-name-input'] input")
		expect(input.attributes("placeholder")).toBe("My Profile")
		expect(input.attributes("type")).toBe("text")
	})

	test("typing updates the model", async () => {
		const w = mountField({ modelValue: "" })
		await w.find("input").setValue("Alice")
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["Alice"])
	})

	test("the value is sanitized and capped at 32 characters", async () => {
		const w = mountField({ modelValue: "" })
		await w.find("input").setValue("a".repeat(40))
		const [value] = w.emitted("update:modelValue")?.at(-1) ?? []
		expect(value).toHaveLength(32)
	})

	test("native input events reach the page's handler", async () => {
		const w = mountField()
		await w.find("input").trigger("input")
		expect(w.emitted("input")?.length).toBeGreaterThan(0)
	})

	test("the alert line and aria-invalid appear only with an error", async () => {
		const w = mountField()
		expect(w.find("[role='alert']").exists()).toBe(false)
		await w.setProps({ error: "Name already in use" })
		expect(w.find("[role='alert']").text()).toBe("Name already in use")
		expect(w.find("input").attributes("aria-invalid")).toBe("true")
	})

	test("shake toggles the wrapper's shake class", async () => {
		const w = mountField()
		const shakeWrapper = () => w.find("[data-testid='onboarding-name-input']").element.parentElement
		expect(shakeWrapper()?.className ?? "").not.toMatch(/shake/)
		await w.setProps({ shake: true })
		expect(shakeWrapper()?.className).toMatch(/shake/)
	})

	test("focus() lands on the native input", () => {
		const w = mountField()
		;(w.vm as unknown as { focus: () => void }).focus()
		expect(document.activeElement).toBe(w.find("input").element)
		w.unmount()
	})
})
