import { beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent } from "vue"
import AddressInput from "./AddressInput.vue"

const focusSpy = vi.fn()
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

// Stub the Input with a REAL inner <input> (AddressInput finds it via $el.querySelector)
// and an exposed focus() (mirrors the real Input's defineExpose).
const STUBS = {
	Input: defineComponent({
		name: "Input",
		template: `<div class="input-stub"><input @blur="$emit('blur')" @focus="$emit('focus')" /><slot name="suffix" /></div>`,
		props: ["modelValue", "placeholder", "autofocus"],
		emits: ["blur", "focus", "update:modelValue"],
		setup(_, { expose }) {
			expose({ focus: focusSpy })
		},
	}),
}

const mountInput = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(AddressInput, { props, slots, attachTo: document.body, global: { stubs: STUBS } })

beforeEach(() => focusSpy.mockClear())

describe("composite/AddressInput", () => {
	test("renders the underlying Input", () => {
		expect(mountInput().find(".input-stub").exists()).toBe(true)
	})

	test("on blur, scrolls the native input back to the start (shows the address start at rest)", async () => {
		const w = mountInput()
		const input = w.find("input").element as HTMLInputElement
		input.scrollLeft = 99
		await w.find("input").trigger("blur")
		await nextFrame()
		expect(input.scrollLeft).toBe(0)
	})

	test("focusout also scrolls back to the start (native, reliable path)", async () => {
		const w = mountInput()
		const input = w.find("input").element as HTMLInputElement
		input.scrollLeft = 77
		await w.find("input").trigger("focusout")
		await nextFrame()
		expect(input.scrollLeft).toBe(0)
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
