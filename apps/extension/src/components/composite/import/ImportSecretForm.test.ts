import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import ImportSecretForm from "./ImportSecretForm.vue"

const stubs = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i></i>" },
	MaterialIcon: { template: "<i></i>" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Transition: { template: "<div><slot /></div>" },
	Input: {
		props: ["modelValue", "label", "placeholder", "type", "error", "maxLength"],
		emits: ["update:modelValue", "input"],
		template: `<input
				:data-testid="$attrs['data-testid']"
				:value="modelValue"
				:type="type"
				:data-error="error"
				@input="$emit('update:modelValue', $event.target.value); $emit('input', $event)"
			/><slot name='right' /><slot name='suffix' /><slot name='labelSuffix' /><slot name='bottom' />`,
	},
}

const baseProps = (over = {}) => ({
	method: "seed",
	error: { type: "", title: "", tooltip: "" },
	maxPasswordLength: 128,
	...over,
})

describe("ImportSecretForm", () => {
	it("renders phrase input + new+confirm password fields when method=seed", () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps(), global: { stubs } })
		expect(wrapper.text()).toContain("Recovery Phrase")
		expect(wrapper.text()).toContain("New Password")
		// new + confirm
		expect(wrapper.find("[data-testid=import-password-input]").exists()).toBe(true)
		expect(wrapper.find("[data-testid=import-password-confirm-input]").exists()).toBe(true)
	})

	it("exposes ONLY the seed input testid (plain/encrypted key inputs are gone)", () => {
		const seed = mount(ImportSecretForm, { props: baseProps({ method: "seed" }), global: { stubs } })
		expect(seed.find("[data-testid=import-seed-input]").exists()).toBe(true)
		expect(seed.find("[data-testid=import-private-key-input]").exists()).toBe(false)
		expect(seed.find("[data-testid=import-public-key-input]").exists()).toBe(false)
	})

	it("emits secretInput when typing into the phrase field", async () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps({ method: "seed" }), global: { stubs } })
		await wrapper.find("[data-testid=import-seed-input]").trigger("input")
		expect(wrapper.emitted("secretInput")).toBeTruthy()
	})

	it("emits passwordInput when typing into the password field", async () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps(), global: { stubs } })
		await wrapper.find("[data-testid=import-password-input]").trigger("input")
		expect(wrapper.emitted("passwordInput")).toBeTruthy()
	})

	it("shows the unknown-error banner when error.type === 'unknown'", () => {
		const wrapper = mount(ImportSecretForm, {
			props: baseProps({ error: { type: "unknown", title: "Boom", tooltip: "" } }),
			global: { stubs },
		})
		expect(wrapper.text()).toContain("Error")
		expect(wrapper.text()).toContain("Boom")
	})

	it("shows the 'Correct' indicator only at exactly 24 words", () => {
		const short = mount(ImportSecretForm, { props: baseProps({ method: "seed" }), global: { stubs } })
		expect(short.text()).not.toContain("Correct")
		const full = mount(ImportSecretForm, {
			props: { ...baseProps({ method: "seed" }), seedPhrase: Array(24).fill("word").join(" ") },
			global: { stubs },
		})
		expect(full.text()).toContain("Correct")
	})
})
