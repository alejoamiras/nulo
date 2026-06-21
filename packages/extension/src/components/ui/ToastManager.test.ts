/**
 * Shell-integration coverage for the extension's <ToastManager> wrapper. The full behavioral matrix
 * lives in @nulo/design's ToastManagerBase.test.ts; here we only assert the wrapper delegates to the
 * base AND that an open toast driven through the extension's `@/composables/toast` shim (which
 * re-exports the package singleton) actually renders into the app's `#toast` root.
 */
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { useToast } from "@/composables/toast"
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
	})

	afterEach(() => {
		useToast().closeToast()
		toastRoot.remove()
	})

	test("an open toast (via the shim singleton) teleports into #toast", async () => {
		mount(ToastManager, { attachTo: document.body })
		useToast().openToast({ label: "Wrapped" })
		await flushPromises()
		expect(toastRoot.textContent).toContain("Wrapped")
	})

	test("renders nothing in #toast when no toast is open", () => {
		mount(ToastManager, { attachTo: document.body })
		expect(toastRoot.textContent).toBe("")
	})
})
