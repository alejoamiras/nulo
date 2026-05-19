import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SecretUnlockSection from "./SecretUnlockSection.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span :data-name="name" />', props: ["name", "size", "color"] },
	Transition: { template: "<div><slot /></div>" },
	Input: {
		template:
			'<div data-input-stub :data-error="error" :data-aria-invalid="ariaInvalid"><input :type="type" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
		props: ["modelValue", "type", "label", "placeholder", "error", "ariaInvalid", "autofocus"],
		emits: ["update:modelValue"],
	},
}

const factory = (props: Record<string, unknown> = {}) => mount(SecretUnlockSection, { props, global: { stubs: STUBS } })

describe("composite/SecretUnlockSection", () => {
	test("renders the 'Unlock' section label", () => {
		const w = factory()
		expect(w.text()).toContain("Unlock")
	})

	test("forwards modelValue to the Input", () => {
		const w = factory({ modelValue: "secret" })
		expect(w.find("input").attributes("value")).toBe("secret")
	})

	test("'Wrong password' indicator is hidden by default", () => {
		const w = factory()
		expect(w.text()).not.toContain("Wrong password")
	})

	test("'Wrong password' indicator appears when error is true", () => {
		const w = factory({ error: true })
		expect(w.text()).toContain("Wrong password")
	})

	test("typing emits update:modelValue + clearError", async () => {
		const w = factory({ error: true })
		await w.find("input").setValue("new-pwd")
		expect(w.emitted("update:modelValue")?.[0]).toEqual(["new-pwd"])
		expect(w.emitted("clearError")).toHaveLength(1)
	})

	test("clicking the Input wrapper emits clearError", async () => {
		const w = factory({ error: true })
		await w.find("[data-input-stub]").trigger("click")
		expect(w.emitted("clearError")).toHaveLength(1)
	})

	test("preserves the canonical 'unlock-password-input' testid", () => {
		const w = mount(SecretUnlockSection, {
			props: {},
			global: {
				stubs: {
					...STUBS,
					Input: {
						template: "<div :data-testid=\"$attrs['data-testid']\"></div>",
						props: ["modelValue", "type", "label", "placeholder", "error", "ariaInvalid", "autofocus"],
						inheritAttrs: false,
					},
				},
			},
		})
		expect(w.find('[data-testid="unlock-password-input"]').exists()).toBe(true)
	})

	test("error span carries role=alert + data-testid (a11y + e2e contract)", () => {
		const w = factory({ error: true })
		const errEl = w.find('[data-testid="unlock-error-text"]')
		expect(errEl.exists()).toBe(true)
		expect(errEl.attributes("role")).toBe("alert")
		expect(errEl.text()).toContain("Wrong password")
	})
})
