/**
 * Tests for the `useFullscreenPopupSetting` composable.
 *
 * Exercises the composable's lifecycle/contract in isolation by mocking
 * the underlying `ConfigServiceClient`. Verifies:
 *   - returns a writable Ref<boolean>
 *   - subscribes to config service onUpdate for the showPopupFullscreen key
 *   - refreshes from config on mount
 *   - forces fullscreen=true when window.innerHeight > 600
 *   - disconnects the client on unmount
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { defineComponent, nextTick } from "vue"
import { mount } from "@vue/test-utils"

type Listener = (setting: { key: string; value: unknown }) => void

const mocks = vi.hoisted(() => {
	const listeners: Listener[] = []
	const disconnect = vi.fn()
	const getValue = vi.fn().mockResolvedValue(false)
	return { listeners, disconnect, getValue }
})

const { listeners, disconnect, getValue } = mocks

vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: class {
		onUpdate = { add: (l: Listener) => mocks.listeners.push(l) }
		getValue = mocks.getValue
		disconnect = mocks.disconnect
	},
}))

import { useFullscreenPopupSetting } from "./fullscreenPopupSetting"

const makeHost = () =>
	defineComponent({
		setup() {
			const value = useFullscreenPopupSetting()
			return { value }
		},
		template: '<div :data-fs="value">{{ value }}</div>',
	})

describe("composables/useFullscreenPopupSetting", () => {
	beforeEach(() => {
		listeners.length = 0
		disconnect.mockClear()
		getValue.mockClear()
		getValue.mockResolvedValue(false)
		Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 500 })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("returns a writable boolean ref", () => {
		const w = mount(makeHost())
		const ref = (w.vm as unknown as { value: boolean }).value
		expect(typeof ref).toBe("boolean")
	})

	test("registers an onUpdate listener for showPopupFullscreen", () => {
		mount(makeHost())
		expect(listeners.length).toBeGreaterThanOrEqual(1)
	})

	test("config service push updates the ref reactively", async () => {
		const w = mount(makeHost())
		await nextTick()
		listeners[0]?.({ key: "showPopupFullscreen", value: true })
		await nextTick()
		expect(w.element.getAttribute("data-fs")).toBe("true")
	})

	test("config service push for a different key is ignored", async () => {
		const w = mount(makeHost())
		await nextTick()
		await Promise.resolve()
		await nextTick()
		const before = w.element.getAttribute("data-fs")
		listeners[0]?.({ key: "someOtherKey", value: true })
		await nextTick()
		expect(w.element.getAttribute("data-fs")).toBe(before)
	})

	test("calls getValue on mount to refresh from config", async () => {
		mount(makeHost())
		await nextTick()
		await Promise.resolve()
		expect(getValue).toHaveBeenCalledWith("showPopupFullscreen")
	})

	test("forces fullscreen=true when window.innerHeight > 600", async () => {
		Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 800 })
		const w = mount(makeHost())
		await nextTick()
		await Promise.resolve()
		await nextTick()
		expect(w.element.getAttribute("data-fs")).toBe("true")
	})

	test("does NOT force true on a short window (innerHeight <= 600)", async () => {
		Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 500 })
		getValue.mockResolvedValue(false)
		const w = mount(makeHost())
		await nextTick()
		await Promise.resolve()
		await nextTick()
		expect(w.element.getAttribute("data-fs")).toBe("false")
	})

	test("respects config truthy value on a short window", async () => {
		Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 500 })
		getValue.mockResolvedValue(true)
		const w = mount(makeHost())
		await nextTick()
		await Promise.resolve()
		await nextTick()
		expect(w.element.getAttribute("data-fs")).toBe("true")
	})

	test("disposes the ConfigServiceClient on unmount", async () => {
		const w = mount(makeHost())
		await nextTick()
		w.unmount()
		expect(disconnect).toHaveBeenCalledTimes(1)
	})

	test("multiple instances each subscribe and dispose independently", async () => {
		const w1 = mount(makeHost())
		const w2 = mount(makeHost())
		await nextTick()
		expect(listeners.length).toBe(2)
		w1.unmount()
		expect(disconnect).toHaveBeenCalledTimes(1)
		w2.unmount()
		expect(disconnect).toHaveBeenCalledTimes(2)
	})
})
