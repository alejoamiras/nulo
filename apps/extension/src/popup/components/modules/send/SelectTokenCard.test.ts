/**
 * Send's token card: while the page's tokens load it is an inert, busy row that a tap or a key
 * cannot open, with a skeleton only after a noticeable wait; loaded, it opens the token picker, or
 * the import popup when there is no token, from a tap, Enter or Space.
 */
import { createTestingPinia } from "@pinia/testing"
import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"

import { usePopupStore } from "@/stores/popup.store"
import SelectTokenCard from "./SelectTokenCard.vue"

const TOKEN = { id: 7, symbol: "TST", name: "TestToken", hasPrivateTransfers: true, hasPublicTransfers: true }

function mountCard(props: Record<string, unknown>) {
	const pinia = createTestingPinia()
	const w = mount(SelectTokenCard, {
		props,
		global: {
			plugins: [pinia],
			stubs: {
				Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
				Icon: { template: "<i />" },
				MaterialIcon: { template: "<i />" },
			},
		},
	})
	return { w, popupStore: usePopupStore(pinia) }
}

const trigger = (w: ReturnType<typeof mountCard>["w"]) => w.get('[data-testid="send-token-trigger"]')
const skeletons = (w: ReturnType<typeof mountCard>["w"]) => w.findAll('[aria-hidden="true"]').length

afterEach(() => {
	vi.useRealTimers()
})

describe("send/SelectTokenCard", () => {
	test("loading: a tap, Enter and Space open nothing, and the row is busy and out of the Tab path", async () => {
		const { w, popupStore } = mountCard({ loading: true })
		for (const act of ["click", "keydown.enter", "keydown.space"]) await trigger(w).trigger(act)
		expect(popupStore.open).not.toHaveBeenCalled()
		expect(trigger(w).attributes()).toMatchObject({
			"data-state": "loading",
			role: "button",
			tabindex: "-1",
			"aria-busy": "true",
			"aria-disabled": "true",
		})
		expect(w.text()).not.toContain("No available tokens")
	})

	test("only while loading is the row named Loading tokens; ready and empty keep the names their content gives", async () => {
		const { w } = mountCard({ loading: true })
		expect(trigger(w).attributes("aria-label")).toBe("Loading tokens")
		await w.setProps({ loading: false })
		expect(trigger(w).attributes("aria-label")).toBeUndefined()
		await w.setProps({ token: TOKEN })
		expect(trigger(w).attributes("aria-label")).toBeUndefined()
		// A token handed in while loading is drawn, so the row reads it rather than the wait.
		await w.setProps({ loading: true })
		expect(trigger(w).attributes("aria-label")).toBeUndefined()
	})

	test("loading with a token: the token is drawn, ready to open", () => {
		const { w } = mountCard({ loading: true, token: TOKEN })
		expect(trigger(w).attributes("data-state")).toBe("ready")
		expect(trigger(w).attributes("aria-busy")).toBeUndefined()
		expect(w.get('[data-testid="send-token-symbol"]').text()).toBe("TST")
	})

	test("loading: no skeleton before 300 ms, the token row's skeleton after", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const { w } = mountCard({ loading: true })
		await vi.advanceTimersByTimeAsync(299)
		expect(skeletons(w)).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(skeletons(w)).toBe(3)
	})

	test("the skeleton timer is cleared when loading ends and on unmount", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const ended = mountCard({ loading: true })
		await ended.w.setProps({ loading: false })
		expect(vi.getTimerCount()).toBe(0)
		expect(ended.w.text()).toContain("No available tokens")

		mountCard({ loading: true }).w.unmount()
		expect(vi.getTimerCount()).toBe(0)
	})

	test("loaded with a token: a tap, Enter and Space each open the token picker", async () => {
		const { w, popupStore } = mountCard({ token: TOKEN })
		expect(trigger(w).attributes()).toMatchObject({ "data-state": "ready", role: "button", tabindex: "0" })
		for (const act of ["click", "keydown.enter", "keydown.space"]) await trigger(w).trigger(act)
		expect(vi.mocked(popupStore.open).mock.calls).toEqual([["select_token"], ["select_token"], ["select_token"]])
	})

	test("loaded with no token: the empty copy, and a tap opens the import popup", async () => {
		const { w, popupStore } = mountCard({ loading: false })
		expect(trigger(w).attributes()).toMatchObject({ "data-state": "empty", tabindex: "0" })
		expect(w.text()).toContain("No available tokens")
		expect(w.text()).toContain("Import token")
		await trigger(w).trigger("click")
		expect(popupStore.open).toHaveBeenCalledWith("new_token")
	})
})
