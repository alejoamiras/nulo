import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import Toast from "./Toast.vue"

describe("Toast", () => {
	it("renders the text", () => {
		const wrapper = mount(Toast, { props: { text: "Dripped 1,000 USDC to public" } })
		expect(wrapper.text()).toContain("Dripped 1,000 USDC to public")
	})

	it("emits dismiss when the close button is clicked", async () => {
		const wrapper = mount(Toast, { props: { text: "x" } })
		await wrapper.get(".toast__dismiss").trigger("click")
		expect(wrapper.emitted("dismiss")).toHaveLength(1)
	})

	it("renders a link when provided and opens in a new tab", () => {
		const wrapper = mount(Toast, {
			props: { text: "Dripped", link: { label: "view tx", href: "https://example.test/tx/0x1" } },
		})
		const a = wrapper.get(".toast__link")
		expect(a.text()).toBe("view tx")
		expect(a.attributes("href")).toBe("https://example.test/tx/0x1")
		expect(a.attributes("target")).toBe("_blank")
		expect(a.attributes("rel")).toContain("noopener")
	})

	it("sets data-kind to match the kind prop", () => {
		const wrapper = mount(Toast, { props: { text: "x", kind: "error" } })
		expect(wrapper.get(".toast").attributes("data-kind")).toBe("error")
		expect(wrapper.get(".toast").classes()).toContain("toast--error")
	})

	it("defaults kind to 'info' when not provided", () => {
		const wrapper = mount(Toast, { props: { text: "x" } })
		expect(wrapper.get(".toast").attributes("data-kind")).toBe("info")
	})
})
