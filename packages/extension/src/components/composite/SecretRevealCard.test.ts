import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SecretRevealCard from "./SecretRevealCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
	Input: {
		template: '<div :data-testid="$attrs[\'data-testid\']"><label>{{ label }}</label><input :type="type" :value="modelValue" /></div>',
		props: ["modelValue", "type", "label", "placeholder", "size"],
		inheritAttrs: false,
	},
}

const mountCard = (props: Record<string, unknown> = { value: "secret-text", label: "Test Label" }) =>
	mount(SecretRevealCard, { props, global: { stubs: STUBS } })

describe("composite/SecretRevealCard", () => {
	test("renders the label inside the Input", () => {
		const w = mountCard({ value: "x", label: "Plain Key" })
		expect(w.text()).toContain("Plain Key")
	})

	test("renders Show + Copy chip buttons", () => {
		const w = mountCard()
		const buttons = w.findAll("button")
		expect(buttons.length).toBe(2)
		expect(buttons[0].text()).toContain("Show")
		expect(buttons[1].text()).toContain("Copy")
	})

	test("input type defaults to 'password' (hidden)", () => {
		const w = mountCard()
		expect(w.find("input").attributes("type")).toBe("password")
	})

	test("clicking Show toggles input type to 'text' and label flips to 'Hide'", async () => {
		const w = mountCard()
		const showBtn = w.findAll("button")[0]
		await showBtn.trigger("click")
		expect(w.find("input").attributes("type")).toBe("text")
		expect(showBtn.text()).toContain("Hide")
	})

	test("clicking Show again toggles back to 'password'", async () => {
		const w = mountCard()
		const showBtn = w.findAll("button")[0]
		await showBtn.trigger("click")
		await showBtn.trigger("click")
		expect(w.find("input").attributes("type")).toBe("password")
	})

	test("clicking Copy emits 'copy' event (parent owns clipboard write)", async () => {
		const w = mountCard()
		const copyBtn = w.findAll("button")[1]
		await copyBtn.trigger("click")
		expect(w.emitted("copy")).toHaveLength(1)
	})

	test("isCopied prop flips Copy chip to 'Copied' with check icon", () => {
		const w = mountCard({ value: "x", label: "Y", isCopied: true })
		const copyBtn = w.findAll("button")[1]
		expect(copyBtn.text()).toContain("Copied")
		expect(copyBtn.find('[data-name="check"]').exists()).toBe(true)
	})

	test("value prop is forwarded to the Input as modelValue (readonly display)", () => {
		const w = mountCard({ value: "abc123secret", label: "X" })
		expect(w.find("input").attributes("value")).toBe("abc123secret")
	})

	test("testId prop is forwarded to the wrapper as data-testid", () => {
		const w = mountCard({ value: "x", label: "Y", testId: "reveal-content" })
		expect(w.find("[data-testid='reveal-content']").exists()).toBe(true)
	})

	test("Show/Hide toggles independently of Copy clicks", async () => {
		const w = mountCard()
		const [showBtn, copyBtn] = w.findAll("button")
		await showBtn.trigger("click")
		expect(w.find("input").attributes("type")).toBe("text")
		await copyBtn.trigger("click")
		// Visibility should remain unchanged after copy click
		expect(w.find("input").attributes("type")).toBe("text")
	})
})
