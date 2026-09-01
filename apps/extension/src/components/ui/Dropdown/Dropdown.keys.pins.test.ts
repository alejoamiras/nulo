/**
 * Pre-extraction keyboard pins for DropdownRoot's arrow navigation (codex condition for the
 * mechanical split — the sibling suite proves ArrowDown, Enter gating and the focus-trap fallback):
 * ArrowUp with nothing focused lands on the LAST item, ArrowUp on the first wraps to the last,
 * ArrowDown on the last wraps to the first, and both arrows are inert without items.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { defineComponent, ref } from "vue"

vi.mock("focus-trap", () => ({
	createFocusTrap: vi.fn(() => ({ activate: vi.fn(), deactivate: vi.fn(), active: false })),
}))
vi.mock("@/composables/outside", () => ({ useOutside: vi.fn(() => () => {}) }))

import DropdownRoot from "./DropdownRoot.vue"

const FlexWithWrapper = defineComponent({
	inheritAttrs: false,
	setup(_, { expose }) {
		const wrapper = ref<HTMLElement | null>(null)
		expose({ wrapper })
		return { wrapper }
	},
	template: '<div ref="wrapper" v-bind="$attrs"><slot /></div>',
})
const STUBS = {
	Flex: FlexWithWrapper,
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<span />" },
}

async function openWith(popup: string) {
	const w = mount(DropdownRoot, {
		props: { forceOpen: false },
		slots: { default: "<button>Open</button>", popup },
		attachTo: document.body,
		global: { stubs: STUBS },
	})
	await w.setProps({ forceOpen: true })
	await flushPromises()
	return w
}
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k }))
const ITEMS =
	'<div data-dropdown-item tabindex="0" id="k-0">A</div><div data-dropdown-item tabindex="0" id="k-1">B</div><div data-dropdown-item tabindex="0" id="k-2">C</div>'

beforeEach(() => {
	// The menu teleports into `#dropdown` (the app shell provides it).
	const target = document.createElement("div")
	target.id = "dropdown"
	document.body.appendChild(target)
})
afterEach(() => {
	document.body.innerHTML = ""
})

describe("DropdownRoot — arrow navigation wrap-around", () => {
	test("ArrowUp with nothing focused lands on the LAST item; ArrowUp on the first wraps to the last", async () => {
		const w = await openWith(ITEMS)
		key("ArrowUp")
		expect(document.activeElement?.id).toBe("k-2")
		document.getElementById("k-0")?.focus()
		key("ArrowUp")
		expect(document.activeElement?.id).toBe("k-2")
		key("ArrowUp")
		expect(document.activeElement?.id).toBe("k-1")
		w.unmount()
	})

	test("ArrowDown on the last item wraps to the first", async () => {
		const w = await openWith(ITEMS)
		document.getElementById("k-2")?.focus()
		key("ArrowDown")
		expect(document.activeElement?.id).toBe("k-0")
		w.unmount()
	})

	test("without navigable items both arrows leave focus where it was", async () => {
		const w = await openWith('<div id="plain" tabindex="0">no items</div>')
		document.getElementById("plain")?.focus()
		key("ArrowDown")
		key("ArrowUp")
		expect(document.activeElement?.id).toBe("plain")
		w.unmount()
	})
})
