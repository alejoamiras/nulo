import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import AuthProfilePill from "./AuthProfilePill.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	MaterialIcon: { template: '<i :data-name="name" />', props: ["name", "size", "color"] },
}

const factory = (props: Record<string, unknown> = {}) => mount(AuthProfilePill, { props, global: { stubs: STUBS } })

describe("AuthProfilePill", () => {
	test("renders the profile name", () => {
		const w = factory({ name: "Default" })
		expect(w.text()).toContain("Default")
	})

	test("renders the 'Current Profile' label", () => {
		const w = factory({ name: "x" })
		expect(w.text()).toContain("Current Profile")
	})

	test("preserves the canonical 'auth-profile' testid", () => {
		const w = factory({ name: "x" })
		expect(w.find('[data-testid="auth-profile"]').exists()).toBe(true)
	})

	test("clicking the pill emits 'click'", async () => {
		const w = factory({ name: "x" })
		await w.find('[data-testid="auth-profile"]').trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})

	test("renders the chevron + person icons", () => {
		const w = factory({ name: "x" })
		expect(w.find('[data-name="person"]').exists()).toBe(true)
		expect(w.find('[data-name="chevron_right"]').exists()).toBe(true)
	})
})
