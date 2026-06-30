/**
 * Coverage for the shared onboarding page layout. Six cases, each load-bearing:
 *   1. default render — class state + no inline style
 *   2. `align="center"` adds the center class
 *   3. `gap=40` maps to the CSS var
 *   4. `gap=0` does NOT regress to the default — pins the `!== undefined`
 *      check in `gapVar` against a truthy-shortcut refactor
 *   5. default slot renders
 *   6. root `tagName === 'DIV'` — pins the a11y decision against accidental
 *      `<main>` / `<section>` reintroduction (which would nest inside app.vue's
 *      existing `<main>` landmark)
 *
 * No `<= 10 case` minimum applies here — this is a slot-only shell with a
 * 2-prop surface. Bulk cases would dilute, not strengthen, coverage.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"

import OnboardingPage from "./OnboardingPage.vue"

describe("OnboardingPage", () => {
	test("default render — page class applied, center absent, no inline style", () => {
		const wrapper = mount(OnboardingPage)
		const html = wrapper.html()
		expect(/\bclass="[^"]*page[^"]*"/i.test(html)).toBe(true)
		expect(/\bclass="[^"]*center[^"]*"/i.test(html)).toBe(false)
		expect(wrapper.attributes("style")).toBeUndefined()
	})

	test('align="center" adds the center class', () => {
		const wrapper = mount(OnboardingPage, { props: { align: "center" } })
		const html = wrapper.html()
		expect(/center/i.test(html)).toBe(true)
	})

	test("gap=40 maps to the CSS custom property on the root", () => {
		const wrapper = mount(OnboardingPage, { props: { gap: 40 } })
		const style = wrapper.attributes("style") ?? ""
		expect(style).toContain("--onboarding-page-gap: 40px")
	})

	test("gap=0 renders 0px on the root (NOT the 32px fallback)", () => {
		const wrapper = mount(OnboardingPage, { props: { gap: 0 } })
		const style = wrapper.attributes("style") ?? ""
		expect(style).toContain("--onboarding-page-gap: 0px")
	})

	test("default slot renders passed content", () => {
		const wrapper = mount(OnboardingPage, {
			slots: { default: '<span data-testid="child">payload</span>' },
		})
		const child = wrapper.find('[data-testid="child"]')
		expect(child.exists()).toBe(true)
		expect(child.text()).toBe("payload")
	})

	test("root element is a <div> (locks a11y — app.vue#shell is the page's <main>)", () => {
		const wrapper = mount(OnboardingPage)
		expect(wrapper.element.tagName).toBe("DIV")
	})
})
