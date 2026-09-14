import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useAppStore } from "@/stores/app.store"
import SettingsPageShell from "@/components/composite/SettingsPageShell.vue"
import NetworkDetail from "./[id].vue"

vi.mock("@/utils/core", () => ({
	managers: { network: { getNetworks: vi.fn(async () => []), setActiveNetwork: vi.fn(), getActiveNetwork: vi.fn() } },
}))
vi.mock("@/composables/useNetworkActivation", () => ({ useNetworkActivation: () => ({ activate: vi.fn(async () => "activated") }) }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "mine" } }), useRouter: () => ({ push: vi.fn(), go: vi.fn() }) }))
// The detail page must never consult Developer Mode: managing a row that already exists is not
// gated, only creating one is. A constructed config client here is a regression.
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: function ConfigServiceClient() {
		throw new Error("the network detail page must not read config")
	},
}))

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
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})
afterEach(() => vi.unstubAllGlobals())

const ALPHA = {
	id: "alpha",
	name: "Alpha V5",
	chainId: 4248422646,
	kind: "mainnet",
	endpoints: [{ id: "a1", rpcUrl: "https://a/" }],
	primaryEndpointId: "a1",
}
const MINE = {
	id: "mine",
	name: "My Chain",
	chainId: 4242,
	kind: "custom",
	endpoints: [
		{ id: "m1", rpcUrl: "https://m1/" },
		{ id: "m2", rpcUrl: "https://m2/", label: "backup" },
	],
	primaryEndpointId: "m1",
}

function mountDetail() {
	const wrapper = mount(NetworkDetail, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { SettingsPageShell },
			stubs: {
				SettingItem: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot name='right' /></div>" },
				Button: { inheritAttrs: false, template: "<button v-bind='$attrs'><slot /></button>" },
				Icon: { inheritAttrs: false, template: "<i v-bind='$attrs' />" },
				Tooltip: { template: "<span><slot /></span>" },
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
				Text: { template: "<span><slot /></span>" },
				SubPageHeader: true,
				SectionLabel: true,
				ItemsContainer: { template: "<div><slot /></div>" },
			},
		},
	})
	const appStore = useAppStore()
	appStore.networks = [ALPHA, MINE] as never
	appStore.network = ALPHA as never
	return wrapper
}

describe("Settings › Network detail — an existing custom row is fully manageable without Developer Mode", () => {
	test("rename, endpoint add/edit/delete and chain deletion all render for a non-active custom network", async () => {
		const wrapper = mountDetail()
		await flushPromises()
		expect(wrapper.find('[data-testid="network-detail-rename"]').exists()).toBe(true)
		expect(wrapper.find('[data-testid="endpoint-add-btn"]').exists()).toBe(true)
		expect(wrapper.findAll('[data-testid="endpoint-row"]')).toHaveLength(2)
		expect(wrapper.findAll('[data-testid="endpoint-edit-btn"]')).toHaveLength(2)
		// Only the non-primary endpoint can be deleted while two exist.
		expect(wrapper.findAll('[data-testid="endpoint-delete-btn"]')).toHaveLength(1)
		expect(wrapper.find('[data-testid="network-delete-chain-btn"]').exists()).toBe(true)
	})
})
