import { Tooltip } from "@nulo/design"
import { createTestingPinia } from "@pinia/testing"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { useAppStore } from "@/stores/app.store"
import TokensIndex from "./index.vue"

vi.mock("@/wallet/services/token/client", async () => {
	const { EventHandler } = await import("@nulo/wallet-core/utils")
	return {
		TokenServiceClient: function TokenServiceClient() {
			return {
				getTokens: vi.fn(async () => [{ id: "t", symbol: "TST", name: "Test token" }]),
				onTokenAdded: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				deleteToken: vi.fn(),
				disconnect: vi.fn(),
			}
		},
	}
})

enableAutoUnmount(afterEach)

const NETWORK = { id: "a", chainId: 1 }
const bubble = () => document.querySelector('[data-testid="tooltip-bubble"]')

// The app store reads and watches `chrome.storage.local` when it is created.
beforeEach(() => {
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn((_k: unknown, cb?: (r: Record<string, unknown>) => void) => {
					cb?.({})
					return Promise.resolve({})
				}),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	})
	document.body.innerHTML = '<div id="tooltip"></div>'
})
afterEach(() => {
	document.body.innerHTML = ""
	vi.unstubAllGlobals()
})

function mountPage() {
	const pinia = createTestingPinia({ createSpy: vi.fn })
	const appStore = useAppStore(pinia)
	appStore.profile = { id: "p" } as never
	appStore.network = NETWORK as never
	appStore.networks = [NETWORK, { id: "b", chainId: 2 }] as never
	const wrapper = mount(TokensIndex, {
		attachTo: document.body,
		global: {
			plugins: [pinia],
			components: { Tooltip },
			stubs: {
				SettingsPageShell: { template: "<div><slot /></div>" },
				SettingItem: { template: "<div><slot name='right' /></div>" },
				Flex: { template: "<div><slot /></div>" },
				Icon: { inheritAttrs: false, template: "<i v-bind='$attrs' />" },
				ItemsContainer: { template: "<div><slot /></div>" },
				SectionLabel: true,
				ListStatusMessage: true,
			},
		},
	})
	return { wrapper, appStore }
}

test("the delete icon's tooltip leaves with the icon, and stops taking Escape", async () => {
	const { wrapper, appStore } = mountPage()
	await flushPromises()
	await wrapper.find('[data-testid="token-delete"]').trigger("focusin")
	expect(bubble()).not.toBeNull()

	appStore.networks = [NETWORK] as never
	await flushPromises()
	expect(wrapper.find('[data-testid="token-delete"]').exists()).toBe(false)
	expect(bubble()).toBeNull()
	const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
	document.body.dispatchEvent(esc)
	expect(esc.defaultPrevented).toBe(false)
})
