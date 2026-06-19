import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import LoadingState from "./LoadingState.vue"

// Spinner is explicitly imported by LoadingState.vue (no auto-import in the package), so the real
// Spinner renders — its role="status" is the probe.
const mountLoadingState = (props: { label: string; sub?: string } = { label: "Loading…" }) => mount(LoadingState, { props })

describe("LoadingState", () => {
	test("renders the label prop", () => {
		expect(mountLoadingState({ label: "Fetching balances" }).text()).toContain("Fetching balances")
	})

	test("renders a Spinner (role=status)", () => {
		expect(mountLoadingState().find('[role="status"]').exists()).toBe(true)
	})

	test("renders the sub prop when provided", () => {
		expect(mountLoadingState({ label: "Loading", sub: "Decrypting your secrets" }).text()).toContain("Decrypting your secrets")
	})

	test("does NOT render the sub element when sub is empty", () => {
		expect(mountLoadingState({ label: "Loading", sub: "" }).html()).not.toMatch(/class="[^"]*sub[^"]*"/)
	})

	test("data-testid='loading-state' is on the wrapper for e2e selectors", () => {
		expect(mountLoadingState().attributes("data-testid")).toBe("loading-state")
	})
})
