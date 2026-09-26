/**
 * BalanceView renders two heroes: the account aggregate on Home (over the active chain's rows
 * only — the balance service returns a shared address's rows from every chain) and a per-token
 * hero when the token page passes `tokenBalance`. Mounted because the aggregate's partial flag and
 * the kill-switch slot are computed-driven and the network suites never exercise a foreign-chain
 * row on a shared address.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { createTestingPinia } from "@pinia/testing"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let deletedHandler: ((tb: unknown) => void) | undefined
let addedHandler: ((tb: unknown) => void) | undefined
let updatedHandler: ((tb: unknown) => void) | undefined
let configHandler: ((prop: { key: string; value: unknown }) => void) | undefined
let connectedHandler: (() => void) | undefined

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
// tok-1 is price-mapped (mainnet cUSD); tok-2 is deliberately unmapped.
const SEED = [
	{
		id: "b1",
		account: "0xacct",
		token: { id: "tok-1", symbol: "AAA", decimals: 6, chainId: CHAIN_IDS.MAINNET, contract: CUSD },
		publicBalance: (250n * 10n ** 6n).toString(),
		privateBalance: (1_000n * 10n ** 6n).toString(),
	},
	{
		id: "b2",
		account: "0xacct",
		token: { id: "tok-2", symbol: "BBB", decimals: 18, chainId: CHAIN_IDS.MAINNET, contract: "0xunmapped" },
		publicBalance: (5n * 10n ** 18n).toString(),
		privateBalance: "0",
	},
]

let seedRows: typeof SEED = SEED
/** Tests that need a fetch to resolve on cue replace this for the duration of the case. */
let fetchRows: (account?: string) => Promise<typeof SEED> = async () => seedRows

vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onConnected: {
				add: vi.fn((fn: () => void) => {
					connectedHandler = fn
				}),
				remove: vi.fn(),
			},
			onTokenBalanceAdded: {
				add: vi.fn((fn: (tb: unknown) => void) => {
					addedHandler = fn
				}),
				remove: vi.fn(),
			},
			onTokenBalanceUpdated: {
				add: vi.fn((fn: (tb: unknown) => void) => {
					updatedHandler = fn
				}),
				remove: vi.fn(),
			},
			onTokenBalanceDeleted: {
				add: vi.fn((fn: (tb: unknown) => void) => {
					deletedHandler = fn
				}),
				remove: vi.fn(),
			},
			getTokenBalances: vi.fn().mockImplementation((_id: unknown, account?: string) => fetchRows(account)),
			refreshTokenBalance: vi.fn(),
		}
	}),
}))

// Controllable fiat kill-switch.
let mockShowFiat = true
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onUpdate: {
				add: vi.fn((fn: (prop: { key: string; value: unknown }) => void) => {
					configHandler = fn
				}),
				remove: vi.fn(),
			},
			getValue: vi.fn().mockImplementation(async () => mockShowFiat),
		}
	}),
}))

// Controllable price feed: tests set `mockQuotes`.
let mockQuotes: Record<string, unknown> = {}
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: { add: vi.fn(), remove: vi.fn() },
			onConnected: { add: vi.fn(), remove: vi.fn() },
			refreshIfStale: vi.fn().mockImplementation(async () => mockQuotes),
		}
	}),
}))

vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }
})

import { CHAIN_IDS } from "@/utils/chain-ids"
import { useAppStore } from "@/stores/app.store"
import BalanceView from "./BalanceView.vue"

const FRESH = () => ({
	"usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: Date.now(), providerUpdatedAt: null },
})

async function mountView(props: Record<string, unknown> = {}) {
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	appStore.profile = { id: "p1" } as never
	appStore.network = { id: "n1", chainId: CHAIN_IDS.MAINNET } as never
	appStore.account = { address: "0xacct" } as never

	const wrapper = mount(BalanceView, {
		props,
		shallow: true,
		global: {
			plugins: [pinia],
			stubs: {
				Icon: { template: '<i data-testid="stub-icon" :data-name="name" />', props: ["name", "size"] },
				Tooltip: {
					template:
						'<div data-testid="stub-tooltip" :data-align="textAlign" :data-delay="delay"><slot /><div data-testid="stub-tooltip-content"><slot name="content" /></div></div>',
					props: ["textAlign", "delay"],
				},
			},
		},
	})
	await flushPromises()
	return { wrapper, appStore }
}

