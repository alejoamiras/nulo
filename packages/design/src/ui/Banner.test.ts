import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Banner from "./Banner.vue"

// Stub the child primitives by name — vue-test-utils matches `global.stubs` keys against the
// component name even for the package's explicit imports. Keeps these cases focused on Banner.
const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Spinner: { template: '<span data-testid="stub-spinner" />' },
}

const mountBanner = (props: Record<string, unknown> = {}, slots: Record<string, string> = { default: "Body" }) =>
	mount(Banner, { props, slots, global: { stubs: STUBS } })

describe("Banner", () => {
	test("renders default slot content", () => {
		expect(mountBanner({}, { default: "Welcome banner" }).text()).toContain("Welcome banner")
	})

	test("default variant is `info` and applies the info class", () => {
		expect(mountBanner().html()).toMatch(/info/)
	})

	test("variant=warning applies the warning class", () => {
		expect(mountBanner({ variant: "warning" }).html()).toMatch(/warning/)
	})

	test("isLoading replaces the info icon with a Spinner", () => {
		expect(mountBanner({ isLoading: false }).find('[data-testid="stub-spinner"]').exists()).toBe(false)
		expect(mountBanner({ isLoading: true }).find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})

	test("description slot renders alongside title", () => {
		const w = mountBanner({}, { default: "Title", description: "Subline" })
		expect(w.text()).toContain("Title")
		expect(w.text()).toContain("Subline")
	})

	test("action object renders a button that fires the callback on click", async () => {
		let fired = 0
		const w = mountBanner({ action: { name: "Click", callback: () => fired++ } })
		const btn = w.find("button")
		expect(btn.exists()).toBe(true)
		expect(btn.text()).toBe("Click")
		await btn.trigger("click")
		expect(fired).toBe(1)
	})

	test("action.testId lands on the button as data-testid, in both directions", () => {
		const action = { name: "Go", callback: () => {}, testId: "banner-go" }
		expect(mountBanner({ action }).find('button[data-testid="banner-go"]').exists()).toBe(true)
		expect(mountBanner({ action, direction: "vertical" }).find('button[data-testid="banner-go"]').exists()).toBe(true)
		expect(
			mountBanner({ action: { name: "Go", callback: () => {} } })
				.find("button")
				.attributes("data-testid"),
		).toBeUndefined()
	})

	test("no action prop → no button rendered", () => {
		expect(mountBanner().find("button").exists()).toBe(false)
	})
})
