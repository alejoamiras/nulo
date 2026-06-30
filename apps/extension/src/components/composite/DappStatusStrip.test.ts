import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import DappStatusStrip from "./DappStatusStrip.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
}

const factory = (props: Record<string, unknown> = {}) => mount(DappStatusStrip, { props, global: { stubs: STUBS } })

describe("composite/DappStatusStrip", () => {
	test("renders the supplied account name", () => {
		const w = factory({ accountName: "Alpha", networkName: "Sandbox" })
		expect(w.text()).toContain("Alpha")
	})

	test("renders the supplied network name", () => {
		const w = factory({ accountName: "x", networkName: "Sandbox" })
		expect(w.text()).toContain("Sandbox")
	})

	test("falls back to 'No account' when accountName is empty", () => {
		const w = factory({ accountName: "", networkName: "n" })
		expect(w.text()).toContain("No account")
	})

	test("renders the NULO brand mark", () => {
		const w = factory({ accountName: "x", networkName: "y" })
		expect(w.text()).toContain("NULO")
	})

	test("dot picks up the status_ready class for the default 'ready' status", () => {
		const w = factory({ accountName: "x", networkName: "y" })
		const dotClass = w.find("span").attributes("class") || ""
		expect(dotClass).toContain("status_ready")
	})

	test("status='loading' swaps in the loading class", () => {
		const w = factory({ accountName: "x", networkName: "y", status: "loading" })
		const dotClass = w.find("span").attributes("class") || ""
		expect(dotClass).toContain("status_loading")
	})

	test("status='cancelled' swaps in the cancelled class", () => {
		const w = factory({ accountName: "x", networkName: "y", status: "cancelled" })
		const dotClass = w.find("span").attributes("class") || ""
		expect(dotClass).toContain("status_cancelled")
	})
})
