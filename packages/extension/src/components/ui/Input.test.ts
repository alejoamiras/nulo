/**
 * Component tests for `Input.vue`.
 *
 * Mirrors `Button.test.ts`'s pattern: jsdom + `@vue/test-utils` + global
 * stubs for auto-registered children that `unplugin-vue-components`
 * provides in production but not in vitest.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
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

describe("ui/Input", () => {
	test("renders a native <input> with the given placeholder", () => {
		const w = mountInput({ placeholder: "Enter name" })
		const input = w.find("input")
		expect(input.exists()).toBe(true)
		expect(input.attributes("placeholder")).toBe("Enter name")
	})

	test("modelValue prop sets the initial input value", () => {
		const w = mountInput({ modelValue: "hello" })
		const input = w.find("input").element as HTMLInputElement
		expect(input.value).toBe("hello")
	})

	test("emits update:modelValue when the user types", async () => {
		const w = mountInput()
		const input = w.find("input")
		await input.setValue("typed")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]).toEqual(["typed"])
	})

	test("emits focus + blur events", async () => {
		const w = mountInput()
		const input = w.find("input")
		await input.trigger("focus")
		await input.trigger("blur")
		expect(w.emitted("focus")).toHaveLength(1)
		expect(w.emitted("blur")).toHaveLength(1)
	})

	test("renders the label when label prop is set", () => {
		const w = mountInput({ label: "Profile name" })
		expect(w.text()).toContain("Profile name")
	})

	test("error prop applies the error CSS-module class", () => {
		const w = mountInput({ error: true })
		const cls = w.html()
		expect(cls).toMatch(/error/)
	})

	test("disabled prop applies the disabled class", () => {
		const w = mountInput({ disabled: true })
		const cls = w.html()
		expect(cls).toMatch(/disabled/)
	})

	test("size prop applies the matching size class", () => {
		const w = mountInput({ size: "small" })
		const cls = w.html()
		expect(cls).toMatch(/small/)
	})

	test("type prop maps to the native input type", () => {
		const w = mountInput({ type: "password" })
		expect(w.find("input").attributes("type")).toBe("password")
	})

	test("default type is text when no type prop is given", () => {
		const w = mountInput()
		expect(w.find("input").attributes("type")).toBe("text")
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
		const w = mountInput({ clearable: true })
		const clearIcon = w.find('[data-name="close-circle"]')
		expect(clearIcon.exists()).toBe(false)
	})

	test("icon prop renders an Icon stub at the leading position", () => {
		const w = mountInput({ icon: "search" })
		const icons = w.findAll('[data-name="search"]')
		expect(icons.length).toBeGreaterThan(0)
	})

	test("leftText prop renders a prefix label inline with the input", () => {
		const w = mountInput({ leftText: "0x" })
		expect(w.text()).toContain("0x")
	})

	test("maxLength caps the value to the given length", async () => {
		const w = mountInput({ maxLength: 5 })
		const input = w.find("input")
		await input.setValue("123456789")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]).toEqual(["12345"])
	})

	test("maxLength reaching the limit emits maxLengthReached(true)", async () => {
		const w = mountInput({ maxLength: 3 })
		const input = w.find("input")
		await input.setValue("abc")
		const emits = w.emitted("maxLengthReached")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]).toEqual([true])
	})
})
