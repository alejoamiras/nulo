import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import DappIdentityBlock from "./DappIdentityBlock.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span :data-name="name" />', props: ["name", "size", "color", "loading"] },
	Tooltip: { template: "<div data-tooltip><slot /></div>" },
}

const factory = (props: Record<string, unknown> = {}) =>
	mount(DappIdentityBlock, {
		props: { actionLabel: "wants to connect", ...props },
		global: { stubs: STUBS },
	})

describe("composite/DappIdentityBlock", () => {
	test("renders the hostname", () => {
		const w = factory({ hostname: "example.com" })
		expect(w.text()).toContain("example.com")
	})

	test("renders the action label", () => {
		const w = factory({ hostname: "x", actionLabel: "wants to call" })
		expect(w.text()).toContain("wants to call")
	})

	test("renders the dapp name when present", () => {
		const w = factory({ hostname: "x", dapp: { name: "MyDapp" } })
		expect(w.text()).toContain("MyDapp")
	})

	test("omits the name span when dapp.name is missing", () => {
		const w = factory({ hostname: "x", dapp: { logoBlobUrl: "" } })
		expect(w.text()).not.toContain("undefined")
	})

	test("loading logo shows a loading icon", () => {
		const w = factory({ hostname: "x", dapp: { loadingLogo: true } })
		expect(w.find('[data-name="dapp"]').exists()).toBe(true)
	})

	test("logo blob URL renders an <img>", () => {
		const w = factory({ hostname: "x", dapp: { logoBlobUrl: "blob:http://x/abc" } })
		expect(w.find("img").attributes("src")).toBe("blob:http://x/abc")
	})

	test("warning tooltip appears for suspicious hostnames", () => {
		const w = factory({ hostname: "exámple.com", hostnameSuspicious: true })
		expect(w.find("[data-tooltip]").exists()).toBe(true)
	})

	test("no warning tooltip for safe hostnames", () => {
		const w = factory({ hostname: "example.com", hostnameSuspicious: false })
		expect(w.find("[data-tooltip]").exists()).toBe(false)
	})

	test("hostnameTestId prop is forwarded to the hostname span", () => {
		const w = factory({ hostname: "x", hostnameTestId: "discover-hostname" })
		expect(w.find('[data-testid="discover-hostname"]').exists()).toBe(true)
	})

	test("nameTestId prop is forwarded to the name span", () => {
		const w = factory({ hostname: "x", dapp: { name: "MyDapp" }, nameTestId: "discover-dapp-name" })
		expect(w.find('[data-testid="discover-dapp-name"]').exists()).toBe(true)
	})
})