// The shared chrome stub (tests/vitest.setup.ts) leaves chrome.storage.local undefined; the real
// app store (useSyncedRef) touches it. Provide a minimal in-memory backing.
beforeEach(() => {
	const backing: Record<string, unknown> = {}
	const local = {
		get(keys: string | string[] | undefined, cb?: (r: Record<string, unknown>) => void) {
			const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(backing)
			const result: Record<string, unknown> = {}
			for (const k of list) if (k in backing) result[k] = backing[k]
			if (cb) {
				cb(result)
				return undefined
			}
			return Promise.resolve(result)
		},
		set(items: Record<string, unknown>, cb?: () => void) {
			Object.assign(backing, items)
			if (cb) {
				cb()
				return undefined
			}
			return Promise.resolve()
		},
		remove(keys: string | string[], cb?: () => void) {
			for (const k of Array.isArray(keys) ? keys : [keys]) delete backing[k]
			if (cb) {
				cb()
				return undefined
			}
			return Promise.resolve()
		},
	}
	const g = globalThis as unknown as { chrome: Record<string, unknown> }
	g.chrome = {
		...g.chrome,
		storage: { local, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
	}
})

afterEach(() => {
	vi.clearAllMocks()
	deletedHandler = undefined
	addedHandler = undefined
	updatedHandler = undefined
	configHandler = undefined
	connectedHandler = undefined
	mockQuotes = {}
	mockShowFiat = true
	seedRows = SEED
	fetchRows = async () => seedRows
})

describe("BalanceView — Home aggregate", () => {
	test("Home has no balance split and so no icon labels", async () => {
		seedRows = SEED
		mockQuotes = FRESH()
		const { wrapper } = await mountView()
		expect(wrapper.find('[data-testid="private-balance-value"]').exists()).toBe(false)
		expect(wrapper.find('[data-testid="stub-tooltip"]').exists()).toBe(false)
	})

	test("renders the real aggregate over priced tokens with the partial caption", async () => {
		mockQuotes = FRESH()
		const { wrapper } = await mountView()

		// Only tok-1 is priced → aggregate = its fiat value, flagged partial.
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,249.82")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})

	test("no priced tokens → $0.00 with the 'priced assets only' caption, never an em-dash", async () => {
		mockQuotes = {}
		const { wrapper } = await mountView()

		const amount = wrapper.find('[data-testid="balance-amount"]').text()
		expect(amount).toContain("$0.00")
		expect(amount).not.toContain("—")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})

	test("a priced holding + an unpriced ZERO row is NOT partial — zero rows are not holdings", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		seedRows = [
			SEED[0],
			{
				id: "b9",
				account: "0xacct",
				token: { id: "tok-9", symbol: "ZZZ", decimals: 18, chainId: CHAIN_IDS.MAINNET, contract: "0xunmapped9" },
				publicBalance: "0",
				privateBalance: "0",
			},
		]
		const { wrapper } = await mountView()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,250.00")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(false)
	})

	test("fiat OFF → the number slot is GONE (space reclaimed)", async () => {
		mockShowFiat = false
		const { wrapper } = await mountView()

		expect(wrapper.find('[data-testid="balance-amount"]').exists()).toBe(false)
	})

	test("a same-address row from ANOTHER chain is not counted", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		seedRows = [SEED[0], { ...SEED[0], id: "b-foreign", token: { ...SEED[0].token, id: "tok-f", chainId: CHAIN_IDS.TESTNET } }]
		const { wrapper } = await mountView()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,250.00")
	})

	test("a fetch for the previous account that resolves late never overwrites the current one", async () => {
		mockQuotes = FRESH()
		const pending = new Map<string, (rows: typeof SEED) => void>()
		fetchRows = (account?: string) =>
			new Promise((resolve) => {
				pending.set(account ?? "", resolve)
			})
		const { wrapper, appStore } = await mountView()

		appStore.account = { address: "0xother" } as never
		await flushPromises()
		// The new account's rows land first…
		pending.get("0xother")?.([{ ...SEED[1], account: "0xother" }])
		await flushPromises()
		expect(wrapper.find('[data-testid="balance-amount"]').text()).not.toContain("1,249")
		// …then the stale response for the old account arrives and must be dropped.
		pending.get("0xacct")?.(SEED)
		await flushPromises()
		expect(wrapper.find('[data-testid="balance-amount"]').text()).not.toContain("1,249")
	})

	test("while the snapshot is in flight the figure and caption are hidden, not shown as $0.00", async () => {
		mockQuotes = FRESH()
		let resolveFetch: ((rows: typeof SEED) => void) | undefined
		fetchRows = () =>
			new Promise((resolve) => {
				resolveFetch = resolve
			})
		const { wrapper } = await mountView()
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toBe("")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(false)

		resolveFetch?.(SEED)
		await flushPromises()
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,249.82")
		expect(wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(true)
	})

	test("a live add that lands during the fetch outranks the older snapshot: it is refetched, not overwritten", async () => {
		mockQuotes = FRESH()
		let resolveFirst: ((rows: typeof SEED) => void) | undefined
		let calls = 0
		// The first snapshot is empty and slow; a refetch sees the funded state.
		fetchRows = () =>
			calls++ === 0
				? new Promise((resolve) => {
						resolveFirst = resolve
					})
				: Promise.resolve(SEED)
		const { wrapper } = await mountView()

		addedHandler?.(SEED[0])
		resolveFirst?.([])
		await flushPromises()
		expect(calls).toBe(2)
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,249.82")
	})

	test("deleting a row keeps the list consistent (the aggregate drops it)", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const { wrapper } = await mountView()
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,250.00")

		expect(deletedHandler).toBeTypeOf("function")
		deletedHandler?.(SEED[0])
		await flushPromises()

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$0.00")
	})

	test("the mount's own connect is not a reconnect; a port drop mid-fetch resnapshots and the figure lands", async () => {
		mockQuotes = FRESH()
		let rejectFirst: ((e: Error) => void) | undefined
		let calls = 0
		fetchRows = () =>
			calls++ === 0
				? new Promise((_resolve, rej) => {
						rejectFirst = rej
					})
				: Promise.resolve(SEED)
		const { wrapper } = await mountView()
		connectedHandler?.()
		await flushPromises()
		expect(calls).toBe(1)
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toBe("")

		// The client rejects the pending request and reconnects synchronously, before the rejection settles.
		rejectFirst?.(new Error("port closed"))
		connectedHandler?.()
		await flushPromises()
		expect(calls).toBe(2)
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("$1,249.82")
	})
})

describe("BalanceView — Home hero while the total is still moving", () => {
	const CAP_MS = 12_000
	const amount = (w: Awaited<ReturnType<typeof mountView>>["wrapper"]) => w.find('[data-testid="balance-amount"]')
	const isSkeleton = (w: Awaited<ReturnType<typeof mountView>>["wrapper"]) => w.find('[data-testid="balance-hero-loading"]').exists()
	const seedEntry = (status: string) => ({
		chainId: CHAIN_IDS.MAINNET,
		contract: "0xseed",
		symbol: "cUSDC",
		displayName: "Clean USDC",
		status,
	})
	const neverSynced = [{ ...SEED[0], updatedAt: 0 }]

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		mockQuotes = FRESH()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	test("zero rows with a default token still seeding: a skeleton, not $0.00 — the figure lands when it settles", async () => {
		seedRows = []
		const { wrapper } = await mountView({ seedEntries: [seedEntry("seeding")], seedReady: true })
		expect(isSkeleton(wrapper)).toBe(true)
		expect(amount(wrapper).attributes("aria-busy")).toBe("true")
		expect(amount(wrapper).text()).not.toContain("$")

		await wrapper.setProps({ seedEntries: [] })
		expect(isSkeleton(wrapper)).toBe(false)
		expect(amount(wrapper).text()).toContain("$0.00")
	})

	test("a seed-status snapshot that has not loaded holds the figure too", async () => {
		const { wrapper } = await mountView({ seedEntries: [], seedReady: false })
		expect(isSkeleton(wrapper)).toBe(true)
		await wrapper.setProps({ seedReady: true })
		expect(amount(wrapper).text()).toContain("$1,249.82")
	})

	test("a row that has never been projected holds the figure — unless its first projection FAILED", async () => {
		seedRows = neverSynced as never
		const pending = await mountView()
		expect(isSkeleton(pending.wrapper)).toBe(true)
		pending.wrapper.unmount()

		seedRows = [{ ...neverSynced[0], syncFailure: { at: 1, message: "rpc down" } }] as never
		const failed = await mountView()
		expect(isSkeleton(failed.wrapper)).toBe(false)
		expect(amount(failed.wrapper).text()).toContain("$")
	})

	test("a failed or rejected default does not hold the figure: nothing more is coming", async () => {
		const { wrapper } = await mountView({ seedEntries: [seedEntry("failed"), seedEntry("rejected")], seedReady: true })
		expect(isSkeleton(wrapper)).toBe(false)
		expect(amount(wrapper).text()).toContain("$1,249.82")
	})

	test("the 12 s cap releases a still-unsettled total to the aggregate of what IS known", async () => {
		seedRows = [...neverSynced, SEED[1]] as never
		const { wrapper } = await mountView({ seedEntries: [seedEntry("pending")], seedReady: true })
		await vi.advanceTimersByTimeAsync(CAP_MS - 1)
		expect(isSkeleton(wrapper)).toBe(true)
		await vi.advanceTimersByTimeAsync(1)
		expect(isSkeleton(wrapper)).toBe(false)
		expect(amount(wrapper).text()).toContain("$1,249.82")
		expect(amount(wrapper).attributes("aria-busy")).toBeUndefined()
	})

	test("a rejected snapshot BEFORE the cap keeps the skeleton — a retry may still land, and does", async () => {
		let calls = 0
		fetchRows = () => (calls++ === 0 ? Promise.reject(new Error("port closed")) : Promise.resolve(SEED))
		const { wrapper } = await mountView()
		expect(isSkeleton(wrapper)).toBe(true)
		await vi.advanceTimersByTimeAsync(2_000)
		expect(calls).toBe(2)
		expect(amount(wrapper).text()).toContain("$1,249.82")
	})

	test("after the cap a list that could not be read renders —, never $0.00 — rejected or still unanswered", async () => {
		fetchRows = () => Promise.reject(new Error("port closed"))
		const rejected = await mountView()
		await vi.advanceTimersByTimeAsync(CAP_MS)
		expect(rejected.wrapper.find('[data-testid="balance-hero-unknown"]').text()).toBe("—")
		expect(amount(rejected.wrapper).text()).not.toContain("$")
		expect(rejected.wrapper.find('[data-testid="balance-fiat-partial"]').exists()).toBe(false)
		rejected.wrapper.unmount()

		fetchRows = () => new Promise(() => {})
		const unanswered = await mountView()
		await vi.advanceTimersByTimeAsync(CAP_MS)
		expect(unanswered.wrapper.find('[data-testid="balance-hero-unknown"]').text()).toBe("—")
	})

	test("a successfully loaded EMPTY list is a real $0.00, before and after the cap", async () => {
		seedRows = []
		const { wrapper } = await mountView()
		expect(amount(wrapper).text()).toContain("$0.00")
		await vi.advanceTimersByTimeAsync(CAP_MS)
		expect(amount(wrapper).text()).toContain("$0.00")
	})

	test("a scope change restarts the wait: the old total is gone and the new scope gets its own cap", async () => {
		const { wrapper, appStore } = await mountView()
		await vi.advanceTimersByTimeAsync(CAP_MS)
		fetchRows = () => new Promise(() => {})
		appStore.account = { address: "0xother" } as never
		await flushPromises()
		expect(isSkeleton(wrapper)).toBe(true)
		await vi.advanceTimersByTimeAsync(CAP_MS)
		expect(wrapper.find('[data-testid="balance-hero-unknown"]').exists()).toBe(true)
	})

	test("a profile-only switch (same address, same chain) restarts the wait too", async () => {
		const { wrapper, appStore } = await mountView()
		fetchRows = () => new Promise(() => {})
		appStore.profile = { id: "p-other" } as never
		await flushPromises()
		expect(isSkeleton(wrapper)).toBe(true)
	})

	test("a SEEDED default whose balance row has not landed yet holds the figure: that row is about to change it", async () => {
		seedRows = []
		const { wrapper } = await mountView({ seedEntries: [seedEntry("seeded")], seedReady: true })
		expect(isSkeleton(wrapper)).toBe(true)
		await wrapper.setProps({ seedEntries: [] })
		expect(amount(wrapper).text()).toContain("$0.00")
	})

	test("a default still listed as seeding stops holding the figure once its own row has landed", async () => {
		const { wrapper } = await mountView({
			seedEntries: [{ ...seedEntry("seeding"), contract: "0xUNMAPPED" }],
			seedReady: true,
		})
		expect(isSkeleton(wrapper)).toBe(false)
		expect(amount(wrapper).text()).toContain("$1,249.82")
	})

	test("the token page's hero never waits on any of this", async () => {
		const tokenBalance = { ...SEED[0], updatedAt: 0 }
		const { wrapper } = await mountView({ tokenBalance, seedEntries: [seedEntry("seeding")], seedReady: false })
		expect(isSkeleton(wrapper)).toBe(false)
		expect(amount(wrapper).text()).toContain("AAA")
		expect(amount(wrapper).attributes("aria-busy")).toBeUndefined()
	})
})

describe("BalanceView — token hero (tokenBalance prop)", () => {
	test("a malformed row renders dashes for the amount and both sides, no fiat, and never throws", async () => {
		mockQuotes = FRESH()
		const { wrapper } = await mountView({ tokenBalance: { ...SEED[0], publicBalance: "1.5" } })
		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("—")
		expect(wrapper.find('[data-testid="private-balance-value"]').text()).toBe("—")
		expect(wrapper.find('[data-testid="public-balance-value"]').text()).toBe("—")
		expect(wrapper.find('[data-testid="balance-fiat"]').exists()).toBe(false)

		const bad = await mountView({ tokenBalance: { ...SEED[0], token: { ...SEED[0].token, decimals: 500 } } })
		expect(bad.wrapper.find('[data-testid="balance-amount"]').text()).toContain("—")
	})

	test("a priced token shows its amount, the ≈ fiat line and the lock/globe split", async () => {
		mockQuotes = FRESH()
		const { wrapper } = await mountView({ tokenBalance: SEED[0] })

		expect(wrapper.find('[data-testid="balance-amount"]').text()).toContain("AAA")
		expect(wrapper.find('[data-testid="balance-fiat"]').text()).toBe("≈ $1,249.82") // (1,000 + 250) cUSD at $0.999857
		const icons = wrapper.findAll('[data-testid="stub-icon"]')
		expect(icons.map((i) => i.attributes("data-name"))).toEqual(["lock", "globe"])
		expect(wrapper.find('[data-testid="private-balance-value"]').text()).toBe("1,000")
		expect(wrapper.find('[data-testid="public-balance-value"]').text()).toBe("250")
	})

	test("the padlock and the globe carry their labels as tooltip and accessible name, not on the groups", async () => {
		const { wrapper } = await mountView({ tokenBalance: SEED[0] })
		const tooltips = wrapper.findAll('[data-testid="stub-tooltip"]')
		expect(tooltips.map((t) => t.get('[data-testid="stub-tooltip-content"]').text())).toEqual([
			"Private balance: only you can see it",
			"Public balance: anyone can see it",
		])
		expect(tooltips.map((t) => [t.attributes("data-align"), t.attributes("data-delay")])).toEqual([
			["left", "300"],
			["left", "300"],
		])
		const icons = wrapper.findAll('[data-testid="stub-icon"]')
		expect(icons.map((i) => i.attributes("aria-label"))).toEqual([
			"Private balance: only you can see it",
			"Public balance: anyone can see it",
		])
		expect(wrapper.findAll("span[aria-label]")).toHaveLength(0)
	})

	test("an UNPRICED token shows no fiat element at all", async () => {
		mockQuotes = FRESH()
		const { wrapper } = await mountView({ tokenBalance: SEED[1] })

		expect(wrapper.find('[data-testid="balance-fiat"]').exists()).toBe(false)
	})

	test("fiat OFF still shows the token hero (it is a balance, not a fiat figure)", async () => {
		mockShowFiat = false
		const { wrapper } = await mountView({ tokenBalance: SEED[0] })

		expect(wrapper.find('[data-testid="balance-amount"]').exists()).toBe(true)
	})
})

describe("BalanceView — an arrival on Home", () => {
	type Wrapper = Awaited<ReturnType<typeof mountView>>["wrapper"]
	const USD_1 = () => ({ "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } })
	const LARGE = 98_765_432_109_876n * 10n ** 6n
	const row = (privateRaw: bigint) => ({ ...SEED[0], privateBalance: privateRaw.toString(), publicBalance: "0" })
	const status = (w: Wrapper) => w.find('[data-testid="balance-arrival-status"]')
	const chip = (w: Wrapper) => w.find('[data-testid="balance-arrival-chip"]')
	const hero = (w: Wrapper) => w.find('[data-testid="balance-amount"]').text()
	let reducedMotion = false
	/** The hero's text for `rows` with no arrival: the aggregate's own string. */
	async function ownString(rows: unknown[]) {
		seedRows = rows as typeof SEED
		const { wrapper } = await mountView()
		const text = hero(wrapper)
		wrapper.unmount()
		return text
	}
	/** Home with the pre-rise value on screen for a minute. */
	async function settledHome(privateRaw = LARGE) {
		seedRows = [row(privateRaw)] as typeof SEED
		const view = await mountView()
		await vi.advanceTimersByTimeAsync(60_000)
		return view
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] })
		mockQuotes = USD_1()
		reducedMotion = false
		window.matchMedia = vi.fn(() => ({ matches: reducedMotion })) as unknown as typeof window.matchMedia
	})
	afterEach(() => {
		vi.useRealTimers()
		document.documentElement.classList.remove("noanimations")
		Reflect.deleteProperty(window, "matchMedia")
	})

	test("the status node exists and is empty before any arrival; each arrival's chip lands inside that same node", async () => {
		const { wrapper } = await mountView()
		const node = status(wrapper).element
		expect(status(wrapper).text()).toBe("")
		expect(chip(wrapper).exists()).toBe(false)

		await wrapper.setProps({ arrival: { id: "r1", label: "+5 AAA" } })
		expect(status(wrapper).element).toBe(node)
		expect(status(wrapper).find('[data-testid="balance-arrival-chip"]').text()).toBe("+5 AAA")
		const first = chip(wrapper).element

		await wrapper.setProps({ arrival: { id: "r2", label: "+7 AAA" } })
		expect(status(wrapper).element).toBe(node)
		expect(wrapper.findAll('[data-testid="balance-arrival-chip"]')).toHaveLength(1)
		expect(chip(wrapper).element).not.toBe(first)
		expect(chip(wrapper).text()).toBe("+7 AAA")
	})

	test("an arrival with no label (invalid decimals) shows no chip; nor does the token hero or a hidden fiat hero", async () => {
		const unformattable = await mountView({ arrival: { id: "r1", label: null } })
		expect(chip(unformattable.wrapper).exists()).toBe(false)

		const tokenPage = await mountView({ tokenBalance: SEED[0], arrival: { id: "r1", label: "+5 AAA" } })
		expect(chip(tokenPage.wrapper).exists()).toBe(false)

		mockShowFiat = false
		const fiatOff = await mountView({ arrival: { id: "r1", label: "+5 AAA" } })
		expect(chip(fiatOff.wrapper).exists()).toBe(false)
		expect(status(fiatOff.wrapper).exists()).toBe(true)
	})

	test("a rise 3 s after the arrival counts from the value shown a minute before, and ends on the aggregate's own string", async () => {
		const risen = LARGE + 1_234_567n * 10n ** 6n
		const [before, after] = [await ownString([row(LARGE)]), await ownString([row(risen)])]
		const { wrapper } = await settledHome()
		expect(hero(wrapper)).toBe(before)

		await wrapper.setProps({ arrival: { id: "r1", label: "+1,234,567 AAA" } })
		await vi.advanceTimersByTimeAsync(3_000)
		updatedHandler?.(row(risen))
		await flushPromises()
		expect(hero(wrapper)).toBe(before)

		await vi.advanceTimersByTimeAsync(300)
		expect([before, after]).not.toContain(hero(wrapper))
		await vi.advanceTimersByTimeAsync(1_000)
		expect(hero(wrapper)).toBe(after)
	})

	test("a rise 11 s after the arrival, or a fall, lands at once", async () => {
		// Each mount replaces the captured handlers, so the expected strings are read first.
		const [up, down] = [await ownString([row(LARGE + 10n ** 6n)]), await ownString([row(LARGE - 10n ** 6n)])]
		const { wrapper } = await settledHome()
		await wrapper.setProps({ arrival: { id: "r1", label: "+1 AAA" } })
		await vi.advanceTimersByTimeAsync(11_000)
		updatedHandler?.(row(LARGE + 10n ** 6n))
		await flushPromises()
		expect(hero(wrapper)).toBe(up)

		await wrapper.setProps({ arrival: { id: "r2", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE - 10n ** 6n))
		await flushPromises()
		expect(hero(wrapper)).toBe(down)
	})

	test("a scope switch cancels a running count; the new scope's figures, and its rise, owe the old arrival nothing", async () => {
		const [switched, risen] = [await ownString([row(LARGE * 2n)]), await ownString([row(LARGE * 3n)])]
		const { wrapper, appStore } = await settledHome()
		await wrapper.setProps({ arrival: { id: "r1", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE + 10n ** 12n))
		await flushPromises()
		await vi.advanceTimersByTimeAsync(100)

		const other = (raw: bigint) => ({ ...row(raw), account: "0xother" })
		fetchRows = async () => [other(LARGE * 2n)] as typeof SEED
		appStore.account = { address: "0xother" } as never
		await flushPromises()
		expect(hero(wrapper)).toBe(switched)

		updatedHandler?.(other(LARGE * 3n))
		await flushPromises()
		expect(hero(wrapper)).toBe(risen)
	})

	test("with fiat off nothing counts: turning it back on shows the aggregate's own string at once", async () => {
		const [risen, shown] = [await ownString([row(LARGE + 10n ** 12n)]), await ownString([row(LARGE + 2n * 10n ** 12n)])]
		const { wrapper } = await settledHome()
		await wrapper.setProps({ arrival: { id: "r1", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE + 10n ** 12n))
		await flushPromises()
		configHandler?.({ key: "showFiatValues", value: false })
		await flushPromises()
		configHandler?.({ key: "showFiatValues", value: true })
		await flushPromises()
		expect(hero(wrapper)).toBe(risen)

		configHandler?.({ key: "showFiatValues", value: false })
		await flushPromises()
		await wrapper.setProps({ arrival: { id: "r2", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE + 2n * 10n ** 12n))
		await flushPromises()
		configHandler?.({ key: "showFiatValues", value: true })
		await flushPromises()
		expect(hero(wrapper)).toBe(shown)
	})

	test.each([
		["reduced motion", () => (reducedMotion = true)],
		["Disable animations", () => document.documentElement.classList.add("noanimations")],
	])("under %s the hero shows the final value with no frame, and the chip runs the calm animation", async (_, calm) => {
		calm()
		const { wrapper } = await settledHome()
		const frame = vi.spyOn(globalThis, "requestAnimationFrame")
		await wrapper.setProps({ arrival: { id: "r1", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE + 10n ** 12n))
		await flushPromises()
		expect(hero(wrapper)).toBe(await ownString([row(LARGE + 10n ** 12n)]))
		expect(frame).not.toHaveBeenCalled()
		expect(
			chip(wrapper)
				.classes()
				.some((c) => c.includes("arrival_chip_calm")),
		).toBe(true)
	})

	test("unmounting mid-count cancels the frame", async () => {
		const { wrapper } = await settledHome()
		await wrapper.setProps({ arrival: { id: "r1", label: "+1 AAA" } })
		updatedHandler?.(row(LARGE + 10n ** 12n))
		await flushPromises()
		const cancel = vi.spyOn(globalThis, "cancelAnimationFrame")
		wrapper.unmount()
		expect(cancel).toHaveBeenCalledTimes(1)
		expect(vi.getTimerCount()).toBe(0)
	})
})
