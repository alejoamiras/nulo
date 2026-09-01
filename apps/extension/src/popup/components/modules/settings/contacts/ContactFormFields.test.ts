import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import ContactFormFields from "./ContactFormFields.vue"

const STUBS = {
	Input: {
		props: ["modelValue", "placeholder", "maxLength"],
		emits: ["update:modelValue"],
		template: `<div><input data-testid="name-input" :placeholder="placeholder" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></div>`,
	},
	AddressInput: {
		props: ["modelValue", "placeholder"],
		emits: ["update:modelValue"],
		template: `<div><input data-testid="address-input" :placeholder="placeholder" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></div>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

function mountFields(props: Record<string, unknown> = {}) {
	return mount(ContactFormFields, {
		props: { name: "", address: "", addressValid: false, ...props },
		global: { stubs: STUBS },
	})
}

describe("ContactFormFields", () => {
	test("name input round-trips through the name model", async () => {
		const w = mountFields()
		await w.find('[data-testid="name-input"]').setValue("Alice")
		expect(w.emitted("update:name")?.at(-1)).toEqual(["Alice"])
	})

	test("address input round-trips through the address model", async () => {
		const w = mountFields()
		await w.find('[data-testid="address-input"]').setValue("0xabc")
		expect(w.emitted("update:address")?.at(-1)).toEqual(["0xabc"])
	})

	test("e2e-load-bearing placeholders are verbatim", () => {
		const w = mountFields()
		expect(w.find('[data-testid="name-input"]').attributes("placeholder")).toBe("New contact")
		expect(w.find('[data-testid="address-input"]').attributes("placeholder")).toBe(
			"0x15c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701446",
		)
	})

	test("name duplicate warning follows nameExists", async () => {
		const w = mountFields({ nameExists: true })
		expect(w.text()).toContain("Already exist")
		await w.setProps({ nameExists: false })
		expect(w.text()).not.toContain("Already exist")
	})

	test("invalid-address warning needs a non-empty address", async () => {
		const w = mountFields({ address: "nothex", addressValid: false })
		expect(w.text()).toContain("Invalid address")
		await w.setProps({ address: "" })
		expect(w.text()).not.toContain("Invalid address")
	})

	test("address duplicate warning only when the address is valid", () => {
		const w = mountFields({ address: "0xdup", addressValid: true, addressExists: true })
		expect(w.text()).toContain("Already exist")
		expect(w.text()).not.toContain("Invalid address")
	})

	test("invalid wins over duplicate on the address field", () => {
		const w = mountFields({ address: "0xdup", addressValid: false, addressExists: true })
		expect(w.text()).toContain("Invalid address")
		expect(w.text()).not.toContain("Already exist")
	})

	test("no warnings on a clean valid state", () => {
		const w = mountFields({ address: "0xok", addressValid: true })
		expect(w.text()).not.toContain("Already exist")
		expect(w.text()).not.toContain("Invalid address")
	})
})
