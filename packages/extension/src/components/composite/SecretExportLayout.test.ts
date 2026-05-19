import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SecretExportLayout from "./SecretExportLayout.vue"

const STUBS = {
	Flex: {
		template: '<div :ref="forwardRef" :class="$attrs.class"><slot /></div>',
		props: ["forwardRef"],
		inheritAttrs: false,
	},
	SubPageHeader: {
		template: '<header><slot name="title" /></header>',
		props: ["backTo"],
	},
}

const factory = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(SecretExportLayout, {
		props: {
			heroMain: "Secret",
			heroSub: "Key",
			collapsingLabel: "Secret Key",
			backTo: "/popup/settings/security/export",
			...props,
		},
		slots,
		global: { stubs: STUBS },
	})

describe("composite/SecretExportLayout", () => {
	test("renders heroMain in the title stack", () => {
		const w = factory({ heroMain: "Encrypted" })
		expect(w.text()).toContain("Encrypted")
	})

	test("renders heroSub when provided", () => {
		const w = factory({ heroMain: "Plain", heroSub: "Key" })
		const text = w.text()
		expect(text).toContain("Plain")
		expect(text).toContain("Key")
	})

	test("omits the heroSub line when heroSub is empty", () => {
		const w = factory({ heroMain: "Solo", heroSub: "" })
		// Only one title element renders.
		const titles = w.findAll("span").filter((s) => s.text() === "Solo")
		expect(titles.length).toBe(1)
	})

	test("collapsingLabel renders inside the SubPageHeader", () => {
		const w = factory({ collapsingLabel: "Plain Key" })
		expect(w.find("header").text()).toContain("Plain Key")
	})

	test("default slot renders inside the content area", () => {
		const w = factory({}, { default: '<p data-testid="body-content">body</p>' })
		expect(w.find('[data-testid="body-content"]').exists()).toBe(true)
	})

	test("bottom slot renders in a dedicated bottom container", () => {
		const w = factory({}, { bottom: '<button data-testid="cta-bottom">Go</button>' })
		expect(w.find('[data-testid="cta-bottom"]').exists()).toBe(true)
	})

	test("bottom container is omitted when bottom slot is empty", () => {
		const w = factory()
		// The bottom slot gates the wrapper; with no slot, we shouldn't have a bottom div.
		// With Flex stubbed as a div, all top-level divs come from <Flex>. The bottom <div>
		// uses CSS module class — assert no <div> with the bottom class is present.
		const html = w.html()
		expect(html).not.toMatch(/class="[^"]*bottom[^"]*"/)
	})
})
