import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import Badge from "./Badge.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
}

const mountBadge = (props: Record<string, unknown> = {}, slot = "badge") =>
	mount(Badge, { props, slots: { default: slot }, global: { stubs: STUBS } })

describe("ui/Badge", () => {
	test("renders default slot content", () => {
		const w = mountBadge({}, "Hi there")
		expect(w.text()).toContain("Hi there")
	})

	test("default variant is `info` and applies the info class", () => {
		const w = mountBadge()
		expect(w.html()).toMatch(/info/)
	})

	test("variant=warning applies the warning class", () => {
		const w = mountBadge({ variant: "warning" })
		expect(w.html()).toMatch(/warning/)
	})

	test("variant=error applies the error class", () => {
		const w = mountBadge({ variant: "error" })
		expect(w.html()).toMatch(/error/)
	})

	test("variant=purple applies the purple class", () => {
		const w = mountBadge({ variant: "purple" })
		expect(w.html()).toMatch(/purple/)
	})

	test("wrapper carries the `wrapper` CSS-module class", () => {
		const w = mountBadge()
		expect(w.html()).toMatch(/wrapper/)
	})
})
