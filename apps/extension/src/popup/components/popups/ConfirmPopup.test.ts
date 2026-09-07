/**
 * ConfirmPopup's single-action mode (`cacheStore.confirm.single`): one button, no Cancel, no
 * callback required — and the flag must not leak into the next, destructive confirm.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick, reactive } from "vue"

const H = vi.hoisted(() => ({
	store: { current: null as unknown as { confirm: Record<string, unknown> } },
	openToast: vi.fn(),
}))

vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: H.openToast }) }))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ profile: { id: "p1" } }) }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => H.store.current }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ len: 1, popups: { confirm: { order: 1 } } }) }))

import ConfirmPopup from "./ConfirmPopup.vue"

const STUBS = {
	Popup: { props: ["show"], template: "<div v-if='show'><slot /></div>" },
	PopupCard: { template: "<div><slot /></div>" },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Toggle: { template: "<input type='checkbox' />" },
	Input: {
		props: ["modelValue", "placeholder"],
		emits: ["update:modelValue"],
		// The popup focuses `inputEl` on show when a confirmation term is set.
		setup(_props: unknown, { expose }: { expose: (o: Record<string, unknown>) => void }) {
			expose({ inputEl: { focus: () => undefined } })
			return {}
		},
		template: `<input data-testid="confirm-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
	},
	Button: {
		props: ["type", "disabled"],
		emits: ["click"],
		template: `<button :data-type="type" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
	},
}

async function open(wrapper: ReturnType<typeof mount>, confirm: Record<string, unknown>) {
	Object.assign(H.store.current.confirm, confirm)
	await wrapper.setProps({ show: true })
	await flushPromises()
}

describe("ConfirmPopup — single-action mode", () => {
	beforeEach(() => {
		vi.stubGlobal("managers", { profile: { confirmProfileOperation: vi.fn() } })
		H.store.current = reactive({ confirm: {} })
	})

	test("single hides Cancel, relabels the one button, and it closes without a callback", async () => {
		const wrapper = mount(ConfirmPopup, { props: { show: false }, global: { stubs: STUBS } })
		await open(wrapper, { single: true, title: "Home is full", confirm_text: "Got it" })

		expect(wrapper.find('[data-testid="confirm-cancel"]').exists()).toBe(false)
		const submit = wrapper.find('[data-testid="confirm-submit"]')
		expect(submit.text()).toBe("Got it")
		expect(submit.attributes("disabled")).toBeUndefined()

		await submit.trigger("click")
		expect(wrapper.emitted("onClose")).toHaveLength(1)
	})

	test("a plain confirm keeps Cancel and runs the callback", async () => {
		const callback = vi.fn()
		const wrapper = mount(ConfirmPopup, { props: { show: false }, global: { stubs: STUBS } })
		await open(wrapper, { callback })

		expect(wrapper.find('[data-testid="confirm-cancel"]').exists()).toBe(true)
		await wrapper.find('[data-testid="confirm-submit"]').trigger("click")
		expect(callback).toHaveBeenCalledTimes(1)
		expect(wrapper.emitted("onClose")).toHaveLength(1)
	})

	test("the single flag clears on close: a destructive confirm afterwards has Cancel, the colour and the text gate", async () => {
		const wrapper = mount(ConfirmPopup, { props: { show: false }, global: { stubs: STUBS } })
		await open(wrapper, { single: true, confirm_text: "Got it" })
		await wrapper.setProps({ show: false })
		await nextTick()
		expect(H.store.current.confirm).toEqual({})

		const callback = vi.fn()
		await open(wrapper, { confirm_color: "red", confirmation_text: "DELETE", confirm_text: "Delete", callback })
		expect(wrapper.find('[data-testid="confirm-cancel"]').exists()).toBe(true)
		const submit = wrapper.find('[data-testid="confirm-submit"]')
		expect(submit.attributes("data-type")).toBe("red")
		expect(submit.attributes("disabled")).toBeDefined()

		await wrapper.find('[data-testid="confirm-input"]').setValue("DELETE")
		expect(wrapper.find('[data-testid="confirm-submit"]').attributes("disabled")).toBeUndefined()
		await wrapper.find('[data-testid="confirm-submit"]').trigger("click")
		expect(callback).toHaveBeenCalledTimes(1)
	})
})
