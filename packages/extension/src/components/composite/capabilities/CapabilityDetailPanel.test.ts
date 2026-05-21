import { beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"

beforeEach(() => {
	// useToast is auto-imported in production via unplugin-auto-import,
	// but the plugin isn't active in vitest. Provide a global stub.
	vi.stubGlobal("useToast", () => ({ openToast: vi.fn(), closeToast: vi.fn(), toast: { value: null } }))
})

import CapabilityDetailPanel from "./CapabilityDetailPanel.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
}

// Tests use minimal Capability shapes; cast to bypass the tagged-union
// requirements (accounts capability requires `accounts` field, etc.).
const mountPanel = (capability: Record<string, unknown>, granted = false) =>
	// biome-ignore lint/suspicious/noExplicitAny: test fixture
	mount(CapabilityDetailPanel, { props: { capability: capability as any, granted }, global: { stubs: STUBS } })

describe("composite/CapabilityDetailPanel", () => {
	test("accounts capability with canGet:true renders 'View accounts' permission", () => {
		const w = mountPanel({ type: "accounts", canGet: true })
		expect(w.text()).toContain("View accounts")
	})

	test("accounts capability with canCreateAuthWit:true renders the auth witness permission", () => {
		const w = mountPanel({ type: "accounts", canCreateAuthWit: true })
		expect(w.text()).toContain("Create auth witnesses")
	})

	test("contracts capability with '*' scope shows 'Any contract'", () => {
		const w = mountPanel({ type: "contracts", contracts: "*", canRegister: true })
		expect(w.text()).toContain("Any contract")
		expect(w.text()).toContain("Register contracts")
	})

	test("contracts capability with array scope renders each contract address", () => {
		const w = mountPanel({
			type: "contracts",
			contracts: ["0xabc123", "0xdef456"],
			canRegister: true,
			canGetMetadata: true,
		})
		expect(w.text()).toContain("0xabc123")
		expect(w.text()).toContain("0xdef456")
		expect(w.text()).toContain("Read contract metadata")
	})

	test("contractClasses capability with '*' scope shows 'Any contract class'", () => {
		const w = mountPanel({ type: "contractClasses", classes: "*" })
		expect(w.text()).toContain("Any contract class")
	})

	test("granted=true applies the 'granted' style modifier", () => {
		const w = mountPanel({ type: "accounts", canGet: true }, true)
		expect(w.html()).toMatch(/granted/)
	})

	test("clicking a contract address triggers clipboard write (copyAddress)", async () => {
		const writeText = vi.fn()
		Object.assign(navigator, { clipboard: { writeText } })
		const w = mountPanel({ type: "contracts", contracts: ["0xabc123"], canRegister: true })
		const copyTarget = w.findAll("span").find((s) => s.text() === "0xabc123")
		await copyTarget?.trigger("click")
		expect(writeText).toHaveBeenCalledWith("0xabc123")
	})
})
