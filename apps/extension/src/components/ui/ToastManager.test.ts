/**
 * Shell-integration coverage for the extension's <ToastManager> wrapper. The full behavioral matrix
 * lives in @nulo/design's ToastManagerBase.test.ts; here we only assert the wrapper delegates to the
 * base, that a toast driven through the extension's `@/composables/toast` shim (which re-exports the
 * package singleton) renders into the app's `#toast` root, and that the inset follows the route and
 * the page's footer.
 */
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { h, withDirectives } from "vue"
import { vSnackFooter } from "@/composables/snackInset"
import { useToast } from "@/composables/toast"

const routeMeta: { showBottomNav?: boolean } = {}
let routeName: string | undefined

vi.mock("vue-router", async () => {
	const actual = await vi.importActual<typeof import("vue-router")>("vue-router")
	return {
		...actual,
		useRoute: () => ({ meta: routeMeta, name: routeName }),
	}
})

import ToastManager from "./ToastManager.vue"

// Shared toast singleton → unmount each instance so it can't render the next test's toast.
enableAutoUnmount(afterEach)

let toastRoot: HTMLDivElement

describe("ui/ToastManager (wrapper → @nulo/design ToastManagerBase)", () => {
	beforeEach(() => {
		toastRoot = document.createElement("div")
		toastRoot.id = "toast"
		document.body.appendChild(toastRoot)
		useToast().closeToast()
		routeMeta.showBottomNav = undefined
		routeName = undefined
	})

	afterEach(() => {
		useToast().closeToast()
		toastRoot.remove()
	})

	test("an open toast (via the shim singleton) teleports into #toast", async () => {
		mount(ToastManager, { attachTo: document.body })
		useToast().openToast({ kind: "success", label: "Wrapped" })
		await flushPromises()
		expect(toastRoot.querySelector('[data-testid="snackbar"]')?.textContent).toContain("Wrapped")
	})

	test("renders no card in #toast when no toast is open", () => {
		mount(ToastManager, { attachTo: document.body })
		expect(toastRoot.querySelector('[data-testid="snackbar"]')).toBeNull()
		expect(toastRoot.textContent?.trim()).toBe("")
	})

	test("the inset is 76px on a route with the bottom nav and 12px otherwise", async () => {
		routeMeta.showBottomNav = true
		mount(ToastManager, { attachTo: document.body })
		await flushPromises()
		expect((toastRoot.firstElementChild as HTMLElement).style.bottom).toBe("76px")
		toastRoot.replaceChildren()

		routeMeta.showBottomNav = false
		mount(ToastManager, { attachTo: document.body })
		await flushPromises()
		expect((toastRoot.lastElementChild as HTMLElement).style.bottom).toBe("12px")
	})

	test.each([
		["windows-execute", true],
		["windows-discover", true],
		["windows-capabilities", true],
		["windows-verify", true],
		["windows-passkey", true],
		["windows-json", false],
		["windows-logger", false],
		["popup-general", false],
		["onboarding-welcome", false],
	])("on %s the card spans the content column: %s", (name, inColumn) => {
		routeName = name
		mount(ToastManager, { attachTo: document.body })
		expect(/in_column/.test((toastRoot.firstElementChild as HTMLElement).className)).toBe(inColumn)
	})

	test("on a route without the nav, a footer on screen lifts the snack 12px above its top edge", async () => {
		vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600)
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			return DOMRect.fromRect({ y: "footer" in this.dataset ? 520 : 0, width: 360, height: "footer" in this.dataset ? 80 : 0 })
		})
		routeMeta.showBottomNav = false
		mount(ToastManager, { attachTo: document.body })
		mount({ render: () => withDirectives(h("div", { "data-footer": "" }), [[vSnackFooter]]) }, { attachTo: document.body })
		await new Promise((resolve) => requestAnimationFrame(resolve))
		await flushPromises()
		expect((toastRoot.firstElementChild as HTMLElement).style.bottom).toBe("92px")
		vi.restoreAllMocks()
	})
})
