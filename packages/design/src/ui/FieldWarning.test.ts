import { mount } from "@vue/test-utils"
import { defineComponent, nextTick } from "vue"
import { describe, expect, test } from "vitest"
import FieldWarning from "./FieldWarning.vue"

const STUBS = {
	Flex: {
		props: ["align", "gap"],
		inheritAttrs: false,
		template: `<div data-testid="row" :data-align="align" :data-gap="gap" v-bind="$attrs"><slot /></div>`,
	},
	Icon: {
		props: ["name", "size", "color"],
		template: `<i data-testid="icon" :data-name="name" :data-size="size" :data-color="color" />`,
	},
	Text: {
		props: ["size", "weight", "color"],
		template: `<span data-testid="copy" :data-size="size" :data-weight="weight" :data-color="color"><slot /></span>`,
	},
}

const frame = () => new Promise((r) => setTimeout(r, 60))

describe("ui/FieldWarning", () => {
	test("is the warning row: a centred 6-gap flex with the red 12px warning glyph and 12/600 primary copy", () => {
		const w = mount(FieldWarning, { slots: { default: "Already exist" }, global: { stubs: STUBS } })
		const row = w.find("[data-testid='row']")
		expect(row.attributes("data-align")).toBe("center")
		expect(row.attributes("data-gap")).toBe("6")
		const icon = w.find("[data-testid='icon']")
		expect(icon.attributes()).toMatchObject({ "data-name": "warning", "data-size": "12", "data-color": "red" })
		const copy = w.find("[data-testid='copy']")
		expect(copy.attributes()).toMatchObject({ "data-size": "12", "data-weight": "600", "data-color": "primary" })
		expect(copy.text()).toBe("Already exist")
	})

	test("interpolated copy renders through the slot", () => {
		const Host = defineComponent({
			components: { FieldWarning },
			props: { errorText: String },
			template: `<FieldWarning v-if="errorText">{{ errorText }}</FieldWarning>`,
		})
		const w = mount(Host, { props: { errorText: "RPC didn't respond. Check the URL." }, global: { stubs: STUBS } })
		expect(w.find("[data-testid='copy']").text()).toBe("RPC didn't respond. Check the URL.")
	})

	test("leaks no attributes of its own onto the row", () => {
		const w = mount(FieldWarning, { slots: { default: "x" }, global: { stubs: STUBS } })
		expect(Object.keys(w.find("[data-testid='row']").attributes()).sort()).toEqual(["data-align", "data-gap", "data-testid"])
	})

	test("toggles hidden → shown → hidden through a real fade Transition on the page's v-if", async () => {
		const Host = defineComponent({
			components: { FieldWarning },
			props: { show: Boolean },
			template: `<div><Transition name="fade"><FieldWarning v-if="show">Already exist</FieldWarning></Transition></div>`,
		})
		const w = mount(Host, { props: { show: false }, global: { stubs: { ...STUBS, transition: false } } })
		expect(w.find("[data-testid='row']").exists()).toBe(false)
		await w.setProps({ show: true })
		await nextTick()
		expect(w.find("[data-testid='row']").exists()).toBe(true)
		await w.setProps({ show: false })
		await frame()
		expect(w.find("[data-testid='row']").exists()).toBe(false)
	})

	test("a v-if / v-else-if pair inside one Transition swaps warning A for warning B", async () => {
		const Host = defineComponent({
			components: { FieldWarning },
			props: { a: Boolean, b: Boolean },
			template: `<div><Transition name="fade"><FieldWarning v-if="a">Name in use</FieldWarning><FieldWarning v-else-if="b">Already exist</FieldWarning></Transition></div>`,
		})
		const w = mount(Host, { props: { a: true, b: false }, global: { stubs: { ...STUBS, transition: false } } })
		expect(w.find("[data-testid='copy']").text()).toBe("Name in use")
		await w.setProps({ a: false, b: true })
		await frame()
		const copies = w.findAll("[data-testid='copy']").map((c) => c.text())
		expect(copies).toEqual(["Already exist"])
	})
})
