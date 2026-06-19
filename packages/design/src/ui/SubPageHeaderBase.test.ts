import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import SubPageHeaderBase from "./SubPageHeaderBase.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	MaterialIcon: { template: '<span data-testid="stub-mat-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

const mountHeader = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(SubPageHeaderBase, { props, slots, global: { stubs: STUBS } })

describe("SubPageHeaderBase (router-free)", () => {
	test("renders the title prop", () => {
		expect(mountHeader({ title: "Settings" }).text()).toContain("Settings")
	})

	test("title slot overrides the title prop", () => {
		const w = mountHeader({ title: "Default" }, { title: "<span>Custom title</span>" })
		expect(w.text()).toContain("Custom title")
		expect(w.text()).not.toContain("Default")
	})

	test("renders the back button by default", () => {
		expect(mountHeader({ title: "X" }).find("button[aria-label='Back']").exists()).toBe(true)
	})

	test("showBack=false hides the back button", () => {
		expect(mountHeader({ title: "X", showBack: false }).find("button[aria-label='Back']").exists()).toBe(false)
	})

	test("leadingIcon renders a MaterialIcon before the title", () => {
		expect(mountHeader({ title: "Settings", leadingIcon: "settings" }).find('[data-name="settings"]').exists()).toBe(true)
	})

	test("trailing slot renders inside the trailing region", () => {
		expect(mountHeader({ title: "X" }, { trailing: '<button id="cta">Edit</button>' }).find("#cta").exists()).toBe(true)
	})

	test("clicking back emits @back (no router coupling)", async () => {
		const w = mountHeader({ title: "X" })
		await w.find("button[aria-label='Back']").trigger("click")
		expect(w.emitted("back")).toHaveLength(1)
	})
})
