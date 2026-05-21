import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import DripButton from "./DripButton.vue"

describe("DripButton", () => {
	it("shows the label prop verbatim regardless of loading state", () => {
		const idle = mount(DripButton, { props: { label: "Drip 1,000 USDC to public" } })
		const loading = mount(DripButton, {
			props: { label: "Drip 1,000 USDC to public", loading: true },
		})
		expect(idle.text()).toBe("Drip 1,000 USDC to public")
		expect(loading.text()).toBe("Drip 1,000 USDC to public")
	})

	it("emits click when clicked in the idle state", async () => {
		const w = mount(DripButton, { props: { label: "Drip" } })
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})

	it("renders a spinner and is aria-busy while loading", () => {
		const w = mount(DripButton, { props: { label: "Drip", loading: true } })
		expect(w.find(".btn__spinner").exists()).toBe(true)
		expect(w.get("button").attributes("aria-busy")).toBe("true")
	})

	it("does NOT emit click while loading", async () => {
		const w = mount(DripButton, { props: { label: "Drip", loading: true } })
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toBeUndefined()
	})

	it("does NOT emit click when explicit disabled is true", async () => {
		const w = mount(DripButton, { props: { label: "Drip", disabled: true } })
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toBeUndefined()
	})

	it("propagates data-loading on the button for e2e probes", () => {
		const w = mount(DripButton, { props: { label: "Drip", loading: true } })
		expect(w.get("button").attributes("data-loading")).toBe("true")
	})

	it("uses the outline variant of AppButton", () => {
		const w = mount(DripButton, { props: { label: "Drip" } })
		expect(w.get("button").classes()).toContain("btn--outline")
	})

	it("re-enables when loading transitions back to false", async () => {
		const w = mount(DripButton, { props: { label: "Drip", loading: true } })
		expect(w.get("button").attributes("disabled")).toBeDefined()
		await w.setProps({ loading: false })
		expect(w.get("button").attributes("disabled")).toBeUndefined()
	})

	it("button label is stable across all states (no Sent / Failed text override)", () => {
		const w = mount(DripButton, { props: { label: "Drip 1 ETH to private" } })
		expect(w.text()).toBe("Drip 1 ETH to private")
	})

	it("idle button does not show a spinner", () => {
		const w = mount(DripButton, { props: { label: "Drip" } })
		expect(w.find(".btn__spinner").exists()).toBe(false)
	})
})
