import { Input } from "@nulo/design"
import { mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, describe, expect, test } from "vitest"
import { defineComponent, ref } from "vue"
import { expectNativeAttrs, nativeInput, pasteInto, typeNow } from "../../../tests/helpers/credential-pins"
import ProfileNameField from "./ProfileNameField.vue"

const stubs = { Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` } }
const ID = "name-under-test"
const mounted: VueWrapper[] = []
afterEach(() => {
	for (const w of mounted.splice(0)) w.unmount()
})

function mountField(props: Record<string, unknown> = {}) {
	const w = mount(ProfileNameField, {
		props: { testid: ID, ...props },
		attachTo: document.body,
		global: { stubs, components: { Input } },
	})
	mounted.push(w)
	return w
}

/** Inside a parent element, as every shell renders it, so the two roots can be read as siblings. */
function mountInParent(onInput: (name: string) => void = () => {}) {
	const Parent = defineComponent({
		components: { ProfileNameField },
		setup() {
			const name = ref("")
			const error = ref("")
			return { name, error, onInput: () => onInput(name.value) }
		},
		template: `<section><span>label</span><ProfileNameField v-model="name" :error="error" testid="${ID}" @input="onInput" /></section>`,
	})
	const w = mount(Parent, { attachTo: document.body, global: { stubs, components: { Input } } })
	mounted.push(w)
	return w
}

describe("composite/ProfileNameField", () => {
	test.each([
		["placeholder", "My Profile"],
		["type", "text"],
	])("the native input's %s is %s", (name, value) => {
		expect(nativeInput(mountField(), ID).getAttribute(name)).toBe(value)
	})

	test("no autofill hints, no native maxlength or autofocus", () => {
		expectNativeAttrs(mountField(), ID, { autocomplete: null, autocapitalize: null, autocorrect: null })
	})

	test("typing emits the sanitized value", () => {
		const w = mountField()
		typeNow(nativeInput(w, ID), "Bob<>!")
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["Bob"])
	})

	test("a real paste is sanitized and capped at 32", () => {
		const w = mountField()
		expect(pasteInto(nativeInput(w, ID), `Ali<ce>!${"x".repeat(40)}`)).toBe(true)
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual([`Alice${"x".repeat(24)}`])
	})

	test("the parent's model holds the typed value when its input handler runs", () => {
		const seen: string[] = []
		const w = mountInParent((name) => seen.push(name))
		typeNow(nativeInput(w, ID), "Carol")
		expect(seen).toEqual(["Carol"])
	})

	test("the shake wrapper and the alert are the parent's last two children", async () => {
		const w = mountInParent()
		;(w.vm as unknown as { error: string }).error = "Profile name is required."
		await w.vm.$nextTick()
		const children = [...w.element.children]
		expect(children.map((c) => c.tagName)).toEqual(["SPAN", "DIV", "SPAN"])
		expect(children[1]?.firstElementChild?.getAttribute("data-testid")).toBe(ID)
		expect(children[2]?.getAttribute("role")).toBe("alert")
		expect(children[2]?.textContent?.trim()).toBe("Profile name is required.")
	})

	test.each([
		["", "false", false],
		["Taken", "true", true],
	])("error %j: aria-invalid %s, alert shown %s", (error, invalid, alert) => {
		const w = mountField({ error })
		expect(nativeInput(w, ID).getAttribute("aria-invalid")).toBe(invalid)
		expect(w.find('[role="alert"]').exists()).toBe(alert)
	})

	test("shake sets the wrapper's shake class", async () => {
		const w = mountField()
		const wrapper = () => nativeInput(w, ID).closest(`[data-testid="${ID}"]`)?.parentElement as HTMLElement
		expect(wrapper().className).not.toMatch(/shake/)
		await w.setProps({ shake: true })
		expect(wrapper().className).toMatch(/shake/)
	})

	test("focus() lands on the native input", () => {
		const w = mountField()
		;(w.vm as unknown as { focus: () => void }).focus()
		expect(document.activeElement).toBe(nativeInput(w, ID))
	})
})
