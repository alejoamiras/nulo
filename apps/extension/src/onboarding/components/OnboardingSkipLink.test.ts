import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OnboardingSkipLink from "./OnboardingSkipLink.vue"

describe("OnboardingSkipLink", () => {
	test("is a plain button carrying the page's testid and label", () => {
		const w = mount(OnboardingSkipLink, { props: { testid: "onboarding-learn-skip" }, slots: { default: "Skip intro" } })
		expect(w.element.tagName).toBe("BUTTON")
		expect(w.attributes("type")).toBe("button")
		expect(w.attributes("data-testid")).toBe("onboarding-learn-skip")
		expect(w.text()).toBe("Skip intro")
	})

	test("a click emits once", async () => {
		const w = mount(OnboardingSkipLink, { props: { testid: "onboarding-fees-skip" } })
		await w.trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})
})
