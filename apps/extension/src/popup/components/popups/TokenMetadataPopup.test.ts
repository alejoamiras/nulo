import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"

const TOKEN = vi.hoisted(() => ({
	id: "tok-1",
	contract: "0xabcdef1234567890",
	name: "Token",
	symbol: "TOK",
	chainId: 1,
	hasPrivateBalances: true,
	hasPrivateTransfers: false,
	hasPrivateToPublicTransfers: true,
	hasPublicBalances: false,
	hasPublicTransfers: true,
	hasPublicToPrivateTransfers: false,
}))
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "tok-1" } }) }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => ({ activeTokenIdx: null }) }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ len: 1, popups: { token_metadata: { order: 1 } } }) }))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ network: { id: "net-1", chainId: 1 } }) }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: class {
		getToken = vi.fn().mockResolvedValue(TOKEN)
		disconnect = vi.fn()
		onTokenAdded = { add: vi.fn(), remove: vi.fn() }
		onTokenUpdated = { add: vi.fn(), remove: vi.fn() }
		onTokenDeleted = { add: vi.fn(), remove: vi.fn() }
	},
}))

import TokenMetadataPopup from "./TokenMetadataPopup.vue"

const stubs = {
	Popup: { props: ["show"], template: `<div v-if="show"><slot /></div>` },
	PopupCard: { template: `<div><slot /></div>` },
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
	Icon: { props: ["name", "color"], template: `<i data-testid="cap-icon" :data-name="name" :data-color="color" />` },
	Button: true,
}

describe("popups/TokenMetadataPopup", () => {
	test("renders the six capability rows in order with their labels, property names and icons", async () => {
		const renderErrors = vi.fn()
		const w = mount(TokenMetadataPopup, { props: { show: false }, global: { stubs, config: { errorHandler: renderErrors } } })
		await w.setProps({ show: true })
		// Nothing renders (and nothing throws) until the token resolves; the popup then opens with the rows.
		expect(w.text()).toBe("")
		await flushPromises()
		expect(renderErrors).not.toHaveBeenCalled()
		const text = w.text()
		for (const key of Object.keys(TOKEN).filter((k) => k.startsWith("has"))) expect(text).toContain(key)
		const keys = [
			"hasPrivateBalances",
			"hasPrivateTransfers",
			"hasPrivateToPublicTransfers",
			"hasPublicBalances",
			"hasPublicTransfers",
			"hasPublicToPrivateTransfers",
		]
		const positions = keys.map((k) => text.indexOf(k))
		expect([...positions].sort((a, b) => a - b)).toEqual(positions)
		expect(text.indexOf("Private Methods")).toBeLessThan(text.indexOf("hasPrivateBalances"))
		expect(text.indexOf("Public Methods")).toBeLessThan(text.indexOf("hasPublicBalances"))
		expect(text.indexOf("Public Methods")).toBeGreaterThan(text.indexOf("hasPrivateToPublicTransfers"))
		const icons = w
			.findAll("[data-testid='cap-icon']")
			.map((i) => [i.attributes("data-name"), i.attributes("data-color")])
			.filter(([name]) => name === "check-circle" || name === "close-circle")
		expect(icons).toEqual(keys.map((k) => (TOKEN[k as keyof typeof TOKEN] ? ["check-circle", "green"] : ["close-circle", "red"])))
		expect(text).toContain("Balances")
		expect(text).toContain("Transfers")
		expect(text).toContain("Private to public")
		expect(text).toContain("Public to private")
	})
})
