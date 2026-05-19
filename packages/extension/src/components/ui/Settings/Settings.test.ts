/**
 * Combined tests for the Settings family — ItemsContainer, SettingItem,
 * SettingField, SettingValue. Each component gets ≥5 cases.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"

import ItemsContainer from "./ItemsContainer.vue"
import SettingItem from "./SettingItem.vue"
import SettingField from "./SettingField.vue"
import SettingValue from "./SettingValue.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: '<span :class="$attrs.class" v-bind="$attrs"><slot /></span>', inheritAttrs: false },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: '<span data-testid="stub-mat-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	RouterLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
}

describe("ui/Settings — ItemsContainer", () => {
	test("renders default slot content", () => {
		const w = mount(ItemsContainer, { slots: { default: "<div>child</div>" }, global: { stubs: STUBS } })
		expect(w.text()).toContain("child")
	})

	test("title prop renders above the slot", () => {
		const w = mount(ItemsContainer, {
			props: { title: "Profile" },
			slots: { default: "<div />" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Profile")
	})

	test("description prop renders below the slot", () => {
		const w = mount(ItemsContainer, {
			props: { description: "Hint text" },
			slots: { default: "<div />" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Hint text")
	})

	test("flat=true applies the wrapper_flat class (no background/border)", () => {
		const w = mount(ItemsContainer, {
			props: { flat: true },
			slots: { default: "<div />" },
			global: { stubs: STUBS },
		})
		expect(w.html()).toMatch(/wrapper_flat/)
	})

	test("flat=false (default) does NOT apply the wrapper_flat class", () => {
		const w = mount(ItemsContainer, { slots: { default: "<div />" }, global: { stubs: STUBS } })
		expect(w.html()).not.toMatch(/wrapper_flat/)
	})
})

describe("ui/Settings — SettingItem", () => {
	test("renders title prop", () => {
		const w = mount(SettingItem, { props: { title: "Account" }, global: { stubs: STUBS } })
		expect(w.text()).toContain("Account")
	})

	test("renders description prop when provided", () => {
		const w = mount(SettingItem, {
			props: { title: "X", description: "subline" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("subline")
	})

	test("to prop without external renders RouterLink stub (an <a>)", () => {
		const w = mount(SettingItem, {
			props: { title: "X", to: "/popup/general" },
			global: { stubs: STUBS },
		})
		expect(w.element.tagName.toLowerCase()).toBe("a")
	})

	test("external=true with to= renders an anchor with target=_blank", () => {
		const w = mount(SettingItem, {
			props: { title: "X", to: "https://example.com", external: true },
			global: { stubs: STUBS },
		})
		expect(w.element.tagName.toLowerCase()).toBe("a")
		expect(w.attributes("target")).toBe("_blank")
		expect(w.attributes("href")).toBe("https://example.com")
	})

	test("disabled=true sets tabindex=-1 and applies the disabled class", () => {
		const w = mount(SettingItem, {
			props: { title: "X", to: "/popup/x", disabled: true },
			global: { stubs: STUBS },
		})
		expect(w.attributes("tabindex")).toBe("-1")
		expect(w.html()).toMatch(/disabled/)
	})

	test("size=small applies the small class", () => {
		const w = mount(SettingItem, { props: { title: "X", size: "small" }, global: { stubs: STUBS } })
		expect(w.html()).toMatch(/small/)
	})

	test("loading + icon shows a Spinner (instead of the icon)", () => {
		const w = mount(SettingItem, {
			props: { title: "X", icon: "user", loading: true },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})
})

describe("ui/Settings — SettingField", () => {
	test("renders label and value props", () => {
		const w = mount(SettingField, {
			props: { label: "Network", value: "Testnet" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Network")
		expect(w.text()).toContain("Testnet")
	})

	test("icon prop renders an Icon stub", () => {
		const w = mount(SettingField, {
			props: { label: "X", value: "Y", icon: "chevron" },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-name="chevron"]').exists()).toBe(true)
	})

	test("no icon prop → no Icon stub", () => {
		const w = mount(SettingField, {
			props: { label: "X", value: "Y" },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-testid="stub-icon"]').exists()).toBe(false)
	})

	test("disabled prop applies the disabled class", () => {
		const w = mount(SettingField, {
			props: { label: "X", value: "Y", disabled: true },
			global: { stubs: STUBS },
		})
		expect(w.html()).toMatch(/disabled/)
	})

	test("non-disabled has no disabled class", () => {
		const w = mount(SettingField, {
			props: { label: "X", value: "Y" },
			global: { stubs: STUBS },
		})
		expect(w.html()).not.toMatch(/disabled/)
	})
})

describe("ui/Settings — SettingValue", () => {
	test("renders label and value props", () => {
		const w = mount(SettingValue, {
			props: { label: "Name", value: "Alice" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("Name")
		expect(w.text()).toContain("Alice")
	})

	test("value slot replaces the value text", () => {
		const w = mount(SettingValue, {
			props: { label: "Name", value: "fallback" },
			slots: { value: "<span>slot value</span>" },
			global: { stubs: STUBS },
		})
		expect(w.text()).toContain("slot value")
		expect(w.text()).not.toContain("fallback")
	})

	test("icon prop renders an Icon stub", () => {
		const w = mount(SettingValue, {
			props: { label: "X", value: "Y", icon: "copy" },
			global: { stubs: STUBS },
		})
		expect(w.find('[data-name="copy"]').exists()).toBe(true)
	})

	test("disabled prop applies the disabled class", () => {
		const w = mount(SettingValue, {
			props: { label: "X", value: "Y", disabled: true },
			global: { stubs: STUBS },
		})
		expect(w.html()).toMatch(/disabled/)
	})

	test("wrapper carries the wrapper CSS-module class", () => {
		const w = mount(SettingValue, {
			props: { label: "X", value: "Y" },
			global: { stubs: STUBS },
		})
		expect(w.html()).toMatch(/wrapper/)
	})
})
