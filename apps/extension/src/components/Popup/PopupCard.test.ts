import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"
import PopupCard from "./PopupCard.vue"

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("PopupCard", () => {
	test("starts the fullscreen setting on mount and disposes it on unmount", () => {
		const calls: string[] = []
		// The composable is auto-imported by the SFC; the test provides it the way the build would.
		vi.stubGlobal("useFullscreenPopupSetting", () => ({
			showFullscreen: ref(false),
			start: async () => {
				calls.push("start")
			},
			dispose: () => {
				calls.push("dispose")
			},
		}))
		const wrapper = mount(PopupCard, { global: { stubs: { Flex: { template: "<div><slot /></div>" } } } })
		expect(calls).toEqual(["start"])
		wrapper.unmount()
		expect(calls).toEqual(["start", "dispose"])
	})
})
