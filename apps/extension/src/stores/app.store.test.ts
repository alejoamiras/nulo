import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import type { Tx } from "@/wallet/services/transaction/spec"
import { TxStatus } from "@/wallet/services/transaction/spec"

import { useAppStore } from "./app.store"

// `managers` is auto-imported from `@/utils/core` by the PRODUCTION vite config
// (which scans `src/utils/`); the vitest config only auto-imports vue/vue-router,
// so inside the test the store's `managers` reference resolves as a free global.
// `syncTransactions` is the only consumer, so stubbing the global satisfies it
// and lets us resolve its `getTransactions` await on demand (generation guard).
const getTransactionsMock = vi.fn()

const asAccount = (address: string) => ({ address }) as unknown as Account
const asNetwork = (chainId: number) => ({ chainId }) as unknown as Network

beforeEach(() => {
	setActivePinia(createPinia())
	getTransactionsMock.mockReset()
	vi.stubGlobal("managers", { transaction: { getTransactions: getTransactionsMock } })
	// `tests/vitest.setup.ts` stubs `chrome.storage` as an empty object;
	// app.store's `useSyncedRef("loggerWindowId", null)` reads storage
	// through the migration-aware facade (promise-form `get`) AND registers
	// `chrome.storage.onChanged.addListener` at factory-time. Stub both so
	// the store can instantiate.
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).local = {
		get: vi.fn(async (_keys?: string | string[]) => ({})),
		set: vi.fn(async (_items: Record<string, unknown>) => {}),
	}
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).onChanged = {
		addListener: vi.fn(),
		removeListener: vi.fn(),
	}
})

describe("app.store.onTxAdded — destination resolution via getPrimaryCall", () => {
	// Before this fix: `const call = tx.calls[0]` — if calls[0] is the wallet-
	// injected sponsor_unconditionally fee call, `destination` was derived from
	// the FPC's address rather than the user's intended recipient, so the
	// awaiting-tx placeholder never matched and never cleared. The fix routes
	// through `getPrimaryCall` (which filters FEE_METHODS) so the destination
	// comes from the user's actual transfer call.
	test("dApp + FPC tx with sponsor as calls[0] clears the awaiting placeholder", async () => {
		const store = useAppStore()
		store.account = asAccount("0xaccount")

		store.awaitingTransactions.push({
			id: "await-1",
			account: "0xaccount",
			contract: "0xtoken",
			destination: "0xrecipient",
		})

		const tx = {
			hash: "0xabc",
			account: "0xaccount",
			calls: [
				{ contract: "0xfpc", method: "sponsor_unconditionally", args: [] },
				{
					contract: "0xtoken",
					method: "transfer_in_private",
					args: ["0xsender", "0xrecipient", 100n],
					transfers: [{ to: "0xrecipient", amount: 100n }],
				},
			],
		} as unknown as Tx

		await store.onTxAdded(tx)

		expect(store.awaitingTransactions.length).toBe(0)
		expect(store.transactions[0]?.hash).toBe("0xabc")
	})

	test("transfer-only tx (no FPC) still clears the awaiting placeholder via call.transfers", async () => {
		const store = useAppStore()
		store.account = asAccount("0xaccount")

		store.awaitingTransactions.push({
			id: "await-1",
			account: "0xaccount",
			contract: "0xtoken",
			destination: "0xrecipient",
		})

		const tx = {
			hash: "0xdef",
			account: "0xaccount",
			calls: [
				{
					contract: "0xtoken",
					method: "transfer_in_private",
					args: ["0xsender", "0xrecipient", 100n],
					transfers: [{ to: "0xrecipient", amount: 100n }],
				},
			],
		} as unknown as Tx

		await store.onTxAdded(tx)

		expect(store.awaitingTransactions.length).toBe(0)
	})

	test("tx whose destination doesn't match any awaiting placeholder leaves the list intact", async () => {
		const store = useAppStore()
		store.account = asAccount("0xaccount")

		store.awaitingTransactions.push({
			id: "await-1",
			account: "0xaccount",
			contract: "0xtoken",
			destination: "0xrecipient",
		})

		const tx = {
			hash: "0xdef",
			account: "0xaccount",
			calls: [
				{
					contract: "0xtoken",
					method: "transfer_in_private",
					args: ["0xsender", "0xsomeoneelse", 100n],
					transfers: [{ to: "0xsomeoneelse", amount: 100n }],
				},
			],
		} as unknown as Tx

		await store.onTxAdded(tx)

		// Different destination → no placeholder cleared.
		expect(store.awaitingTransactions.length).toBe(1)
	})

	test("uses args[1] as destination fallback when transfers is empty", async () => {
		const store = useAppStore()
		store.account = asAccount("0xaccount")

		store.awaitingTransactions.push({
			id: "await-1",
			account: "0xaccount",
			contract: "0xtoken",
			destination: "0xrecipient",
		})

		const tx = {
			hash: "0xfoo",
			account: "0xaccount",
			calls: [
				{ contract: "0xfpc", method: "sponsor_unconditionally", args: [] },
				{
					contract: "0xtoken",
					method: "custom_call",
					args: ["0xsender", "0xrecipient", 42n],
				},
			],
		} as unknown as Tx

		await store.onTxAdded(tx)

		expect(store.awaitingTransactions.length).toBe(0)
	})
})

