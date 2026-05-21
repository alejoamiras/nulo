import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import DripButton from "./DripButton.vue"

describe("DripButton", () => {
	it("idle: shows the label prop and is clickable", async () => {
		const w = mount(DripButton, { props: { label: "Drip 1,000 USDC to public" } })
		expect(w.text()).toBe("Drip 1,000 USDC to public")
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})

	it("dripping: shows 'Sending tx…' and is disabled (aria-busy)", async () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "dripping" } })
		expect(w.text()).toContain("Sending tx…")
		expect(w.get("button").attributes("aria-busy")).toBe("true")
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toBeUndefined()
	})

	it("ok: shows 'Sent' transient label", () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "ok" } })
		expect(w.text()).toBe("Sent")
	})

	it("error: shows 'Failed — retry' label and is still clickable", async () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "error" } })
		expect(w.text()).toBe("Failed — retry")
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})

	it("propagates data-drip-state on the button for e2e probes", () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "dripping" } })
		expect(w.get("button").attributes("data-drip-state")).toBe("dripping")
	})

	it("renders the explicit disabled prop independently of state", async () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "idle", disabled: true } })
		expect(w.get("button").attributes("disabled")).toBeDefined()
		await w.get("button").trigger("click")
		expect(w.emitted("click")).toBeUndefined()
	})

	it("does NOT show a spinner when state is 'ok' (transient success)", () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "ok" } })
		expect(w.find(".btn__spinner").exists()).toBe(false)
	})

	it("does NOT show a spinner when state is 'error'", () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "error" } })
		expect(w.find(".btn__spinner").exists()).toBe(false)
	})

	it("uses the outline variant of AppButton", () => {
		const w = mount(DripButton, { props: { label: "Drip" } })
		expect(w.get("button").classes()).toContain("btn--outline")
	})

	it("re-enables when state transitions back to idle after dripping", async () => {
		const w = mount(DripButton, { props: { label: "Drip", state: "dripping" } })
		expect(w.get("button").attributes("disabled")).toBeDefined()
		await w.setProps({ state: "idle" })
		expect(w.get("button").attributes("disabled")).toBeUndefined()
	})
})
