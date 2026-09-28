/**
 * Combined tests for the Settings family — ItemsContainer, SettingItem,
 * SettingField, SettingValue. Each component gets ≥5 cases.
 */
import { describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { h } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import { RowAction } from "@nulo/design"

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
	const { RouterLink: _link, ...ROW_STUBS } = STUBS
	const makeRouter = () =>
		createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] })
	const space = (shiftKey = false) => new KeyboardEvent("keydown", { key: " ", shiftKey, bubbles: true, cancelable: true })
	const enter = () => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })

	async function mountItem(props: Record<string, unknown>, attrs: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
		const router = makeRouter()
		await router.push("/start")
		const push = vi.spyOn(router, "push")
		const w = mount(SettingItem, { props, attrs, slots, global: { stubs: ROW_STUBS, plugins: [router] }, attachTo: document.body })
		return { w, router, push }
	}

	test("renders title and description", async () => {
		const { w } = await mountItem({ title: "Account", description: "subline" })
		expect(w.text()).toContain("Account")
		expect(w.text()).toContain("subline")
		w.unmount()
	})

	test("link mode: an anchor root with the route's href, no tabindex; a click and Space each navigate once, Shift+Space not at all", async () => {
		const { w, router, push } = await mountItem({ title: "X", to: "/popup/general" }, { "data-testid": "row" })
		expect(w.element.tagName).toBe("A")
		expect(w.attributes("href")).toBe("/popup/general")
		expect(w.attributes("data-testid")).toBe("row")
		expect(w.attributes("tabindex")).toBeUndefined()
		expect(w.find("[data-row-target]").exists()).toBe(false)

		await w.trigger("click")
		await flushPromises()
		expect(push).toHaveBeenCalledTimes(1)
		expect(router.currentRoute.value.path).toBe("/popup/general")

		await router.push("/start")
		push.mockClear()
		const plain = space()
		w.element.dispatchEvent(plain)
		await flushPromises()
		expect(plain.defaultPrevented).toBe(true)
		expect(push).toHaveBeenCalledTimes(1)

		push.mockClear()
		const shifted = space(true)
		w.element.dispatchEvent(shifted)
		await flushPromises()
		expect(shifted.defaultPrevented).toBe(false)
		expect(push).not.toHaveBeenCalled()
		w.unmount()
	})

	test("external mode: a new-tab anchor; a bare Space presses it once and prevents the scroll, a modified Space does neither", async () => {
		const { w } = await mountItem({ title: "X", to: "https://example.com", external: true })
		expect(w.element.tagName).toBe("A")
		expect(w.attributes("target")).toBe("_blank")
		expect(w.attributes("rel")).toBe("noopener noreferrer")
		expect(w.attributes("href")).toBe("https://example.com")
		expect(w.attributes("tabindex")).toBeUndefined()
		const click = vi.spyOn(w.element as HTMLAnchorElement, "click").mockImplementation(() => {})

		const plain = space()
		w.element.dispatchEvent(plain)
		expect(click).toHaveBeenCalledTimes(1)
		expect(plain.defaultPrevented).toBe(true)

		const shifted = space(true)
		w.element.dispatchEvent(shifted)
		expect(click).toHaveBeenCalledTimes(1)
		expect(shifted.defaultPrevented).toBe(false)
		w.unmount()
	})

	test("click mode: a div root holding a button target named by the title; the target's press runs the handler once", async () => {
		const onClick = vi.fn()
		const { w } = await mountItem({ title: "Manage" }, { onClick })
		expect(w.element.tagName).toBe("DIV")
		expect(w.attributes("tabindex")).toBeUndefined()
		const target = w.find("[data-row-target]")
		expect(target.element.tagName).toBe("BUTTON")
		expect(w.find(`#${target.attributes("aria-labelledby")}`).text()).toBe("Manage")
		expect(w.html()).toMatch(/interactive/)

		await target.trigger("click")
		expect(onClick).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("click mode with a nested RowAction: the action fires and the row handler does not", async () => {
		const onClick = vi.fn()
		const onCopy = vi.fn()
		const { w } = await mountItem(
			{ title: "Alice" },
			{ onClick },
			{ right: () => h(RowAction, { label: "Copy account address", "data-testid": "copy", onClick: onCopy }, () => "c") },
		)
		const action = w.find('[data-testid="copy"]')
		expect(action.element.tagName).toBe("BUTTON")
		expect(w.find("[data-row-target]").find('[data-testid="copy"]').exists()).toBe(false)
		await action.trigger("click")
		expect(onCopy).toHaveBeenCalledTimes(1)
		expect(onClick).not.toHaveBeenCalled()
		w.unmount()
	})

	test("inert mode: no target, no tabindex, no pointer class", async () => {
		const { w } = await mountItem({ title: "Version", raw: true })
		expect(w.element.tagName).toBe("DIV")
		expect(w.find("[data-row-target]").exists()).toBe(false)
		expect(w.find("[tabindex]").exists()).toBe(false)
		expect(w.html()).not.toMatch(/interactive/)
		w.unmount()
	})

	test.each([
		["to", { to: "/popup/x" }, {}],
		["@click", {}, { onClick: vi.fn() }],
	])(
		"a disabled row with %s is inert: no a, button, target or tabindex, and Enter neither navigates nor calls the handler",
		async (_name, props, attrs) => {
			const { w, push } = await mountItem({ title: "X", disabled: true, ...props }, attrs)
			expect(w.element.tagName).toBe("DIV")
			expect(w.html()).toMatch(/disabled/)
			expect(w.find("a, button, [data-row-target], [tabindex]").exists()).toBe(false)
			expect(w.attributes("href")).toBeUndefined()

			w.element.dispatchEvent(enter())
			await w.trigger("click")
			await flushPromises()
			expect(push).not.toHaveBeenCalled()
			if ("onClick" in attrs) expect(attrs.onClick).not.toHaveBeenCalled()
			w.unmount()
		},
	)

	test("size=small applies the small class", async () => {
		const { w } = await mountItem({ title: "X", size: "small" })
		expect(w.html()).toMatch(/small/)
		w.unmount()
	})

	test("loading + icon shows a Spinner (instead of the icon)", async () => {
		const { w } = await mountItem({ title: "X", icon: "user", loading: true })
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
		w.unmount()
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
