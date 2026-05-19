/**
 * ToastManager teleports its rendered toast into `#toast`. The composable
 * `useToast` is module-scoped so we import it directly and drive the
 * toast state through it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import ToastManager from "./ToastManager.vue"
import { useToast } from "@/composables/toast"

let toastRoot: HTMLDivElement

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
}

const mountToastManager = () =>
	mount(ToastManager, {
		attachTo: document.body,
		global: { stubs: STUBS },
	})

describe("ui/ToastManager", () => {
	beforeEach(() => {
		toastRoot = document.createElement("div")
		toastRoot.id = "toast"
		document.body.appendChild(toastRoot)
		vi.useFakeTimers()
		const { closeToast } = useToast()
		closeToast()
	})

	afterEach(() => {
		toastRoot.remove()
		vi.useRealTimers()
	})

	test("renders nothing inside #toast when no toast is open", () => {
		mountToastManager()
		expect(toastRoot.textContent).toBe("")
	})

	test("openToast teleports the label into #toast", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Saved" })
		await flushPromises()
		expect(toastRoot.textContent).toContain("Saved")
	})

	test("default icon name is 'check-circle' when toast.icon is not set", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Saved" })
		await flushPromises()
		expect(toastRoot.querySelector('[data-name="check-circle"]')).not.toBeNull()
	})

	test("custom icon prop is honored", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Bzzt", icon: "warning" })
		await flushPromises()
		expect(toastRoot.querySelector('[data-name="warning"]')).not.toBeNull()
	})

	test("color=red applies the variant_red CSS class on the card", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Boom", color: "red" })
		await flushPromises()
		expect(toastRoot.innerHTML).toMatch(/variant_red/)
	})

	test("clicking the toast card closes it (clears the label)", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Disposable" })
		await flushPromises()
		expect(toastRoot.textContent).toContain("Disposable")
		const card = toastRoot.querySelector("[class*='card']") as HTMLElement | null
		card?.click()
		await flushPromises()
		expect(toastRoot.textContent).not.toContain("Disposable")
	})

	test("auto-close timer hides the toast after the configured duration", async () => {
		mountToastManager()
		const { openToast } = useToast()
		openToast({ label: "Timed out" }, 1500)
		await flushPromises()
		expect(toastRoot.textContent).toContain("Timed out")
		vi.advanceTimersByTime(1500)
		await flushPromises()
		expect(toastRoot.textContent).not.toContain("Timed out")
	})
})
