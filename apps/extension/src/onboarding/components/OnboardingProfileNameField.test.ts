import { Input } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, test } from "vitest"
import OnboardingProfileNameField from "./OnboardingProfileNameField.vue"

const stubs = {
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
}

const mounted: Array<ReturnType<typeof mount>> = []
const mountField = (props = {}) => {
	const w = mount(OnboardingProfileNameField, { props, attachTo: document.body, global: { stubs, components: { Input } } })
	mounted.push(w)
	return w
}
afterEach(() => {
	for (const w of mounted.splice(0)) w.unmount()
})

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

	test("the value is sanitized to the allowed set and capped at 32 characters", async () => {
		const w = mountField({ modelValue: "" })
		await w.find("input").setValue(`Ali<ce>!${"x".repeat(40)}`)
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual([`Alice${"x".repeat(27)}`])
	})

	test("one native input event reaches the page's handler once, as the event itself", async () => {
		const w = mountField()
		await w.find("input").trigger("input")
		const forwarded = w.emitted("input")
		expect(forwarded).toHaveLength(1)
		expect(forwarded?.[0]?.[0]).toBeInstanceOf(Event)
	})

	test("the alert line and aria-invalid follow the error, and clear with it", async () => {
		const w = mountField()
		expect(w.find("[role='alert']").exists()).toBe(false)
		expect(w.find("input").attributes("aria-invalid")).toBe("false")
		await w.setProps({ error: "Name already in use" })
		expect(w.find("[role='alert']").text()).toBe("Name already in use")
		expect(w.find("input").attributes("aria-invalid")).toBe("true")
		await w.setProps({ error: "" })
		expect(w.find("[role='alert']").exists()).toBe(false)
		expect(w.find("input").attributes("aria-invalid")).toBe("false")
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
	})
})
