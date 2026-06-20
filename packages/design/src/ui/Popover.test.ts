import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Popover from "./Popover.vue"

vi.mock("../composables/outside", () => ({
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

describe("Popover", () => {
	beforeEach(() => {
		popoverRoot = document.createElement("div")
		popoverRoot.id = "popover"
		document.body.appendChild(popoverRoot)
	})

	afterEach(() => {
		popoverRoot.remove()
	})

	test("renders the default slot (trigger)", () => {
		expect(mountPopover().find("button").text()).toBe("trigger")
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
		expect(mountPopover({ disabled: true }).html()).toMatch(/disabled/)
	})

	test("teleportTo overrides the target root", async () => {
		const custom = document.createElement("div")
		custom.id = "custom-pop"
		document.body.appendChild(custom)
		try {
			const w = mountPopover({ open: false, teleportTo: "#custom-pop" })
			await w.setProps({ open: true })
			await flushPromises()
			expect(custom.textContent).toContain("Popover body")
			expect(popoverRoot.textContent).not.toContain("Popover body")
		} finally {
			custom.remove()
		}
	})
})
