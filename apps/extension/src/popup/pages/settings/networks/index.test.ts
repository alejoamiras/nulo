import { createTestingPinia } from "@pinia/testing"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useAppStore } from "@/stores/app.store"
import NetworksIndex from "./index.vue"

// The app store's setup runs `useSyncedRef` → `chrome.storage.local` on instantiation; stub it.
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

const NETS = [
	{ id: "alpha", name: "Alpha V5", chainId: 4248422646, kind: "mainnet", endpoints: [], primaryEndpointId: "" },
	{ id: "tn", name: "Testnet", chainId: 1816023401, kind: "testnet", endpoints: [], primaryEndpointId: "" },
]

function mountList(activeId: string) {
	const wrapper = mount(NetworksIndex, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			stubs: {
				// SettingItem stub renders `to` (proving the row is a keyboard-activatable link, not a
				// click-only div) + the #right slot (where the active badge lives). $attrs forwards the
				// data-testid/data-network-* fallthrough attributes.
				SettingItem: {
					props: ["to", "title"],
					inheritAttrs: false,
					template: `<a :data-to="to" v-bind="$attrs"><span class="title">{{ title }}</span><slot name="right" /></a>`,
				},
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
				Text: { template: "<span><slot /></span>" },
				MaterialIcon: true,
				SubPageHeader: true,
				SectionLabel: true,
				ItemsContainer: { template: "<div><slot /></div>" },
				Button: true,
			},
		},
	})
	const appStore = useAppStore()
	appStore.networks = NETS as never
	appStore.network = NETS.find((n) => n.id === activeId) as never
	return { wrapper, appStore }
}

describe("Settings › Networks list (item 4 — active badge, keyboard-activatable rows)", () => {
	test("each row is a keyboard-activatable link (`to`) to its detail page, not a click-only div", async () => {
		const { wrapper } = mountList("alpha")
		await nextTick()
		const rows = wrapper.findAll('[data-testid="network-row"]')
		expect(rows).toHaveLength(2)
		const tos = rows.map((r) => r.attributes("data-to"))
		expect(tos).toContain("/popup/settings/networks/alpha")
		expect(tos).toContain("/popup/settings/networks/tn")
	})

	test("the ACTIVE row shows the Active badge; non-active rows don't; testids preserved", async () => {
		const { wrapper } = mountList("alpha")
		await nextTick()
		const badges = wrapper.findAll('[data-testid="network-active-badge"]')
		expect(badges).toHaveLength(1)
		expect(badges[0]?.text()).toContain("Active")

		expect(wrapper.find('[data-network-id="alpha"]').find('[data-testid="network-active-badge"]').exists()).toBe(true)
		expect(wrapper.find('[data-network-id="tn"]').find('[data-testid="network-active-badge"]').exists()).toBe(false)

		// testid stability (e2e selectors depend on these)
		expect(wrapper.find('[data-testid="network-row"][data-network-name="Alpha V5"]').exists()).toBe(true)
		expect(wrapper.find('[data-testid="network-row"][data-network-name="Testnet"]').exists()).toBe(true)
	})

	test("no left radio/circle icon remains (the source of the 'looks selectable' confusion)", async () => {
		const { wrapper } = mountList("tn")
		await nextTick()
		const html = wrapper.html()
		expect(html).not.toContain("check-circle")
		expect(html).not.toContain('name="circle"')
	})
})
