import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import PopupHeader from "./PopupHeader.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	MaterialIcon: { template: '<span data-testid="stub-mat-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

const mountHeader = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(PopupHeader, { props, slots, global: { stubs: STUBS } })

describe("ui/Popup/PopupHeader", () => {
	test("renders the title slot", () => {
		const w = mountHeader({}, { title: "<span>My title</span>" })
		expect(w.text()).toContain("My title")
	})

	test("renders the description slot", () => {
		const w = mountHeader({}, { title: "<span>X</span>", description: "<span>Subtitle</span>" })
		expect(w.text()).toContain("Subtitle")
	})

	test("renders the right slot for trailing controls", () => {
		const w = mountHeader({}, { title: "<span>X</span>", right: "<button id='cta'>edit</button>" })
		expect(w.find("#cta").exists()).toBe(true)
	})

	test("closable=true renders a close button with aria-label='Close'", () => {
		const w = mountHeader({ closable: true }, { title: "<span>X</span>" })
		const btn = w.find("button[aria-label='Close']")
		expect(btn.exists()).toBe(true)
	})

	test("closable=false (default) hides the close button", () => {
		const w = mountHeader({}, { title: "<span>X</span>" })
		const btn = w.find("button[aria-label='Close']")
		expect(btn.exists()).toBe(false)
	})

	test("clicking the close button emits onClose", async () => {
		const w = mountHeader({ closable: true }, { title: "<span>X</span>" })
		await w.find("button[aria-label='Close']").trigger("click")
		expect(w.emitted("onClose")).toHaveLength(1)
	})

	test("close button is a MaterialIcon with name='close'", () => {
		const w = mountHeader({ closable: true }, { title: "<span>X</span>" })
		expect(w.find('[data-name="close"]').exists()).toBe(true)
	})
})
