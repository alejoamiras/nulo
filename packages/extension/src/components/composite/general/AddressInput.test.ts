import { beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent } from "vue"
import AddressInput from "./AddressInput.vue"

const focusSpy = vi.fn()

// Stub the Input with a REAL inner <input> (AddressInput attaches native listeners
// to it via $el.querySelector) and an exposed focus() (mirrors the real Input).
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

	test("blurred: scrolling the input snaps it back to the start (can't be dragged at rest)", async () => {
		const w = mountInput()
		const input = w.find("input")
		const el = input.element as HTMLInputElement
		el.scrollLeft = 99
		await input.trigger("scroll")
		expect(el.scrollLeft).toBe(0)
	})

	test("focused: scrolling is allowed (not reset) while editing", async () => {
		const w = mountInput()
		const input = w.find("input")
		const el = input.element as HTMLInputElement
		await input.trigger("focus")
		el.scrollLeft = 99
		await input.trigger("scroll")
		expect(el.scrollLeft).toBe(99)
	})

	test("on blur, the input is pinned back to the start", async () => {
		const w = mountInput()
		const input = w.find("input")
		const el = input.element as HTMLInputElement
		await input.trigger("focus")
		el.scrollLeft = 50
		await input.trigger("blur")
		expect(el.scrollLeft).toBe(0)
	})

	test("forwards 'blur' to the parent", async () => {
		const w = mountInput()
		await w.find("input").trigger("blur")
		expect(w.emitted("blur")).toBeTruthy()
	})

	test("forwards 'focus' to the parent", async () => {
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
