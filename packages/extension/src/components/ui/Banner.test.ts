import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import Banner from "./Banner.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Spinner: { template: '<span data-testid="stub-spinner" />' },
}

const mountBanner = (props: Record<string, unknown> = {}, slots: Record<string, string> = { default: "Body" }) =>
	mount(Banner, { props, slots, global: { stubs: STUBS } })

describe("ui/Banner", () => {
	test("renders default slot content", () => {
		const w = mountBanner({}, { default: "Welcome banner" })
		expect(w.text()).toContain("Welcome banner")
	})

	test("default variant is `info` and applies the info class", () => {
		const w = mountBanner()
		expect(w.html()).toMatch(/info/)
	})

	test("variant=warning applies the warning class", () => {
		const w = mountBanner({ variant: "warning" })
		expect(w.html()).toMatch(/warning/)
	})

	test("isLoading replaces the info icon with a Spinner", () => {
		const wIdle = mountBanner({ isLoading: false })
		expect(wIdle.find('[data-testid="stub-spinner"]').exists()).toBe(false)
		const wLoading = mountBanner({ isLoading: true })
		expect(wLoading.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})

	test("description slot renders alongside title", () => {
		const w = mountBanner({}, { default: "Title", description: "Subline" })
		expect(w.text()).toContain("Title")
		expect(w.text()).toContain("Subline")
	})

	test("action object renders a button that fires the callback on click", async () => {
		let fired = 0
		const w = mountBanner({
			action: {
				name: "Click",
				callback: () => {
					fired++
				},
			},
		})
		const btn = w.find("button")
		expect(btn.exists()).toBe(true)
		expect(btn.text()).toBe("Click")
		await btn.trigger("click")
		expect(fired).toBe(1)
	})

	test("no action prop → no button rendered", () => {
		const w = mountBanner()
		expect(w.find("button").exists()).toBe(false)
	})
})
