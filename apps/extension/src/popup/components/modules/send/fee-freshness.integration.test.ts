/**
 * The freshness guarantee crosses three layers — the gas-balance reader (TTL cache), the balances
 * store (backoff retry) and the pure fee-source rule — and each is pinned alone elsewhere. This drives
 * the REAL reader behind the REAL store and resolves with the REAL rule, faking only the chain read,
 * because the bug this guards against lived in the seam: a layer that was handed a forced read and
 * dropped the force on its recovery path.
 */
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FpcType } from "@/wallet/services/fpc/service"

const bvsMock = vi.hoisted(() => vi.fn())
vi.mock("@/wallet/services/execution/helpers/batched-view-simulation", () => ({ batchedViewSimulation: bvsMock }))

const wiring = vi.hoisted(() => ({ reader: undefined as undefined | { get: (n: string, a: string, f?: boolean) => Promise<unknown> } }))
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getGasBalances: (networkId: string, account: string, force?: boolean) => wiring.reader?.get(networkId, account, force),
			peekGasBalances: vi.fn(),
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/wallet/services/fpc/client")>()),
	FpcServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getFpcs: async () => [PRIVATE_FPC] }
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionUpdated: { add: vi.fn(), remove: vi.fn() },
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({ profile: undefined as { id: string; name: string } | undefined })
	return { useAppStore: () => fake }
})

import { INIT_RETRY_BACKOFF_MS, useBalancesStore } from "@/stores/balances.store"
import { GasBalanceReader } from "@/wallet/services/execution/gas-balance-reader"
import type { RegisteredFpc } from "./fee-helpers"
import { resolveSendSelection } from "./fee-privacy"

const PRIVATE_FPC = {
	id: "p1",
	type: FpcType.PrivateFpc,
	name: "Private FPC",
	address: "0xfpc",
	isProtocol: true,
} as unknown as RegisteredFpc
const SCOPE = { profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xacct" }
const CARD_CAPS = { legs: ["gas", "fpc"] as ("gas" | "fpc")[], retry: true, txRefresh: false, peek: false }

/** The chain as the reader sees it: one figure per leg, changeable between reads. */
const chain = { public: 1000n, private: 0n }
const encoded = (value: bigint) => ({ encoded: [[{ toBigInt: () => value }]], decoded: [] })

describe("Send's fresh read survives a failed forced read", () => {
	let viewDepsFailures = 0

	beforeEach(() => {
		setActivePinia(createPinia())
		vi.useFakeTimers()
		chain.public = 1000n
		chain.private = 0n
		viewDepsFailures = 0
		bvsMock
			.mockReset()
			.mockImplementation(async (calls: { method: string }[]) =>
				encoded(calls[0].method === "balance_of" ? chain.private : chain.public),
			)
		wiring.reader = new GasBalanceReader({
			getChainId: async () => SCOPE.chainId,
			getViewDeps: async () => {
				if (viewDepsFailures > 0) {
					viewDepsFailures -= 1
					throw new Error("pxe not ready")
				}
				return {} as never
			},
			getFpcs: async () => [PRIVATE_FPC] as never,
			logDebug: () => {},
			logError: () => {},
			failedLegRetryDelayMs: 0,
		})
	})
	afterEach(() => vi.useRealTimers())

	test("a cached zero, then private gas arrives, then the forced read fails: recovery still sees the gas", async () => {
		// Home (or any earlier surface) warms the reader's TTL cache with a true zero.
		await wiring.reader?.get(SCOPE.networkId, SCOPE.accountAddress)
		// Private gas lands. Nothing invalidates the cache — the receipt is not this wallet's tx.
		chain.private = 55n

		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE, CARD_CAPS)
		viewDepsFailures = 1
		const first = await store.ensure(SCOPE, { legs: ["gas", "fpc"], forceRefresh: true })
		expect(first.degraded).toBe(true)
		expect(store.entry(SCOPE)?.gas.verified).toBeUndefined()

		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0] + 50)

		const entry = store.entry(SCOPE)
		expect(entry?.gas.verified).toEqual({ publicFeeJuice: "1000", privateFeeJuice: "55" })
		const selection = resolveSendSelection(
			"private",
			{ fpcs: entry?.fpc.data as RegisteredFpc[], balances: entry?.gas.verified, allowSponsored: false },
			undefined,
		)
		expect(selection).toMatchObject({ kind: "selected", method: { type: "private_fpc" } })
		sub.release()
	})

	test("control: with no failure the forced mount read alone sees the gas", async () => {
		await wiring.reader?.get(SCOPE.networkId, SCOPE.accountAddress)
		chain.private = 55n
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE, CARD_CAPS)
		await store.ensure(SCOPE, { legs: ["gas", "fpc"], forceRefresh: true })
		expect(store.entry(SCOPE)?.gas.verified).toEqual({ publicFeeJuice: "1000", privateFeeJuice: "55" })
		sub.release()
	})
})