describe("app.store — account-switch containment (Layer A)", () => {
	test("switching accounts synchronously clears transactions and bumps the generation", () => {
		const store = useAppStore()
		store.account = asAccount("0xA")
		const genAfterA = store.activityGeneration

		store.transactions = [{ hash: "0xA-tx", account: "0xA", chainId: 1 } as unknown as Tx]
		store.awaitingTransactions = [{ id: "id-A", account: "0xA", contract: "0xt", destination: "0xr" }]

		store.account = asAccount("0xB")

		// Synchronous relative to the switch — no await, no nextTick.
		expect(store.transactions).toEqual([])
		// A's placeholder is foreign to B → dropped; B keeps its own (none here).
		expect(store.awaitingTransactions).toEqual([])
		expect(store.activityGeneration).toBe(genAfterA + 1)
	})

	test("a rename (same address) does NOT reset the feed or bump the generation", () => {
		const store = useAppStore()
		store.account = asAccount("0xA")
		const gen = store.activityGeneration
		store.transactions = [{ hash: "0xA-tx", account: "0xA", chainId: 1 } as unknown as Tx]

		// New object, SAME address (an account rename).
		store.account = { address: "0xA", name: "Renamed" } as unknown as Account

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xA-tx"])
		expect(store.activityGeneration).toBe(gen)
	})

	test("a late syncTransactions resolving after an A→B switch does NOT overwrite B's transactions (generation guard)", async () => {
		const store = useAppStore()

		let resolveA!: (rows: Tx[]) => void
		const aPending = new Promise<Tx[]>((res) => {
			resolveA = res
		})
		getTransactionsMock.mockReturnValueOnce(aPending)

		store.account = asAccount("0xA")
		store.network = asNetwork(1)

		// Fetch for A starts and captures A's generation, then awaits.
		const syncA = store.syncTransactions()

		// Switch to B before A's fetch resolves; B's own rows land.
		store.account = asAccount("0xB")
		const txB = { hash: "0xB-tx", account: "0xB", chainId: 1, updatedAt: 2 } as unknown as Tx
		store.transactions = [txB]

		// A's late fetch resolves — the generation moved, so it must be discarded.
		resolveA([{ hash: "0xA-tx", account: "0xA", chainId: 1, updatedAt: 1 } as unknown as Tx])
		await syncA

		expect(store.transactions).toEqual([txB])
		expect(store.transactions.find((t) => t.account === "0xA")).toBeUndefined()
	})

	test("syncTransactions filters returned rows to the captured account + chain", async () => {
		const store = useAppStore()
		store.account = asAccount("0xA")
		store.network = asNetwork(1)

		getTransactionsMock.mockResolvedValueOnce([
			{ hash: "0x1", account: "0xA", chainId: 1, updatedAt: 3 },
			{ hash: "0x2", account: "0xA", chainId: 2, updatedAt: 2 }, // wrong chain
			{ hash: "0x3", account: "0xB", chainId: 1, updatedAt: 1 }, // wrong account
		] as unknown as Tx[])

		await store.syncTransactions()

		expect(store.transactions.map((t) => t.hash)).toEqual(["0x1"])
	})

	test("onTxAdded for a foreign account is dropped from the active view (placeholder cleanup still runs)", async () => {
		const store = useAppStore()
		store.account = asAccount("0xA")
		store.network = asNetwork(1)

		await store.onTxAdded({ hash: "0xforeign", account: "0xB", chainId: 1, calls: [] } as unknown as Tx)
		expect(store.transactions.length).toBe(0)

		// A same-scope tx IS surfaced.
		await store.onTxAdded({ hash: "0xmine", account: "0xA", chainId: 1, calls: [] } as unknown as Tx)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xmine"])
	})

	test("onTxAdded drops a same-account tx on a foreign chain from the active view", async () => {
		const store = useAppStore()
		store.account = asAccount("0xA")
		store.network = asNetwork(1)

		await store.onTxAdded({ hash: "0xotherchain", account: "0xA", chainId: 2, calls: [] } as unknown as Tx)

		expect(store.transactions.length).toBe(0)
	})

	test("onTxUpdated with matching hash but different account does NOT touch the active row", () => {
		const store = useAppStore()
		store.account = asAccount("0xA")

		store.transactions = [{ hash: "0xh", account: "0xA", status: TxStatus.Pending, updatedAt: 1 } as unknown as Tx]

		// Foreign account, same hash — must NOT replace (Pinia wraps rows in a
		// reactive proxy, so assert on fields rather than object identity).
		store.onTxUpdated({ hash: "0xh", account: "0xB", status: TxStatus.Proven, updatedAt: 2 } as unknown as Tx)
		expect(store.transactions[0].status).toBe(TxStatus.Pending)
		expect(store.transactions[0].updatedAt).toBe(1)

		// Correct account + hash — replaces.
		store.onTxUpdated({ hash: "0xh", account: "0xA", status: TxStatus.Proven, updatedAt: 3 } as unknown as Tx)
		expect(store.transactions[0].status).toBe(TxStatus.Proven)
		expect(store.transactions[0].updatedAt).toBe(3)
	})

	test("removeAwaitingTransaction removes exactly the placeholder with that id (not by destination/contract)", () => {
		const store = useAppStore()
		store.account = asAccount("0xA")

		// Two placeholders with the SAME destination + contract (two sends to the
		// same recipient) — only the id disambiguates them.
		store.awaitingTransactions = [
			{ id: "id-1", account: "0xA", contract: "0xt", destination: "0xr" },
			{ id: "id-2", account: "0xA", contract: "0xt", destination: "0xr" },
		]

		store.removeAwaitingTransaction("id-1")

		expect(store.awaitingTransactions.map((t) => t.id)).toEqual(["id-2"])
	})

	test("onTxAdded clears a non-active account's placeholder by the tx's own scope", async () => {
		const store = useAppStore()
		// Active account is B; a tx settles for A. A's placeholder was created
		// before the switch and (in this direct test) is still present.
		store.account = asAccount("0xB")
		store.awaitingTransactions = [{ id: "id-A", account: "0xA", contract: "0xtoken", destination: "0xrecipient" }]

		await store.onTxAdded({
			hash: "0xA-tx",
			account: "0xA",
			chainId: 1,
			calls: [
				{
					contract: "0xtoken",
					method: "transfer_in_private",
					args: ["0xsender", "0xrecipient", 5n],
					transfers: [{ to: "0xrecipient", amount: 5n }],
				},
			],
		} as unknown as Tx)

		// Foreign tx is NOT surfaced in B's active view...
		expect(store.transactions.length).toBe(0)
		// ...but A's placeholder is cleared (keyed on tx.account, not active account).
		expect(store.awaitingTransactions.length).toBe(0)
	})
})
