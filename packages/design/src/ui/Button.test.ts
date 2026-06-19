import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Button from "./Button.vue"

const STUBS = {
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	Icon: { template: '<span data-testid="stub-icon" />' },
}

const mountButton = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Button, { props, slots, global: { stubs: STUBS } })

describe("Button (router-free base)", () => {
	test("renders default slot content inside a <button>", () => {
		const w = mountButton({}, { default: "Click me" })
		expect(w.element.tagName).toBe("BUTTON")
		expect(w.text()).toBe("Click me")
	})

	test("disabled sets the native disabled attribute + tabindex -1", () => {
		const w = mountButton({ disabled: true }, { default: "X" })
		expect(w.attributes("disabled")).toBeDefined()
		expect(w.attributes("tabindex")).toBe("-1")
	})

	test("loading renders a Spinner + applies the loading class", () => {
		const w = mountButton({ loading: true }, { default: "Saving" })
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
		expect(w.attributes("class") ?? "").toMatch(/loading/)
	})

	test("leftIcon + rightIcon render two Icon stubs flanking the slot", () => {
		const w = mountButton({ leftIcon: "arrow-left", rightIcon: "arrow-right" }, { default: "Continue" })
		expect(w.findAll('[data-testid="stub-icon"]')).toHaveLength(2)
	})

	test("size + variant apply the matching CSS module classes", () => {
		const cls = mountButton({ size: "large", variant: "secondary" }, { default: "Big" }).attributes("class") ?? ""
		expect(cls).toMatch(/large/)
		expect(cls).toMatch(/secondary/)
	})

	test("cta / cta_outline / cta_destructive / ghost variants apply their classes", () => {
		for (const v of ["cta", "cta_outline", "cta_destructive", "ghost"]) {
			expect(mountButton({ variant: v }, { default: "x" }).attributes("class") ?? "").toMatch(new RegExp(v))
		}
	})

	test("wide applies the wide modifier class", () => {
		expect(mountButton({ wide: true }, { default: "Full" }).attributes("class") ?? "").toMatch(/wide/)
	})

	test('tag="a" renders an anchor with href; target=_blank adds rel hygiene', () => {
		const w = mountButton({ tag: "a", href: "/x", target: "_blank" }, { default: "Link" })
		expect(w.element.tagName).toBe("A")
		expect(w.attributes("href")).toBe("/x")
		expect(w.attributes("rel")).toBe("noopener noreferrer")
	})

	test('tag="a" without target=_blank has no rel', () => {
		expect(mountButton({ tag: "a", href: "/x" }, { default: "Link" }).attributes("rel")).toBeUndefined()
	})

	test("(BUG PIN) disabled applies only in button mode, never on an anchor", () => {
		// Original `:disabled="!link && disabled"` never set disabled on links; preserved as
		// `tag === 'button' && disabled`.
		const w = mountButton({ tag: "a", href: "/x", disabled: true }, { default: "Link" })
		expect(w.attributes("disabled")).toBeUndefined()
	})
})
