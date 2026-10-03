import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { type Ref, reactive, ref } from "vue"
import type { TokenBalanceInfo } from "@/wallet/services/token-balance/client"
import { type TokenBalanceSnapshotState, useTokenBalanceSnapshot } from "./useTokenBalanceSnapshot"

const row = (id: number, chainId = 1, account = "0xa") => ({ id, account, token: { chainId } }) as unknown as TokenBalanceInfo

function held<T>() {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function setup(over: { scopeFence?: () => () => boolean; mapRow?: (r: TokenBalanceInfo) => TokenBalanceInfo } = {}) {
	const listeners = new Set<() => void>()
	const client = {
		getTokenBalances: vi.fn<(id?: number, account?: string) => Promise<TokenBalanceInfo[]>>(),
		onConnected: { add: (fn: () => void) => listeners.add(fn), remove: (fn: () => void) => listeners.delete(fn) },
	}
	const live = reactive({
		account: { address: "0xa" } as { address: string } | null,
		network: { chainId: 1 } as { chainId: number } | null,
	})
	const rows: Ref<TokenBalanceInfo[]> = ref([])
	const state: Ref<TokenBalanceSnapshotState> = ref("loading")
	const snap = useTokenBalanceSnapshot({ client: client as never, live, rows, state, ...over })
	const connect = () => {
		for (const fn of [...listeners]) fn()
	}
	return { client, live, rows, state, snap, connect, listeners }
}

const ids = (rows: Ref<TokenBalanceInfo[]>) => rows.value.map((r) => r.id)

describe("useTokenBalanceSnapshot", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	test("the active chain's rows land through mapRow and the state becomes loaded", async () => {
		const s = setup({ mapRow: (r) => ({ ...r, mapped: true }) as never })
		s.client.getTokenBalances.mockResolvedValue([row(1), row(2, 2)])
		await s.snap.fetchTokenBalances()
		expect(s.client.getTokenBalances).toHaveBeenCalledWith(undefined, "0xa")
		expect(s.rows.value).toEqual([{ ...row(1), mapped: true }])
		expect(s.state.value).toBe("loaded")
	})

	test("no address: no request, and an empty loaded list at once", () => {
		const s = setup()
		s.rows.value = [row(1)]
		s.live.account = null
		void s.snap.fetchTokenBalances()
		expect(s.client.getTokenBalances).not.toHaveBeenCalled()
		expect(s.rows.value).toEqual([])
		expect(s.state.value).toBe("loaded")
	})

	test("only the latest run lands", async () => {
		const s = setup()
		const first = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(first.promise).mockResolvedValueOnce([row(2)])
		const p1 = s.snap.fetchTokenBalances()
		await s.snap.fetchTokenBalances()
		first.resolve([row(1)])
		await p1
		expect(ids(s.rows)).toEqual([2])
	})

	test("a scope fence gone false drops the run on resolve and on reject", async () => {
		let current = true
		const s = setup({ scopeFence: () => () => current })
		const ok = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(ok.promise)
		const p1 = s.snap.fetchTokenBalances()
		current = false
		ok.resolve([row(1)])
		await p1
		expect(s.rows.value).toEqual([])
		expect(s.state.value).toBe("loading")

		current = true
		const bad = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(bad.promise)
		const p2 = s.snap.fetchTokenBalances()
		current = false
		bad.reject(new Error("port closed"))
		await p2
		expect(s.state.value).toBe("loading")
		expect(vi.getTimerCount()).toBe(0)
	})

	test("a run marked dirty in flight refetches instead of landing", async () => {
		const s = setup()
		const first = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(first.promise).mockResolvedValueOnce([row(1), row(2)])
		const p = s.snap.fetchTokenBalances()
		s.snap.markDirty()
		first.resolve([row(1)])
		await p
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)
		expect(ids(s.rows)).toEqual([1, 2])
	})

	test("a first rejection reads unavailable and retries once; the retry's rejection arms none", async () => {
		const s = setup()
		s.client.getTokenBalances.mockRejectedValue(new Error("port closed"))
		await s.snap.fetchTokenBalances()
		expect(s.state.value).toBe("unavailable")
		await vi.advanceTimersByTimeAsync(2_000)
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)
	})

	test("a rejection after a load keeps the rows and the loaded state", async () => {
		const s = setup()
		s.client.getTokenBalances.mockResolvedValueOnce([row(1)]).mockRejectedValue(new Error("port closed"))
		await s.snap.fetchTokenBalances()
		await s.snap.fetchTokenBalances()
		expect(ids(s.rows)).toEqual([1])
		expect(s.state.value).toBe("loaded")
	})

	test("a new run clears the pending retry", async () => {
		const s = setup()
		s.client.getTokenBalances.mockRejectedValueOnce(new Error("port closed")).mockResolvedValue([row(1)])
		await s.snap.fetchTokenBalances()
		await vi.advanceTimersByTimeAsync(1_000)
		await s.snap.fetchTokenBalances()
		await vi.advanceTimersByTimeAsync(5_000)
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)
	})

	test("the first connect is the first request's own; a later one refetches", async () => {
		const s = setup()
		s.client.getTokenBalances.mockResolvedValue([row(1)])
		s.connect()
		expect(s.client.getTokenBalances).not.toHaveBeenCalled()
		s.connect()
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(1)
	})

	test("an update replaces its row by id, scoped or not, and marks a run stale only in scope", async () => {
		const s = setup()
		s.client.getTokenBalances.mockResolvedValue([row(1)])
		await s.snap.fetchTokenBalances()
		const moved = { ...row(1, 1, "0xother"), marker: "moved" } as never
		s.snap.onBalanceUpdated(moved)
		expect(s.rows.value).toEqual([moved])

		const quiet = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(quiet.promise)
		const p1 = s.snap.fetchTokenBalances()
		s.snap.onBalanceUpdated(row(9, 2))
		quiet.resolve([row(1)])
		await p1
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)

		const stale = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(stale.promise)
		const p2 = s.snap.fetchTokenBalances()
		s.snap.onBalanceUpdated(row(9))
		stale.resolve([row(1)])
		await p2
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(4)
	})

	test("dispose drops the run in flight, clears the retry and removes the connect listener", async () => {
		const s = setup()
		s.client.getTokenBalances.mockRejectedValueOnce(new Error("port closed"))
		await s.snap.fetchTokenBalances()
		const late = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(late.promise)
		const p = s.snap.fetchTokenBalances()
		s.snap.dispose()
		late.resolve([row(1)])
		await p
		expect(s.rows.value).toEqual([])
		expect(s.listeners.size).toBe(0)
		await vi.advanceTimersByTimeAsync(5_000)
		expect(s.client.getTokenBalances).toHaveBeenCalledTimes(2)
	})

	test("the chain id is read when the run starts", async () => {
		const s = setup()
		const pending = held<TokenBalanceInfo[]>()
		s.client.getTokenBalances.mockReturnValueOnce(pending.promise)
		const p = s.snap.fetchTokenBalances()
		;(s.live.network as { chainId: number }).chainId = 2
		pending.resolve([row(1), row(2, 2)])
		await p
		expect(ids(s.rows)).toEqual([1])
	})

	test("an answered request lands exactly one microtask after the run starts", async () => {
		const s = setup()
		s.client.getTokenBalances.mockReturnValueOnce(Promise.resolve([row(1)]))
		void s.snap.fetchTokenBalances()
		expect(s.state.value).toBe("loading")
		await Promise.resolve()
		expect(s.state.value).toBe("loaded")
	})
})
