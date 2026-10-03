/**
 * EditNetworkPopup opens on a network whose primaryEndpointId names no endpoint: the rename form
 * still fills, and nothing throws.
 */

import { afterEach, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { useFormState } from "@/composables/useFormState"
import { usePopupEntity } from "@/composables/usePopupEntity"

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: vi.fn() }),
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		networks: [
			{
				id: "net-1",
				chainId: 1,
				name: "Local",
				primaryEndpointId: "gone",
				endpoints: [{ id: "ep-1", rpcUrl: "https://one.example" }],
			},
		],
		renameNetwork: vi.fn(),
	}),
}))
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ networkToEditIdx: "net-1" }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { edit_network: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: { props: ["show"], template: "<div><slot /><slot name='belowSubmit' /></div>" },
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: { props: ["title"], template: "<div>{{ title }}</div>" },
	Input: {
		props: ["modelValue", "label"],
		template: `<label><input :data-input-label="label" :value="modelValue" /><slot name="right" /></label>`,
	},
	Button: { template: "<button><slot /></button>" },
	Text: { template: "<span><slot /></span>" },
	Transition: { template: "<div><slot /></div>" },
}

import EditNetworkPopup from "./EditNetworkPopup.vue"

let w: VueWrapper | undefined

afterEach(() => {
	w?.unmount()
	vi.unstubAllGlobals()
})

test("a dangling primaryEndpointId still opens the rename form, filled with the network's name", async () => {
	vi.stubGlobal("useFormState", useFormState)
	vi.stubGlobal("usePopupEntity", usePopupEntity)
	const errors: unknown[] = []
	w = mount(EditNetworkPopup, {
		props: { show: false },
		global: { stubs: STUBS, config: { errorHandler: (err) => errors.push(err) } },
	})
	await w.setProps({ show: true })
	await flushPromises()
	expect(errors).toEqual([])
	expect((w.find('[data-input-label="New name"]').element as HTMLInputElement).value).toBe("Local")
})
