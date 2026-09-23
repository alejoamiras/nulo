import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { nextTick, ref } from "vue"
import PopupCard from "./PopupCard.vue"

afterEach(() => {
	vi.unstubAllGlobals()
})

/** The composable is auto-imported by the SFC; the test provides it the way the build would. */
const stubSetting = (showFullscreen: boolean, calls: string[] = []) => {
	const setting = ref(showFullscreen)
	vi.stubGlobal("useFullscreenPopupSetting", () => ({
		showFullscreen: setting,
		start: async () => {
			calls.push("start")
		},
		dispose: () => {
			calls.push("dispose")
		},
	}))
	return setting
}

const FlexStub = { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false }
const mountCard = (props: Record<string, unknown> = {}) =>
	mount(PopupCard, { props: { displaceIdx: 1, ...props }, global: { stubs: { Flex: FlexStub } } })
const flexOf = (w: ReturnType<typeof mountCard>) => (w.element as HTMLElement).style.flexGrow

describe("PopupCard", () => {
	test("starts the fullscreen setting on mount and disposes it on unmount", () => {
		const calls: string[] = []
		stubSetting(false, calls)
		const wrapper = mountCard()
		expect(calls).toEqual(["start"])
		wrapper.unmount()
		expect(calls).toEqual(["start", "dispose"])
	})

	test("fills the popup while the setting says so", async () => {
		const setting = stubSetting(true)
		const w = mountCard()
		expect(flexOf(w)).toBe("10")
		setting.value = false
		await nextTick()
		expect(flexOf(w)).toBe("")
		w.unmount()
	})

	test("fit: sized to the content whatever the setting says; the handle expands it for this open only", async () => {
		const setting = stubSetting(true)
		const w = mountCard({ fit: true })
		expect(flexOf(w)).toBe("")
		await w.get('[class*="handle_zone"]').trigger("click")
		expect(flexOf(w)).toBe("10")
		expect(setting.value).toBe(true)
		await w.get('[class*="handle_zone"]').trigger("click")
		expect(flexOf(w)).toBe("")
		w.unmount()
	})
})
