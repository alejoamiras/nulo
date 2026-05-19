import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import LoadingState from "./LoadingState.vue"

const STUBS = {
	Spinner: { template: '<span data-testid="stub-spinner" />' },
}

const mountLoadingState = (props: Record<string, unknown> = { label: "Loading…" }) =>
	mount(LoadingState, { props, global: { stubs: STUBS } })

describe("ui/LoadingState", () => {
	test("renders the label prop", () => {
		const w = mountLoadingState({ label: "Fetching balances" })
		expect(w.text()).toContain("Fetching balances")
	})

	test("renders a Spinner stub", () => {
		const w = mountLoadingState()
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})

	test("renders the sub prop when provided", () => {
		const w = mountLoadingState({ label: "Loading", sub: "Decrypting your secrets" })
		expect(w.text()).toContain("Decrypting your secrets")
	})

	test("does NOT render the sub element when sub is empty", () => {
		const w = mountLoadingState({ label: "Loading", sub: "" })
		const html = w.html()
		expect(html).not.toMatch(/class="[^"]*sub[^"]*"/)
	})

	test("data-testid='loading-state' attribute is on the wrapper for e2e selectors", () => {
		const w = mountLoadingState()
		expect(w.attributes("data-testid")).toBe("loading-state")
	})
})
