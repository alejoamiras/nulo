import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Input from "./Input.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: '<span><slot /><slot name="content" /></span>' },
}

const mountInput = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Input, {
		props: { placeholder: "Type something", ...props },
		slots,
		global: { stubs: STUBS },
	})

describe("Input", () => {
	test("renders a native <input> with the given placeholder", () => {
		const input = mountInput({ placeholder: "Enter name" }).find("input")
		expect(input.exists()).toBe(true)
		expect(input.attributes("placeholder")).toBe("Enter name")
	})

	test("modelValue prop sets the initial input value", () => {
		const input = mountInput({ modelValue: "hello" }).find("input").element as HTMLInputElement
		expect(input.value).toBe("hello")
	})

	test("emits update:modelValue when the user types", async () => {
		const w = mountInput()
		await w.find("input").setValue("typed")
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual(["typed"])
	})

	test("emits focus + blur events", async () => {
		const w = mountInput()
		await w.find("input").trigger("focus")
		await w.find("input").trigger("blur")
		expect(w.emitted("focus")).toHaveLength(1)
		expect(w.emitted("blur")).toHaveLength(1)
	})

	test("renders the label when label prop is set", () => {
		expect(mountInput({ label: "Profile name" }).text()).toContain("Profile name")
	})

	test("error prop applies the error CSS-module class", () => {
		expect(mountInput({ error: true }).html()).toMatch(/error/)
	})

	test("disabled prop applies the disabled class", () => {
		expect(mountInput({ disabled: true }).html()).toMatch(/disabled/)
	})

	test("size prop applies the matching size class", () => {
		expect(mountInput({ size: "small" }).html()).toMatch(/small/)
	})

	test("type prop maps to the native input type", () => {
		expect(mountInput({ type: "password" }).find("input").attributes("type")).toBe("password")
	})

	test("default type is text when no type prop is given", () => {
		expect(mountInput().find("input").attributes("type")).toBe("text")
	})

	test("clearable + non-empty value shows a clear icon that emits clear+blur on click", async () => {
		const w = mountInput({ clearable: true, modelValue: "something" })
		const clearIcon = w.find('[data-name="close-circle"]')
		expect(clearIcon.exists()).toBe(true)
		await clearIcon.trigger("click")
		expect(w.emitted("clear")).toHaveLength(1)
		expect(w.emitted("blur")).toHaveLength(1)
	})

	test("clearable + empty value does NOT show the clear icon", () => {
		expect(mountInput({ clearable: true }).find('[data-name="close-circle"]').exists()).toBe(false)
	})

	test("icon prop renders an Icon stub at the leading position", () => {
		expect(mountInput({ icon: "search" }).findAll('[data-name="search"]').length).toBeGreaterThan(0)
	})

	test("leftText prop renders a prefix label inline with the input", () => {
		expect(mountInput({ leftText: "0x" }).text()).toContain("0x")
	})

	test("maxLength caps the value to the given length", async () => {
		const w = mountInput({ maxLength: 5 })
		await w.find("input").setValue("123456789")
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual(["12345"])
	})

	test("maxLength reaching the limit emits maxLengthReached(true)", async () => {
		const w = mountInput({ maxLength: 3 })
		await w.find("input").setValue("abc")
		const emits = w.emitted("maxLengthReached")
		expect(emits?.[emits.length - 1]).toEqual([true])
	})

	test("(BUG PIN) subtype='int' emits parseInt of the RAW text (stops at first non-digit), not the cleaned digits", async () => {
		// Quirk preserved verbatim: handleInput cleans `value` (→ "123") but emits
		// `parseInt(text.value, 10)` where text.value is the raw "12a3" → 12 (parseInt stops at "a").
		const w = mountInput({ subtype: "int" })
		await w.find("input").setValue("12a3")
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual([12])
	})

	test("(oddity) exposes inputEl + focus via defineExpose", () => {
		const vm = mountInput().vm as { focus?: unknown; inputEl?: unknown }
		expect(vm.focus).toBeTypeOf("function")
		expect("inputEl" in vm).toBe(true)
	})
})
