/**
 * The Holdings page owns the service graph and hands rows to TokenList. Mounted to prove the one
 * thing no network test exercises: a same-address balance row from ANOTHER chain is neither
 * listed nor counted in the summary (the balance service returns every chain's rows).
 */
import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { afterEach, describe, expect, test, vi } from "vitest"

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
let seedRows: unknown[] = []
let fetchError: Error | undefined
const balanceEvents = { added: new EventHandler(), updated: new EventHandler(), deleted: new EventHandler(), connected: new EventHandler() }

vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenBalanceAdded: balanceEvents.added,
			onTokenBalanceUpdated: balanceEvents.updated,
			onTokenBalanceDeleted: balanceEvents.deleted,
			onConnected: balanceEvents.connected,
			getTokenBalances: vi.fn().mockImplementation(async () => {
				if (fetchError) throw fetchError
				return seedRows
			}),
		}
	}),
}))
let mockQuotes: Record<string, unknown> = {}
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: new EventHandler(),
			onConnected: new EventHandler(),
			refreshIfStale: vi.fn().mockImplementation(async () => mockQuotes),
		}
	}),
}))
const configEvents = { update: new EventHandler(), connected: new EventHandler() }
let configValues: Record<string, unknown> = { showFiatValues: true, incomingDustUsdThreshold: 0 }
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onUpdate: configEvents.update,
			onConnected: configEvents.connected,
			getValue: vi.fn().mockImplementation(async (key: string) => configValues[key]),
		}
	}),
}))

import { CHAIN_IDS } from "@/utils/chain-ids"
import { useAppStore } from "@/stores/app.store"
import Holdings from "./holdings.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Spinner: { template: '<i data-testid="stub-spinner" />' },
	RouterLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: "<span />", props: ["name", "size", "color"] },
	Tooltip: { template: "<span><slot /></span>", props: ["side", "position", "delay"] },
	LoadingState: { template: '<div data-testid="stub-loading">{{ label }}</div>', props: ["label"] },
}

const row = (id: string, symbol: string, chainId: number, contract = `0x${symbol.toLowerCase()}`) => ({
	id,
	account: "0xacct",
	token: { id, symbol, name: `${symbol} Token`, decimals: 6, chainId, contract },
	publicBalance: (250n * 10n ** 6n).toString(),
	privateBalance: (1_000n * 10n ** 6n).toString(),
	updatedAt: 1,
})

async function mountPage() {
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	appStore.isLogined = true
	appStore.profile = { id: "p1" } as never
	appStore.network = { id: "n1", chainId: CHAIN_IDS.MAINNET } as never
	appStore.account = { address: "0xacct" } as never
	const wrapper = mount(Holdings, { global: { plugins: [pinia], stubs: STUBS } })
	await flushPromises()
	return wrapper
}

// The shared chrome stub leaves chrome.storage.local undefined; the real app store touches it.
function installStorage() {
	const backing: Record<string, unknown> = {}
	const g = globalThis as unknown as { chrome: Record<string, unknown> }
	g.chrome = {
		...g.chrome,
		storage: {
			local: {
				get: async (keys: string | string[]) => {
					const out: Record<string, unknown> = {}
					for (const k of Array.isArray(keys) ? keys : [keys]) if (k in backing) out[k] = backing[k]
					return out
				},
				set: async (items: Record<string, unknown>) => {
					Object.assign(backing, items)
				},
				remove: async () => {},
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	}
}

afterEach(() => {
	seedRows = []
	fetchError = undefined
	mockQuotes = {}
	configValues = { showFiatValues: true, incomingDustUsdThreshold: 0 }
	vi.clearAllMocks()
})

describe("holdings page", () => {
	test("lists the active chain's rows, counts them, and skips a same-address row from another chain", async () => {
		installStorage()
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		seedRows = [
			row("b1", "AAA", CHAIN_IDS.MAINNET, CUSD),
			row("b2", "BBB", CHAIN_IDS.MAINNET),
			row("b-foreign", "FOR", CHAIN_IDS.TESTNET),
		]
		const w = await mountPage()

		const symbols = w.findAll('[data-testid="token-symbol"]').map((s) => s.attributes("data-symbol"))
		expect(symbols).toEqual(["AAA", "BBB"])
		const summary = w.find('[data-testid="holdings-summary"]').text()
		expect(summary).toContain("$1,250.00")
		expect(summary).toContain("2 tokens")
		expect(summary).toContain("priced assets only") // BBB is unpriced
	})

	test("a live add for another chain is ignored; one for this chain lands", async () => {
		installStorage()
		seedRows = [row("b1", "AAA", CHAIN_IDS.MAINNET)]
		const w = await mountPage()

		balanceEvents.added.invoke(row("b9", "FOR", CHAIN_IDS.TESTNET))
		balanceEvents.added.invoke(row("b2", "BBB", CHAIN_IDS.MAINNET))
		await flushPromises()

		const symbols = w.findAll('[data-testid="token-symbol"]').map((s) => s.attributes("data-symbol"))
		expect(symbols).toEqual(["AAA", "BBB"])
	})

	test("a reconnect rereads the config: a fiat switch flipped while detached takes effect", async () => {
		installStorage()
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		seedRows = [row("b1", "AAA", CHAIN_IDS.MAINNET, CUSD)]
		const w = await mountPage()
		expect(w.find('[data-testid="holdings-summary"]').text()).toContain("$")

		configValues = { showFiatValues: false, incomingDustUsdThreshold: 0 }
		configEvents.connected.invoke(undefined as never)
		await flushPromises()
		expect(w.find('[data-testid="holdings-summary"]').text()).not.toContain("$")
	})

	test("rejected config reads keep the defaults and never surface as an error", async () => {
		installStorage()
		seedRows = [row("b1", "AAA", CHAIN_IDS.MAINNET)]
		configValues = new Proxy({}, { get: () => Promise.reject(new Error("port closed")) })
		const w = await mountPage()

		expect(w.find('[data-testid="holdings-error"]').exists()).toBe(false)
		expect(w.findAll('[data-testid="token-symbol"]')).toHaveLength(1)
		expect(w.find('[data-testid="holdings-summary"]').text()).toContain("1 tokens")
	})

	test("a failed fetch shows the error line, not an empty list", async () => {
		installStorage()
		fetchError = new Error("port closed")
		const w = await mountPage()

		expect(w.find('[data-testid="holdings-error"]').exists()).toBe(true)
		expect(w.find('[data-testid="holdings-search"]').exists()).toBe(false)
	})
})
