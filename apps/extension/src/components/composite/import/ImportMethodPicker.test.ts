import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import ImportMethodPicker from "./ImportMethodPicker.vue"

const stubs = {
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: {
		props: ["title"],
		template: "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\">{{ title }}</button>",
		emits: ["click"],
	},
}

describe("ImportMethodPicker", () => {
	it("renders all three method entries with import label by default", () => {
		const wrapper = mount(ImportMethodPicker, { global: { stubs } })
		const items = wrapper.findAll("button")
		expect(items).toHaveLength(3)
		expect(wrapper.text()).toContain("Import with")
	})

	it("uses Recovery label when type='recovery'", () => {
		const wrapper = mount(ImportMethodPicker, { props: { type: "recovery" }, global: { stubs } })
		expect(wrapper.text()).toContain("Recovery with")
	})

	it("emits select with full_backup", async () => {
		const wrapper = mount(ImportMethodPicker, { global: { stubs } })
		await wrapper.find("[data-testid=import-option-full-backup]").trigger("click")
		expect(wrapper.emitted("select")).toEqual([["full_backup"]])
	})

	it("emits select with seed", async () => {
		const wrapper = mount(ImportMethodPicker, { global: { stubs } })
		await wrapper.find("[data-testid=import-option-seed]").trigger("click")
		expect(wrapper.emitted("select")).toEqual([["seed"]])
	})

	it("offers NO plain-key or encrypted-key entries (recovery phrase is the only secret import)", () => {
		const wrapper = mount(ImportMethodPicker, { global: { stubs } })
		expect(wrapper.find("[data-testid=import-option-private-key]").exists()).toBe(false)
		expect(wrapper.find("[data-testid=import-option-public-key]").exists()).toBe(false)
	})

	it("emits passkey (not select) for the passkey row", async () => {
		const wrapper = mount(ImportMethodPicker, { global: { stubs } })
		await wrapper.find("[data-testid=import-option-passkey]").trigger("click")
		expect(wrapper.emitted("passkey")).toBeTruthy()
		expect(wrapper.emitted("select")).toBeFalsy()
	})
})
