import { beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent } from "vue"
import AddressInput from "./AddressInput.vue"

// Mutable spies the Input stub exposes (mirroring the real Input's
// `defineExpose({ inputEl, focus })`), reset before each test.
let inputElSpy: { scrollLeft: number } | null
let focusSpy: ReturnType<typeof vi.fn>

const STUBS = {
	Input: defineComponent({
		name: "Input",
		template: `<div class="input-stub"><input @blur="$emit('blur')" @focus="$emit('focus')" /><slot name="suffix" /></div>`,
		props: ["modelValue", "placeholder", "autofocus"],
		emits: ["blur", "focus", "update:modelValue"],
		setup(_, { expose }) {
			expose({ inputEl: inputElSpy, focus: focusSpy })
		},
	}),
}

const mountInput = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(AddressInput, { props, slots, global: { stubs: STUBS } })

beforeEach(() => {
	inputElSpy = { scrollLeft: 99 }
	focusSpy = vi.fn()
})

describe("composite/AddressInput", () => {
	test("renders the underlying Input", () => {
		expect(mountInput().find(".input-stub").exists()).toBe(true)
	})

	test("on blur, resets the input's scrollLeft to 0 (shows the address start at rest)", async () => {
		const w = mountInput()
		await w.find("input").trigger("blur")
		expect(inputElSpy?.scrollLeft).toBe(0)
	})

	test("on blur, still emits 'blur' to the parent", async () => {
		const w = mountInput()
		await w.find("input").trigger("blur")
		expect(w.emitted("blur")).toBeTruthy()
	})

	test("on focus, emits 'focus' to the parent", async () => {
		const w = mountInput()
		await w.find("input").trigger("focus")
		expect(w.emitted("focus")).toBeTruthy()
	})

	test("forwards v-model (modelValue) through to the Input", () => {
		const w = mountInput({ modelValue: "0xabc", placeholder: "0x..." })
		expect(w.findComponent({ name: "Input" }).props("modelValue")).toBe("0xabc")
	})

	test("forwards arbitrary attrs (placeholder, autofocus) through to the Input", () => {
		const inner = mountInput({ placeholder: "0x address", autofocus: true }).findComponent({ name: "Input" })
		expect(inner.props("placeholder")).toBe("0x address")
		expect(inner.props("autofocus")).toBe(true)
	})

	test("forwards the #suffix slot to the Input", () => {
		const w = mountInput({}, { suffix: '<i data-testid="my-suffix" />' })
		expect(w.find('[data-testid="my-suffix"]').exists()).toBe(true)
	})

	test("blur with no inputEl does not crash and still emits 'blur'", async () => {
		inputElSpy = null
		const w = mountInput()
		await w.find("input").trigger("blur")
		expect(w.emitted("blur")).toBeTruthy()
	})

	test("exposes focus() that calls the inner Input's focus", () => {
		const w = mountInput()
		;(w.vm as unknown as { focus: () => void }).focus()
		expect(focusSpy).toHaveBeenCalled()
	})

	test("blur never emits update:modelValue (value identity preserved)", async () => {
		const w = mountInput({ modelValue: "0xdeadbeef" })
		await w.find("input").trigger("blur")
		expect(w.emitted("update:modelValue")).toBeFalsy()
	})
})
