import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import SpinnerLegacy from "./SpinnerLegacy.vue"

// Temporary frozen spinner (the faucet rides it until P7). Minimal coverage — it is a verbatim copy
// of the pre-round-2 package Spinner and is deleted in P7.
describe("SpinnerLegacy (temporary, faucet-frozen)", () => {
	it("renders a status element at the given size", () => {
		const el = mount(SpinnerLegacy, { props: { size: 18 } }).get(".spinner")
		expect(el.attributes("role")).toBe("status")
		expect(el.attributes("style")).toContain("width: 18px")
	})

	it("exposes a configurable aria-label", () => {
		expect(mount(SpinnerLegacy).get(".spinner").attributes("aria-label")).toBe("Loading")
	})
})
