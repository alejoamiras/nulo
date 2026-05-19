import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import Popover from "./Popover.vue"

vi.mock("@/composables/outside", () => ({
	useOutside: vi.fn(() => () => {}),
}))

let popoverRoot: HTMLDivElement

const mountPopover = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Popover, {
		props: { width: "200", ...props },
		slots: { default: "<button>trigger</button>", content: "Popover body", ...slots },
		attachTo: document.body,
		global: {
			stubs: {
				Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
			},
		},
	})

describe("ui/Popover", () => {
	beforeEach(() => {
		popoverRoot = document.createElement("div")
		popoverRoot.id = "popover"
		document.body.appendChild(popoverRoot)
	})

	afterEach(() => {
		popoverRoot.remove()
	})

	test("renders the default slot (trigger)", () => {
		const w = mountPopover()
		expect(w.find("button").text()).toBe("trigger")
	})

	test("does NOT teleport content when open=false", () => {
		mountPopover({ open: false })
		expect(popoverRoot.textContent).not.toContain("Popover body")
	})

	test("teleports content into #popover when open=true", async () => {
		const w = mountPopover({ open: false })
		await w.setProps({ open: true })
		await flushPromises()
		expect(popoverRoot.textContent).toContain("Popover body")
	})

	test("closing emits onClose when Escape is pressed", async () => {
		const w = mountPopover({ open: false })
		await w.setProps({ open: true })
		await flushPromises()
		document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }))
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("disabled prop applies the disabled CSS class on the wrapper", () => {
		const w = mountPopover({ disabled: true })
		expect(w.html()).toMatch(/disabled/)
	})
})
