/**
 * Shell-integration coverage for the extension's <ToastManager> wrapper. The full behavioral matrix
 * lives in @nulo/design's ToastManagerBase.test.ts; here we only assert the wrapper delegates to the
 * base, that a toast driven through the extension's `@/composables/toast` shim (which re-exports the
 * package singleton) renders into the app's `#toast` root, and that the inset follows the route.
 */
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useToast } from "@/composables/toast"

const routeMeta: { showBottomNav?: boolean } = {}

vi.mock("vue-router", async () => {
	const actual = await vi.importActual<typeof import("vue-router")>("vue-router")
	return {
		...actual,
		useRoute: () => ({ meta: routeMeta }),
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
})
