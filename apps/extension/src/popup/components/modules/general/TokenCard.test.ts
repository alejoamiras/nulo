import { describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import TokenCard from "./TokenCard.vue"

// TokenCard imports useAppStore but never reads from it. The store body calls
// syncedRef which touches chrome.storage.local — not stubbed in vitest.setup.ts.
// Bypass by stubbing the module entirely.
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({}),
}))

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Spinner: { template: '<i data-testid="stub-spinner" />' },
	RouterLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
}

const tokenInfo = {
	id: 1,
	chainId: 1,
	contract: "0x1234",
	name: "Test Token",
	symbol: "TST",
	decimals: 18,
}

const factory = (overrides: Record<string, unknown> = {}) => {
	const tokenBalance = {
		id: 42,
		token: tokenInfo,
		account: "0xacct",
		publicBalance: "0",
		privateBalance: "0",
		updatedAt: 0,
		isUpdating: false,
		isMinting: false,
		...overrides,
	}
	return mount(TokenCard, {
		props: { tokenBalance } as never,
		global: { stubs: STUBS },
	})
}

describe("TokenCard", () => {
	test("updatedAt===0 renders the loading block (spinner + 'Loading balance…')", () => {
		const w = factory()
		const loader = w.find('[data-testid="token-balance-loading"]')
		expect(loader.exists()).toBe(true)
		expect(loader.find('[data-testid="stub-spinner"]').exists()).toBe(true)
		expect(loader.text()).toContain("Loading balance")
		// And the misleading "0" amount column must not be rendered
		expect(w.text()).not.toMatch(/^0$/m)
	})

	test("updatedAt>0 with zero balances renders genuine '0' (not the loader)", () => {
		const w = factory({ updatedAt: 1, publicBalance: "0", privateBalance: "0" })
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		expect(w.text()).toContain("0")
	})

	test("isUpdating after first sync keeps the real amount visible (no loader)", () => {
		const w = factory({
			updatedAt: 1700_000_000_000,
			publicBalance: "5000000000000000000",
			privateBalance: "0",
			isUpdating: true,
		})
		expect(w.find('[data-testid="token-balance-loading"]').exists()).toBe(false)
		// Total = 5 TST (decimals 18) — formatter renders as "5"
		expect(w.text()).toContain("5")
	})
})
