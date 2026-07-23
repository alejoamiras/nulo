import { reactive } from "vue"

/**
 * A `reactive()` stand-in for `useAppStore` for component/composable tests that
 * need the store's identity to CHANGE mid-test — e.g. asserting that the
 * activity feed's `data-active-account` scope marker (and any scoped computed)
 * re-renders when the active account switches.
 *
 * The existing static-object mock (`RecentActivityView.test.ts`) returns a
 * plain frozen shape, so reassigning `account`/`transactions` on it does not
 * trigger Vue reactivity. This factory returns a `reactive` object whose fields
 * can be reassigned and the component re-renders:
 *
 * ```ts
 * const store = createAppStoreHarness()
 * vi.mock("@/stores/app.store", () => ({ useAppStore: () => store }))
 * // ...later, mid-test:
 * store.account = { address: "0xB" }
 * store.transactions = []
 * await nextTick()
 * ```
 *
 * (`vi.mock` is hoisted, so wire the instance in via `vi.hoisted` if you need
 * the reference available to the mock factory.)
 *
 * Intentionally minimal: it carries only the fields the activity feed reads.
 * Extend the interface as new fields are actually consumed by a test — do not
 * mirror the full production store.
 */

export interface HarnessAccount {
	address: string
	name?: string
}

export interface HarnessProfile {
	id: string
}

export interface HarnessNetwork {
	id: string
	chainId: number
}

/** Settled chain-tx row shape the feed reads (`hash`, `account`, `updatedAt`,
 *  and `calls[].contract` for the token-scoped filter). */
export interface HarnessTransaction {
	hash: string
	account: string
	updatedAt: number
	calls?: Array<{ contract: string }>
}

/** Optimistic awaiting-tx row shape the feed reads (`account`, `contract`,
 *  `destination`). */
export interface HarnessAwaitingTransaction {
	account: string
	contract?: string
	destination?: string
}

export interface AppStoreHarness {
	profile: HarnessProfile | null
	network: HarnessNetwork | null
	account: HarnessAccount | null
	accounts: HarnessAccount[]
	transactions: HarnessTransaction[]
	awaitingTransactions: HarnessAwaitingTransaction[]
	isLogined: boolean
}

const DEFAULTS: AppStoreHarness = {
	profile: { id: "p1" },
	network: { id: "net-1", chainId: 1 },
	account: { address: "0xacct" },
	accounts: [],
	transactions: [],
	awaitingTransactions: [],
	isLogined: true,
}

/** Create a reactive appStore harness. Pass `overrides` to seed non-default
 *  fields; every field stays reassignable (and reactive) after creation. */
export function createAppStoreHarness(overrides: Partial<AppStoreHarness> = {}): AppStoreHarness {
	return reactive<AppStoreHarness>({ ...DEFAULTS, ...overrides })
}
