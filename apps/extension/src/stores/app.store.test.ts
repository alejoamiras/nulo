import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Tx } from "@/wallet/services/transaction/spec"
import { useAppStore } from "./app.store"

describe("app.store.onTxAdded — destination resolution via getPrimaryCall", () => {
	beforeEach(() => {
		setActivePinia(createPinia())
		// `tests/vitest.setup.ts` stubs `chrome.storage` as an empty object;
		// app.store's `useSyncedRef("loggerWindowId", null)` calls
		// `chrome.storage.local.get` AND `chrome.storage.onChanged.addListener`
		// at factory-time. Stub both so the store can instantiate.
		// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
		;(chrome.storage as any).local = {
			get: vi.fn((_keys: string[], cb: (result: Record<string, unknown>) => void) => cb({})),
			set: vi.fn((_items: Record<string, unknown>, cb?: () => void) => cb?.()),
		}
		// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
		;(chrome.storage as any).onChanged = {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		}
	})

	// Before this fix: `const call = tx.calls[0]` — if calls[0] is the wallet-
	// injected sponsor_unconditionally fee call, `destination` was derived from
	// the FPC's address rather than the user's intended recipient, so the
	// awaiting-tx placeholder never matched and never cleared. The fix routes
	// through `getPrimaryCall` (which filters FEE_METHODS) so the destination
	// comes from the user's actual transfer call.
	test("dApp + FPC tx with sponsor as calls[0] clears the awaiting placeholder", async () => {
		const store = useAppStore()

		store.awaitingTransactions.push({
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

		store.awaitingTransactions.push({
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

		store.awaitingTransactions.push({
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

		store.awaitingTransactions.push({
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
