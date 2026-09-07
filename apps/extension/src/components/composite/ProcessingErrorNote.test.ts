import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import { nextTick } from "vue"
import ProcessingErrorNote from "./ProcessingErrorNote.vue"

const STUBS = {
	Tooltip: {
		props: ["disabled"],
		template: `<div data-testid="note" :data-tooltip-disabled="String(disabled)"><slot /><slot name="content" /></div>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

describe("ProcessingErrorNote", () => {
	test("hidden while show is false", () => {
		const w = mount(ProcessingErrorNote, { props: { show: false, title: "x" }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="note"]').exists()).toBe(false)
	})

	test("renders the title when shown", () => {
		const w = mount(ProcessingErrorNote, {
			props: { show: true, title: "Failed to add contact.", tooltip: "boom" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Failed to add contact.")
		expect(w.text()).toContain("boom")
	})

	test("tooltip is disabled when there is no detail", () => {
		const w = mount(ProcessingErrorNote, { props: { show: true, title: "t" }, global: { stubs: STUBS } })
		expect(w.find('[data-testid="note"]').attributes("data-tooltip-disabled")).toBe("true")
	})

	test("tooltip is enabled when detail exists", () => {
		const w = mount(ProcessingErrorNote, {
			props: { show: true, title: "t", tooltip: "detail" },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-testid="note"]').attributes("data-tooltip-disabled")).toBe("false")
	})
})

describe("ProcessingErrorNote — glyph colour and tooltip geometry", () => {
	const GEOMETRY_STUBS = {
		Tooltip: {
			props: { side: String, position: String, wide: Boolean, disabled: Boolean },
			inheritAttrs: false,
			template: `<div data-testid="note" :data-side="side" :data-position="position" :data-wide="String(wide)" :data-disabled="String(disabled)" :style="$attrs.style"><slot /><slot name="content" /></div>`,
		},
		Icon: {
			props: ["name", "size", "color"],
			template: `<i data-testid="glyph" :data-name="name" :data-size="size" :data-color="color" />`,
		},
		Text: { template: "<span><slot /></span>" },
		Flex: { template: "<div><slot /></div>" },
	}
	const mountNote = (props: Record<string, unknown>) =>
		mount(ProcessingErrorNote, {
			props: { show: true, title: "t", ...props },
			global: { stubs: { ...GEOMETRY_STUBS, transition: false } },
		})

	test("the info glyph is primary by default", () => {
		const glyph = mountNote({}).find("[data-testid='glyph']")
		expect(glyph.attributes()).toMatchObject({ "data-name": "info", "data-size": "14", "data-color": "primary" })
	})

	test("color flips the glyph to red for the FPC popups", () => {
		expect(mountNote({ color: "red" }).find("[data-testid='glyph']").attributes("data-color")).toBe("red")
	})

	test("the tooltip keeps its geometry: top, start, wide, -12px margin, disabled only without detail", () => {
		const bare = mountNote({}).find("[data-testid='note']")
		expect(bare.attributes()).toMatchObject({
			"data-side": "top",
			"data-position": "start",
			"data-wide": "true",
			"data-disabled": "true",
		})
		expect(bare.attributes("style")).toContain("margin-top: -12px")
		expect(mountNote({ tooltip: "boom" }).find("[data-testid='note']").attributes("data-disabled")).toBe("false")
	})

	test("the fade transition wraps the tooltip", async () => {
		const w = mountNote({ show: false })
		await w.setProps({ show: true })
		await nextTick()
		expect(w.find("[data-testid='note']").classes()).toContain("fade-enter-active")
	})
})
