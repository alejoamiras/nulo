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
			/><slot name='right' /><slot name='suffix' /><slot name='labelSuffix' />`,
	},
}

const baseProps = (over = {}) => ({
	method: "seed",
	error: { type: "", title: "", tooltip: "" },
	maxPasswordLength: 128,
	...over,
})

describe("ImportSecretForm", () => {
	it("renders seed input + new+confirm password fields when method=seed", () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps(), global: { stubs } })
		expect(wrapper.text()).toContain("Seed Phrase")
		expect(wrapper.text()).toContain("New Password")
		// new + confirm
		expect(wrapper.find("[data-testid=import-password-input]").exists()).toBe(true)
		expect(wrapper.find("[data-testid=import-password-confirm-input]").exists()).toBe(true)
	})

	it("renders Plain Key labels and the private key input testid for method=private_key", () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps({ method: "private_key" }), global: { stubs } })
		expect(wrapper.text()).toContain("Plain Key")
		expect(wrapper.find("[data-testid=import-private-key-input]").exists()).toBe(true)
	})

	it("renders single password (no confirm) and Password label for method=public_key", () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps({ method: "public_key" }), global: { stubs } })
		expect(wrapper.text()).toContain("Encrypted Key")
		expect(wrapper.text()).toContain("Password") // section label
		expect(wrapper.find("[data-testid=import-password-confirm-input]").exists()).toBe(false)
	})

	it("exposes per-method input testids (seed, private_key, public_key)", () => {
		const seed = mount(ImportSecretForm, { props: baseProps({ method: "seed" }), global: { stubs } })
		expect(seed.find("[data-testid=import-seed-input]").exists()).toBe(true)
		expect(seed.find("[data-testid=import-private-key-input]").exists()).toBe(false)
		expect(seed.find("[data-testid=import-public-key-input]").exists()).toBe(false)

		const priv = mount(ImportSecretForm, { props: baseProps({ method: "private_key" }), global: { stubs } })
		expect(priv.find("[data-testid=import-private-key-input]").exists()).toBe(true)
		expect(priv.find("[data-testid=import-seed-input]").exists()).toBe(false)

		const pub = mount(ImportSecretForm, { props: baseProps({ method: "public_key" }), global: { stubs } })
		expect(pub.find("[data-testid=import-public-key-input]").exists()).toBe(true)
		expect(pub.find("[data-testid=import-seed-input]").exists()).toBe(false)
	})

	it("emits secretInput when typing into the secret field", async () => {
		const wrapper = mount(ImportSecretForm, { props: baseProps({ method: "private_key" }), global: { stubs } })
		await wrapper.find("[data-testid=import-private-key-input]").trigger("input")
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

	it("forwards error.type='secret' to the private key Input via the error prop", () => {
		const wrapper = mount(ImportSecretForm, {
			props: baseProps({ method: "private_key", error: { type: "secret", title: "Bad", tooltip: "" } }),
			global: { stubs },
		})
		const input = wrapper.find("[data-testid=import-private-key-input]")
		expect(input.attributes("data-error")).toBe("true")
	})
})
