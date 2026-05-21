import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import AppButton from "./AppButton.vue"

describe("AppButton", () => {
	it("renders the slot content as the label", () => {
		const wrapper = mount(AppButton, { slots: { default: "Connect wallet" } })
		expect(wrapper.text()).toContain("Connect wallet")
	})

	it("emits click when clicked", async () => {
		const wrapper = mount(AppButton, { slots: { default: "Drip" } })
		await wrapper.get("button").trigger("click")
		expect(wrapper.emitted("click")).toHaveLength(1)
	})

	it("does not emit click when disabled", async () => {
		const wrapper = mount(AppButton, { props: { disabled: true }, slots: { default: "Drip" } })
		await wrapper.get("button").trigger("click")
		expect(wrapper.emitted("click")).toBeUndefined()
		expect(wrapper.get("button").attributes("disabled")).toBeDefined()
	})

	it("does not emit click when loading and renders a spinner", async () => {
		const wrapper = mount(AppButton, { props: { loading: true }, slots: { default: "Sending" } })
		await wrapper.get("button").trigger("click")
		expect(wrapper.emitted("click")).toBeUndefined()
		expect(wrapper.find(".btn__spinner").exists()).toBe(true)
		expect(wrapper.get("button").attributes("aria-busy")).toBe("true")
	})

	it("applies the variant class for outline + ghost", () => {
		const outline = mount(AppButton, { props: { variant: "outline" }, slots: { default: "X" } })
		const ghost = mount(AppButton, { props: { variant: "ghost" }, slots: { default: "X" } })
		expect(outline.get("button").classes()).toContain("btn--outline")
		expect(ghost.get("button").classes()).toContain("btn--ghost")
	})
})
