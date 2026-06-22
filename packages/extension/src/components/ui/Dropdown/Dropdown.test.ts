/**
 * Combined tests for the Dropdown family. Each component gets ≥5 cases
 * covering the props/slots/events surface — batched here because the
 * components form one cohesive unit.
 *
 * DropdownRoot uses focus-trap + position math via getBoundingClientRect.
 * Both are mocked / no-op'd in jsdom; we test the observable contract
 * (slot rendering + isOpen + emits + disabled) without relying on
 * computed positioning.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { defineComponent, ref } from "vue"

vi.mock("focus-trap", () => ({
	createFocusTrap: vi.fn(() => ({
		activate: vi.fn(),
		deactivate: vi.fn(),
		active: false,
	})),
}))

vi.mock("@/composables/outside", () => ({
	useOutside: vi.fn(() => () => {}),
}))

import DropdownRoot from "./DropdownRoot.vue"
import DropdownTrigger from "./DropdownTrigger.vue"
import DropdownItem from "./DropdownItem.vue"
import DropdownTitle from "./DropdownTitle.vue"
import DropdownDivider from "./DropdownDivider.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: '<span :class="$attrs.class" v-bind="$attrs"><slot /></span>', inheritAttrs: false },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

describe("ui/Dropdown — DropdownDivider", () => {
	test("renders a single div", () => {
		const w = mount(DropdownDivider)
		expect(w.element.tagName).toBe("DIV")
	})

	test("has the wrapper CSS-module class", () => {
		const w = mount(DropdownDivider)
		expect(w.attributes("class") ?? "").toMatch(/wrapper/)
	})

	test("renders no slot content (it's a self-closing visual divider)", () => {
		const w = mount(DropdownDivider)
		expect(w.text()).toBe("")
	})

	test("has no children", () => {
		const w = mount(DropdownDivider)
		expect(w.element.children.length).toBe(0)
	})

	test("renders identically across mounts (deterministic)", () => {
		const a = mount(DropdownDivider).html()
		const b = mount(DropdownDivider).html()
		expect(a).toBe(b)
	})
})

describe("ui/Dropdown — DropdownTitle", () => {
	test("renders default slot content", () => {
		const w = mount(DropdownTitle, { slots: { default: "Section A" }, global: { stubs: STUBS } })
		expect(w.text()).toContain("Section A")
	})

	test("wrapper has the title's CSS-module class", () => {
		const w = mount(DropdownTitle, { slots: { default: "X" }, global: { stubs: STUBS } })
		expect(w.html()).toMatch(/wrapper/)
	})

	test("falls back to no text when slot is empty", () => {
		const w = mount(DropdownTitle, { global: { stubs: STUBS } })
		expect(w.text()).toBe("")
	})

	test("multiple instances render independently", () => {
		const a = mount(DropdownTitle, { slots: { default: "A" }, global: { stubs: STUBS } })
		const b = mount(DropdownTitle, { slots: { default: "B" }, global: { stubs: STUBS } })
		expect(a.text()).toContain("A")
		expect(b.text()).toContain("B")
	})

	test("HTML in the slot is rendered (slot trust contract)", () => {
		const w = mount(DropdownTitle, { slots: { default: "<em>Strong</em>" }, global: { stubs: STUBS } })
		expect(w.html()).toContain("<em>Strong</em>")
	})
})

describe("ui/Dropdown — DropdownItem", () => {
	test("renders default slot content", () => {
		const w = mount(DropdownItem, { slots: { default: "Action one" } })
		expect(w.text()).toContain("Action one")
	})

	// (frontend-ux-fixes P5a) was tabindex="1" (a positive value corrupts whole-document tab order);
	// now tabindex="0" + a stable `data-dropdown-item` hook so DropdownRoot's arrow-nav isn't coupled to
	// the tabindex literal.
	test("is focusable (tabindex='0') and tagged data-dropdown-item for DropdownRoot arrow-nav", () => {
		const w = mount(DropdownItem, { slots: { default: "X" } })
		expect(w.attributes("tabindex")).toBe("0")
		expect(w.attributes("data-dropdown-item")).toBeDefined()
	})

	test("wrapper carries the wrapper CSS-module class", () => {
		const w = mount(DropdownItem, { slots: { default: "X" } })
		expect(w.attributes("class") ?? "").toMatch(/wrapper/)
	})

	test("disabled prop applies the disabled class", () => {
		const w = mount(DropdownItem, { props: { disabled: true }, slots: { default: "X" } })
		expect(w.attributes("class") ?? "").toMatch(/disabled/)
	})

	// (P5a post-impl, codex MEDIUM) a disabled item must be OUT of the Tab order AND the arrow-nav set,
	// so it can't be focused + Enter-activated (DropdownRoot's Enter does activeElement.click()).
	test("a disabled item is unfocusable (tabindex=-1) and excluded from arrow-nav (no data-dropdown-item)", () => {
		const w = mount(DropdownItem, { props: { disabled: true }, slots: { default: "X" } })
		expect(w.attributes("tabindex")).toBe("-1")
		expect(w.attributes("data-dropdown-item")).toBeUndefined()
	})

	test("non-disabled item does NOT have the disabled class", () => {
		const w = mount(DropdownItem, { slots: { default: "X" } })
		expect(w.attributes("class") ?? "").not.toMatch(/disabled/)
	})
})

describe("ui/Dropdown — DropdownTrigger", () => {
	test("renders default slot content", () => {
		const w = mount(DropdownTrigger, { slots: { default: "Trigger" }, global: { stubs: STUBS } })
		expect(w.text()).toContain("Trigger")
	})

	test("default width=120px when not wide", () => {
		const w = mount(DropdownTrigger, { slots: { default: "X" }, global: { stubs: STUBS } })
		expect(w.attributes("style") ?? "").toMatch(/width:\s*120px/)
	})

	test("wide=true sets width to 100%", () => {
		const w = mount(DropdownTrigger, { props: { wide: true }, slots: { default: "X" }, global: { stubs: STUBS } })
		expect(w.attributes("style") ?? "").toMatch(/width:\s*100%/)
	})

	test("renders a chevron Icon stub by default", () => {
		const w = mount(DropdownTrigger, { slots: { default: "X" }, global: { stubs: STUBS } })
		expect(w.find('[data-name="chevron"]').exists()).toBe(true)
	})

	test("clearable + value renders close-circle Icon and emits onClear when clicked", async () => {
		const w = mount(DropdownTrigger, {
			props: { clearable: true, value: { id: 1 } },
			slots: { default: "X" },
			global: { stubs: STUBS },
		})
		const closeIcon = w.find('[data-name="close-circle"]')
		expect(closeIcon.exists()).toBe(true)
		await closeIcon.trigger("click")
		expect(w.emitted("onClear")).toBeTruthy()
	})

	test("disabled prop applies the disabled CSS class", () => {
		const w = mount(DropdownTrigger, { props: { disabled: true }, slots: { default: "X" }, global: { stubs: STUBS } })
		expect(w.html()).toMatch(/disabled/)
	})
})

describe("ui/Dropdown — DropdownRoot", () => {
	let dropdownRoot: HTMLDivElement

	beforeEach(() => {
		dropdownRoot = document.createElement("div")
		dropdownRoot.id = "dropdown"
		document.body.appendChild(dropdownRoot)
	})

	afterEach(() => {
		dropdownRoot.remove()
	})

	test("renders the default slot (trigger)", () => {
		const w = mount(DropdownRoot, {
			slots: { default: "<button>Open</button>" },
			attachTo: document.body,
			global: { stubs: STUBS },
		})
		expect(w.find("button").text()).toBe("Open")
	})

	test("clicking the trigger toggles the popup slot into #dropdown", async () => {
		const w = mount(DropdownRoot, {
			slots: { default: "<button id='trigger-btn'>Open</button>", popup: "<span>Menu</span>" },
			attachTo: document.body,
			global: { stubs: STUBS },
		})
		expect(dropdownRoot.textContent).not.toContain("Menu")
		await w.find("#trigger").trigger("click")
		await flushPromises()
		expect(dropdownRoot.textContent).toContain("Menu")
	})

	test("forceOpen prop opens the dropdown without a click", async () => {
		const w = mount(DropdownRoot, {
			props: { forceOpen: false },
			slots: { default: "<button>Open</button>", popup: "<span>Menu</span>" },
			attachTo: document.body,
			global: { stubs: STUBS },
		})
		expect(dropdownRoot.textContent).not.toContain("Menu")
		await w.setProps({ forceOpen: true })
		await flushPromises()
		expect(dropdownRoot.textContent).toContain("Menu")
	})

	test("disabled prop blocks the toggle click", async () => {
		const w = mount(DropdownRoot, {
			props: { disabled: true },
			slots: { default: "<button>Open</button>", popup: "<span>Menu</span>" },
			attachTo: document.body,
			global: { stubs: STUBS },
		})
		await w.find("#trigger").trigger("click")
		await flushPromises()
		expect(dropdownRoot.textContent).not.toContain("Menu")
	})

	test("closing emits onClose", async () => {
		const w = mount(DropdownRoot, {
			props: { forceOpen: false },
			slots: { default: "<button>Open</button>", popup: "<span>Menu</span>" },
			attachTo: document.body,
			global: { stubs: STUBS },
		})
		// forceOpen watcher only reacts to *changes*; cycle false→true→false to
		// reach the close branch.
		await w.setProps({ forceOpen: true })
		await flushPromises()
		await w.setProps({ forceOpen: false })
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
	})

	// (frontend-ux-fixes P5a) regression pin: arrow-nav must keep finding items after the
	// `[tabindex="1"]` → `[data-dropdown-item]` selector change (else changing DropdownItem's tabindex
	// silently breaks keyboard nav — the codex HIGH). The Flex stub here exposes `wrapper` (the real
	// Flex's contract that DropdownRoot queries) so the nav can run.
	test("ArrowDown navigates between data-dropdown-item elements", async () => {
		const FlexWithWrapper = defineComponent({
			inheritAttrs: false,
			setup(_, { expose }) {
				const wrapper = ref<HTMLElement | null>(null)
				expose({ wrapper })
				return { wrapper }
			},
			template: '<div ref="wrapper" v-bind="$attrs"><slot /></div>',
		})
		const w = mount(DropdownRoot, {
			props: { forceOpen: false },
			slots: {
				default: "<button>Open</button>",
				popup: '<div data-dropdown-item tabindex="0" id="ditem-0">A</div><div data-dropdown-item tabindex="0" id="ditem-1">B</div>',
			},
			attachTo: document.body,
			global: { stubs: { ...STUBS, Flex: FlexWithWrapper } },
		})
		await w.setProps({ forceOpen: true })
		await flushPromises()
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
		expect(document.activeElement?.id).toBe("ditem-0")
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
		expect(document.activeElement?.id).toBe("ditem-1")
		w.unmount()
	})

	// (P5a post-impl, codex LOW) end-to-end Enter-gate: a focused aria-disabled item must NOT fire its
	// click on Enter (DropdownRoot.onKeydown gates activeElement.click() on aria-disabled !== "true").
	test("Enter activates a focused item but NOT one marked aria-disabled", async () => {
		const FlexWithWrapper = defineComponent({
			inheritAttrs: false,
			setup(_, { expose }) {
				const wrapper = ref<HTMLElement | null>(null)
				expose({ wrapper })
				return { wrapper }
			},
			template: '<div ref="wrapper" v-bind="$attrs"><slot /></div>',
		})
		const w = mount(DropdownRoot, {
			props: { forceOpen: false },
			slots: {
				default: "<button>Open</button>",
				popup: '<div id="d-enabled" tabindex="0">Enabled</div><div id="d-disabled" aria-disabled="true" tabindex="-1">Disabled</div>',
			},
			attachTo: document.body,
			global: { stubs: { ...STUBS, Flex: FlexWithWrapper } },
		})
		await w.setProps({ forceOpen: true })
		await flushPromises()
		const enabled = document.getElementById("d-enabled") as HTMLElement
		const disabled = document.getElementById("d-disabled") as HTMLElement
		const enabledClick = vi.fn()
		const disabledClick = vi.fn()
		enabled.addEventListener("click", enabledClick)
		disabled.addEventListener("click", disabledClick)

		disabled.focus()
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		expect(disabledClick).not.toHaveBeenCalled()

		enabled.focus()
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		expect(enabledClick).toHaveBeenCalled()
		w.unmount()
	})
})
