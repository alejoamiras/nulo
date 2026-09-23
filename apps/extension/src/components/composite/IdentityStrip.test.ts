import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import IdentityStrip from "./IdentityStrip.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
}

const factory = (props: Record<string, unknown> = {}) =>
	mount(IdentityStrip, { props: { accountLabel: "Alpha", ...props }, global: { stubs: STUBS } })

describe("composite/IdentityStrip", () => {
	test("renders the account label", () => {
		expect(factory().text()).toContain("Alpha")
	})

	test("renders the NULO brand mark", () => {
		expect(factory().text()).toContain("NULO")
	})

	test("networkLabel undefined: no separator, no network span", () => {
		const w = factory()
		expect(w.text()).not.toContain("·")
		expect(w.findAll("span").length).toBe(3) // dot, account, brand
	})

	test("networkLabel EMPTY STRING still renders the separator (discover/capabilities contract)", () => {
		const w = factory({ networkLabel: "" })
		expect(w.text()).toContain("·")
		expect(w.findAll("span").length).toBe(5) // dot, account, sep, network, brand
	})

	test("networkLabel set: separator + network text render", () => {
		const w = factory({ networkLabel: "Sandbox" })
		expect(w.text()).toContain("·")
		expect(w.text()).toContain("Sandbox")
	})

	test("default status dot is status_ready", () => {
		expect(factory().find("span").attributes("class") || "").toContain("status_ready")
	})

	test("status='loading' swaps in the loading class", () => {
		expect(factory({ status: "loading" }).find("span").attributes("class") || "").toContain("status_loading")
	})

	test("status='cancelled' swaps in the cancelled class", () => {
		expect(factory({ status: "cancelled" }).find("span").attributes("class") || "").toContain("status_cancelled")
	})

	test("warn=false: network span has no identity_warn class", () => {
		const w = factory({ networkLabel: "MIXED" })
		const network = w.findAll("span")[3]
		expect(network.attributes("class") || "").not.toContain("identity_warn")
	})

	test("warn=true: network span carries identity_warn (the execute/verify multi-account signal)", () => {
		const w = factory({ networkLabel: "MIXED", warn: true })
		const network = w.findAll("span")[3]
		expect(network.attributes("class") || "").toContain("identity_warn")
	})

	test("account label is not silently substituted — renders exactly what the caller passed", () => {
		expect(factory({ accountLabel: "3 accounts" }).text()).toContain("3 accounts")
	})
})
