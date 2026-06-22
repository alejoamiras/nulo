/**
 * ToastManagerBase teleports its rendered toast into `teleportTo` (default `#toast`). The composable
 * `useToast` is module-scoped, so we import it directly and drive the toast state through it.
 */
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useToast } from "../composables/toast"
import ToastManagerBase from "./ToastManagerBase.vue"

// Auto-unmount between tests: every region shares the module-scope toast singleton, so a lingering
// instance from a prior test would also render the next test's toast (esp. into the default #toast).
enableAutoUnmount(afterEach)

let toastRoot: HTMLDivElement

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
}

const mountRegion = (props: Record<string, unknown> = {}) =>
	mount(ToastManagerBase, { attachTo: document.body, props, global: { stubs: STUBS } })

describe("ToastManagerBase", () => {
	beforeEach(() => {
		toastRoot = document.createElement("div")
		toastRoot.id = "toast"
		document.body.appendChild(toastRoot)
		vi.useFakeTimers()
		useToast().closeToast()
	})

	afterEach(() => {
		toastRoot.remove()
		vi.useRealTimers()
	})

	test("renders nothing inside #toast when no toast is open", () => {
		mountRegion()
		expect(toastRoot.textContent).toBe("")
	})

	test("openToast teleports the label into #toast", async () => {
		mountRegion()
		useToast().openToast({ label: "Saved" })
		await flushPromises()
		expect(toastRoot.textContent).toContain("Saved")
	})

	test("default icon name is 'check-circle' when toast.icon is not set", async () => {
		mountRegion()
		useToast().openToast({ label: "Saved" })
		await flushPromises()
		expect(toastRoot.querySelector('[data-name="check-circle"]')).not.toBeNull()
	})

	test("custom icon prop is honored", async () => {
		mountRegion()
		useToast().openToast({ label: "Bzzt", icon: "warning" })
		await flushPromises()
		expect(toastRoot.querySelector('[data-name="warning"]')).not.toBeNull()
	})

	test("color=red applies the variant_red CSS class on the card", async () => {
		mountRegion()
		useToast().openToast({ label: "Boom", color: "red" })
		await flushPromises()
		expect(toastRoot.innerHTML).toMatch(/variant_red/)
	})

	test("clicking the toast card closes it (clears the label)", async () => {
		mountRegion()
		useToast().openToast({ label: "Disposable" })
		await flushPromises()
		expect(toastRoot.textContent).toContain("Disposable")
		const card = toastRoot.querySelector("[class*='card']") as HTMLElement | null
		card?.click()
		await flushPromises()
		expect(toastRoot.textContent).not.toContain("Disposable")
	})

	test("auto-close timer hides the toast after the configured duration", async () => {
		mountRegion()
		useToast().openToast({ label: "Timed out" }, 1500)
		await flushPromises()
		expect(toastRoot.textContent).toContain("Timed out")
		vi.advanceTimersByTime(1500)
		await flushPromises()
		expect(toastRoot.textContent).not.toContain("Timed out")
	})

	test("rapid second openToast resets the timer; the first timeout does not kill the second early", async () => {
		mountRegion()
		const { openToast } = useToast()
		openToast({ label: "First" }, 1500)
		await flushPromises()
		vi.advanceTimersByTime(1000)
		openToast({ label: "Second" }, 2000)
		await flushPromises()
		vi.advanceTimersByTime(500)
		await flushPromises()
		expect(toastRoot.textContent).toContain("Second")
		vi.advanceTimersByTime(1500)
		await flushPromises()
		expect(toastRoot.textContent).not.toContain("Second")
	})

	test("teleportTo overrides the target root", async () => {
		const custom = document.createElement("div")
		custom.id = "custom-toast"
		document.body.appendChild(custom)
		try {
			mountRegion({ teleportTo: "#custom-toast" })
			useToast().openToast({ label: "Elsewhere" })
			await flushPromises()
			expect(custom.textContent).toContain("Elsewhere")
			expect(toastRoot.textContent).toBe("")
		} finally {
			custom.remove()
		}
	})
})
