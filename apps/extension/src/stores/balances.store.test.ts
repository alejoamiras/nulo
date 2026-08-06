/**
 * Pins for the balances store — every case the plan's audits mandated
 * (implementations-plan/balance-fpc-cache/plan.md, testing directive).
 * Mocks live at the CLIENT layer against the REAL store; never stubbed
 * store actions.
 */
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getGasBalances: vi.fn(),
	peekGasBalances: vi.fn(),
	getFpcs: vi.fn(),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getGasBalances: mocks.getGasBalances,
			peekGasBalances: mocks.peekGasBalances,
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getFpcs: mocks.getFpcs }
	}),
}))
const txAdd = vi.hoisted(() => vi.fn())
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionUpdated: { add: txAdd, remove: vi.fn() },
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
// The real app.store drags chrome.storage into a plain store test; the
// balances store only watches `profile` — a reactive stand-in suffices.
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({ profile: undefined as { id: string; name: string } | undefined })
	return { useAppStore: () => fake }
})

import { TxStatus } from "@/wallet/services/transaction/spec"
import { EnsureSuperseded, INIT_FETCH_TIMEOUT_MS, INIT_RETRY_BACKOFF_MS, useBalancesStore, withTimeout } from "./balances.store"

const SCOPE_A = { profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xacct" }
const SCOPE_A2 = { profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xother" }

const BAL = { publicFeeJuice: "1000", privateFeeJuice: null }
const CAPS_FEE = { legs: ["gas", "fpc"] as ("gas" | "fpc")[], retry: true, txRefresh: false, peek: false }
const CAPS_CARD = { legs: ["gas"] as ("gas" | "fpc")[], retry: false, txRefresh: true, peek: true }

function settledTx(account: string) {
	return { account, status: TxStatus.Proven }
}

beforeEach(() => {
	setActivePinia(createPinia())
	mocks.getGasBalances.mockReset().mockResolvedValue(BAL)
	mocks.peekGasBalances.mockReset().mockResolvedValue(null)
	mocks.getFpcs.mockReset().mockResolvedValue([])
	txAdd.mockClear()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("balances store — fetch pipeline", () => {
	it("ensure resolves verified data for the requested legs (ready path)", async () => {
		const store = useBalancesStore()
		const snap = await store.ensure(SCOPE_A, { legs: ["gas", "fpc"] })
		expect(snap.gas.verified).toEqual(BAL)
		expect(snap.fpc.data).toEqual([])
		expect(snap.degraded).toBe(false)
	})

	it("display/verified split: a failed refresh keeps display, clears verified", async () => {
		const store = useBalancesStore()
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		mocks.getGasBalances.mockRejectedValue(new Error("down"))
		const snap = await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(snap.gas.verified).toBeUndefined()
		expect(snap.degraded).toBe(true)
		const entry = store.entry(SCOPE_A)
		expect(entry?.gas.display).toEqual(BAL) // SWR retained for rendering
		expect(entry?.gas.status).toBe("degraded")
	})

	it("per-leg isolation: an fpc failure never discards a good gas result", async () => {
		const store = useBalancesStore()
		mocks.getFpcs.mockRejectedValue(new Error("fpc down"))
		const snap = await store.ensure(SCOPE_A, { legs: ["gas", "fpc"] })
		expect(snap.gas.verified).toEqual(BAL)
		expect(snap.degraded).toBe(true)
	})

	it("alternating legs: a later fpc failure keeps the last-good list (same key)", async () => {
		const store = useBalancesStore()
		mocks.getFpcs.mockResolvedValueOnce([{ id: "s1", type: 1 }])
		await store.ensure(SCOPE_A, { legs: ["fpc"] })
		mocks.getFpcs.mockRejectedValue(new Error("down"))
		await store.ensure(SCOPE_A, { legs: ["fpc"] })
		expect(store.entry(SCOPE_A)?.fpc.data).toEqual([{ id: "s1", type: 1 }])
		expect(store.entry(SCOPE_A)?.fpc.status).toBe("degraded")
	})
})

describe("balances store — raw-request reuse (timeout survivors)", () => {
	it("a hung RPC is reused across attempts: exactly one client call across a retry-after-timeout", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		mocks.getGasBalances.mockImplementation(() => new Promise(() => {}))
		mocks.getFpcs.mockResolvedValue([])
		const first = store.ensure(SCOPE_A, { legs: ["gas"] })
		await vi.advanceTimersByTimeAsync(INIT_FETCH_TIMEOUT_MS + 10)
		const snap = await first
		expect(snap.degraded).toBe(true)
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(1)
		// The scheduled retry re-attaches to the SAME raw flight.
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0] + INIT_FETCH_TIMEOUT_MS + 10)
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(1)
		sub.release()
	})

	it("a forced refresh never joins a pre-trigger raw flight — it waits it out and re-enters", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		let resolveFirst!: (v: unknown) => void
		mocks.getGasBalances
			.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
			.mockResolvedValue({ publicFeeJuice: "2000", privateFeeJuice: null })
		const pending = store.ensure(SCOPE_A, { legs: ["gas"] })
		await vi.advanceTimersByTimeAsync(5)
		const forced = store.ensure(SCOPE_A, { legs: ["gas"], forceRefresh: true })
		await vi.advanceTimersByTimeAsync(5)
		resolveFirst(BAL)
		await vi.advanceTimersByTimeAsync(50)
		const snap = await forced
		await pending.catch(() => {})
		expect(snap.gas.verified).toEqual({ publicFeeJuice: "2000", privateFeeJuice: null })
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(2)
	})
})

describe("balances store — profile epoch fence", () => {
	it("A→B→A: a fetch that started pre-switch never commits, ensure rejects EnsureSuperseded", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		let resolveA!: (v: unknown) => void
		mocks.getGasBalances.mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
		const pendingA = store.ensure(SCOPE_A, { legs: ["gas"] })
		// Attach the expectation BEFORE the rejection can settle (fake timers
		// would otherwise flag an unhandled rejection mid-advance).
		const expectation = expect(pendingA).rejects.toBeInstanceOf(EnsureSuperseded)
		await vi.advanceTimersByTimeAsync(5)

		store.invalidateProfile("p1") // the sync app-shell fence

		resolveA({ publicFeeJuice: "666", privateFeeJuice: null })
		await vi.advanceTimersByTimeAsync(20)
		await expectation
		// No stale commit under the old key.
		expect(store.entry(SCOPE_A)?.gas.verified).toBeUndefined()
	})

	it("cross-epoch raw flights are never reused: a post-switch ensure issues a fresh RPC", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		mocks.getGasBalances.mockImplementationOnce(() => new Promise(() => {}))
		const before = store.ensure(SCOPE_A, { legs: ["gas"] }).catch(() => {}) // handled at creation
		await vi.advanceTimersByTimeAsync(5)
		store.invalidateProfile("p1")
		mocks.getGasBalances.mockResolvedValue(BAL)
		const after = await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(after.gas.verified).toEqual(BAL)
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(2) // fresh flight, no reuse
		await vi.advanceTimersByTimeAsync(INIT_FETCH_TIMEOUT_MS + 10)
		await before
	})

	it("releasing the last subscriber of a profile fences it (suspenders)", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(store.entry(SCOPE_A)?.gas.verified).toEqual(BAL)
		sub.release()
		expect(store.entry(SCOPE_A)).toBeUndefined() // entries cleared with the profile
	})
})

describe("balances store — subscriber capabilities drive traffic", () => {
	it("card caps (gas-only, no retry, peek): peek fires, fpc never fetched, no backoff retry", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		mocks.peekGasBalances.mockResolvedValue({ balances: BAL, stale: true })
		mocks.getGasBalances.mockRejectedValue(new Error("down"))
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		await vi.advanceTimersByTimeAsync(5)
		expect(mocks.peekGasBalances).toHaveBeenCalledTimes(1)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		const calls = mocks.getGasBalances.mock.calls.length
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS.at(-1)! * 3)
		expect(mocks.getGasBalances.mock.calls.length).toBe(calls) // no retry-capable sub → no loop
		expect(mocks.getFpcs).not.toHaveBeenCalled()
		sub.release()
	})

	it("fee caps (no peek): subscribing never issues a peek RPC", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		await new Promise((r) => setTimeout(r, 5))
		expect(mocks.peekGasBalances).not.toHaveBeenCalled()
		sub.release()
	})

	it("a late peek never overwrites a newer fetch commit (version-guarded)", async () => {
		const store = useBalancesStore()
		let resolvePeek!: (v: unknown) => void
		mocks.peekGasBalances.mockImplementation(() => new Promise((r) => (resolvePeek = r)))
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		// A real fetch commits FIRST...
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		// ...then the late peek lands and must NOT overwrite it.
		resolvePeek({ balances: { publicFeeJuice: "1", privateFeeJuice: null }, stale: true })
		await new Promise((r) => setTimeout(r, 5))
		expect(store.entry(SCOPE_A)?.gas.display).toEqual(BAL)
		expect(store.entry(SCOPE_A)?.stale).toBe(false)
		sub.release()
	})

	it("retry loop dies on the 1→0 retry-capable transition (release)", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		mocks.getGasBalances.mockRejectedValue(new Error("down"))
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		const calls = mocks.getGasBalances.mock.calls.length
		sub.release()
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS.at(-1)! * 3)
		expect(mocks.getGasBalances.mock.calls.length).toBe(calls)
	})

	it("retry recovers and bumps retryVersion, clearing retryDebt", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		mocks.getGasBalances.mockRejectedValueOnce(new Error("down")).mockResolvedValue(BAL)
		mocks.getFpcs.mockResolvedValue([])
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true)
		const rvBefore = store.entry(SCOPE_A)?.gas.retryVersion ?? 0
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0] + 50)
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.retryVersion).toBe(rvBefore + 1)
		sub.release()
	})

	it("an ensure-path success does not clear retry debt — the loop runs to its retry success (D11)", async () => {
		vi.useFakeTimers()
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		mocks.getGasBalances.mockRejectedValueOnce(new Error("down")).mockResolvedValue(BAL)
		mocks.getFpcs.mockResolvedValue([])
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true)
		// A same-identity refresh lands fresh data mid-backoff...
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		// ...debt survives — only a retry-path success clears it...
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true)
		const rv = store.entry(SCOPE_A)!.gas.retryVersion
		// ...and the armed loop finishes its cycle: the retry success clears
		// the debt AND bumps retryVersion (the degraded card's wake signal).
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0] + 50)
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.retryVersion).toBe(rv + 1)
		sub.release()
	})
})

describe("balances store — tx-settle forced refresh + cause-specific signals", () => {
	function fireSettled(account: string) {
		const handler = txAdd.mock.calls[0]?.[0] as (tx: unknown) => void
		handler(settledTx(account))
	}

	it("a settled tx force-refreshes ONLY keys with a txRefresh-capable subscriber, bumping forcedVersion never retryVersion", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		const before = store.entry(SCOPE_A)!
		mocks.getGasBalances.mockResolvedValue({ publicFeeJuice: "900", privateFeeJuice: null })
		fireSettled("0xacct")
		await new Promise((r) => setTimeout(r, 10))
		const after = store.entry(SCOPE_A)!
		expect(after.gas.display).toEqual({ publicFeeJuice: "900", privateFeeJuice: null })
		expect(after.gas.forcedVersion).toBe(before.gas.forcedVersion + 1)
		expect(after.gas.retryVersion).toBe(before.gas.retryVersion)
		sub.release()
	})

	it("no txRefresh-capable subscriber → a settled tx triggers nothing", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		const calls = mocks.getGasBalances.mock.calls.length
		fireSettled("0xacct")
		await new Promise((r) => setTimeout(r, 10))
		expect(mocks.getGasBalances.mock.calls.length).toBe(calls)
		sub.release()
	})

	it("coexistence: a successful forced refresh neither clears retryDebt nor bumps retryVersion (degraded card keeps its own recovery)", async () => {
		const store = useBalancesStore()
		const subFee = store.subscribe(SCOPE_A, CAPS_FEE)
		const subCard = store.subscribe(SCOPE_A, CAPS_CARD)
		mocks.getGasBalances.mockRejectedValueOnce(new Error("down")).mockResolvedValue(BAL)
		mocks.getFpcs.mockResolvedValue([])
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true)
		const rv = store.entry(SCOPE_A)!.gas.retryVersion
		fireSettled("0xacct")
		await new Promise((r) => setTimeout(r, 10))
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true) // only a retry-path success clears it
		expect(store.entry(SCOPE_A)?.gas.retryVersion).toBe(rv)
		subFee.release()
		subCard.release()
	})

	it("a tx-refresh FAILURE creates no retry debt", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		mocks.getGasBalances.mockRejectedValue(new Error("down"))
		fireSettled("0xacct")
		await new Promise((r) => setTimeout(r, 10))
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.display).toEqual(BAL) // SWR retained
		sub.release()
	})

	it("an ensure joining a failing forced flight takes on the debt and arms the retry", async () => {
		// The forced failure itself creates no debt (D11) — but the OBSERVING
		// ensure has a retry-capable stake. Without observer-side debt, the
		// degraded card would paint its retrying notice while no loop runs and
		// retryVersion never bumps to wake its recovery watch.
		vi.useFakeTimers()
		const store = useBalancesStore()
		const subFee = store.subscribe(SCOPE_A, CAPS_FEE)
		const subCard = store.subscribe(SCOPE_A, CAPS_CARD)
		mocks.getFpcs.mockResolvedValue([])
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		let rejectRaw!: (e: unknown) => void
		mocks.getGasBalances.mockImplementationOnce(() => new Promise((_r, rej) => (rejectRaw = rej))).mockResolvedValue(BAL)
		fireSettled("0xacct")
		await vi.advanceTimersByTimeAsync(0)
		const joined = store.ensure(SCOPE_A, { legs: ["gas"] })
		rejectRaw(new Error("down"))
		const snap = await joined
		expect(snap.degraded).toBe(true)
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(true)
		const rv = store.entry(SCOPE_A)!.gas.retryVersion
		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0] + 50)
		expect(store.entry(SCOPE_A)?.gas.retryDebt).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.retryVersion).toBe(rv + 1)
		subFee.release()
		subCard.release()
	})

	it("a forced run overtaken by a NEWER settle neither un-dims nor signals the overlay reset", async () => {
		// Settle S1's forced run F1 is still in flight when settle S2 lands:
		// F1's data pre-dates S2, so F1's success must not clear S2's
		// stale-mark or bump forcedVersion — S2's own run F2 does both.
		vi.useFakeTimers()
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		let resolveF1!: (v: unknown) => void
		let resolveF2!: (v: unknown) => void
		mocks.getGasBalances
			.mockImplementationOnce(() => new Promise((r) => (resolveF1 = r)))
			.mockImplementationOnce(() => new Promise((r) => (resolveF2 = r)))
		fireSettled("0xacct")
		await vi.advanceTimersByTimeAsync(0)
		fireSettled("0xacct")
		await vi.advanceTimersByTimeAsync(0)
		const fvBefore = store.entry(SCOPE_A)!.gas.forcedVersion
		resolveF1(BAL)
		await vi.advanceTimersByTimeAsync(0)
		expect(store.entry(SCOPE_A)?.stale).toBe(true)
		expect(store.entry(SCOPE_A)?.gas.forcedVersion).toBe(fvBefore)
		resolveF2({ publicFeeJuice: "900", privateFeeJuice: null })
		await vi.advanceTimersByTimeAsync(10)
		expect(store.entry(SCOPE_A)?.stale).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.forcedVersion).toBe(fvBefore + 1)
		sub.release()
	})

	it("a pre-trigger ensure success never clears the forced stale-mark", async () => {
		// The forced stale-mark means "the on-screen value is known-invalidated
		// by a settlement". A refresh that was ALREADY in flight when the
		// settle landed carries pre-settle data — its success commit must not
		// un-dim the card; only the post-trigger fetch's own commit does.
		vi.useFakeTimers()
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_CARD)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		let resolvePre!: (v: unknown) => void
		let resolvePost!: (v: unknown) => void
		mocks.getGasBalances
			.mockImplementationOnce(() => new Promise((r) => (resolvePre = r)))
			.mockImplementationOnce(() => new Promise((r) => (resolvePost = r)))
		const pre = store.ensure(SCOPE_A, { legs: ["gas"] })
		await vi.advanceTimersByTimeAsync(0)
		fireSettled("0xacct")
		await vi.advanceTimersByTimeAsync(0)
		expect(store.entry(SCOPE_A)?.stale).toBe(true)
		resolvePre(BAL)
		await pre
		// Pre-trigger data landed: display refreshed, dim RETAINED.
		expect(store.entry(SCOPE_A)?.stale).toBe(true)
		resolvePost({ publicFeeJuice: "900", privateFeeJuice: null })
		await vi.advanceTimersByTimeAsync(10)
		expect(store.entry(SCOPE_A)?.stale).toBe(false)
		expect(store.entry(SCOPE_A)?.gas.display).toEqual({ publicFeeJuice: "900", privateFeeJuice: null })
		sub.release()
	})
})

describe("balances store — the app-store belt", () => {
	it("an active-profile change fences the departing profile synchronously", async () => {
		const { useAppStore } = await import("@/stores/app.store")
		const appStore = useAppStore()
		appStore.profile = { id: "p1", name: "One" } as never
		const store = useBalancesStore()
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		expect(store.entry(SCOPE_A)?.gas.verified).toEqual(BAL)

		appStore.profile = { id: "p2", name: "Two" } as never
		// flush: "sync" — the entry is gone before ANY async work runs.
		expect(store.entry(SCOPE_A)).toBeUndefined()
	})
})

describe("balances store — LRU", () => {
	it("subscribed keys are never evicted; unsubscribed LRU entries are", async () => {
		const store = useBalancesStore()
		const sub = store.subscribe(SCOPE_A, CAPS_FEE)
		await store.ensure(SCOPE_A, { legs: ["gas"] })
		// Flood with 40 unsubscribed entries on other accounts (same profile).
		for (let i = 0; i < 40; i++) {
			await store.ensure({ ...SCOPE_A2, accountAddress: `0x${i}` }, { legs: ["gas"] })
		}
		expect(store.entry(SCOPE_A)).toBeDefined() // subscribed → exempt
		expect(Object.keys(store.entries).length).toBeLessThanOrEqual(33)
		sub.release()
	})
})

describe("withTimeout", () => {
	it("resolves through when the promise settles first", async () => {
		await expect(withTimeout(Promise.resolve(42), 1_000, "x")).resolves.toBe(42)
	})

	it("rejects through when the promise rejects first", async () => {
		await expect(withTimeout(Promise.reject(new Error("inner")), 1_000, "x")).rejects.toThrow("inner")
	})

	it("rejects with a labeled error once the deadline passes", async () => {
		vi.useFakeTimers()
		const p = withTimeout(new Promise(() => {}), 1_000, "getGasBalances")
		const assertion = expect(p).rejects.toThrow(/getGasBalances timed out/)
		await vi.advanceTimersByTimeAsync(1_000)
		await assertion
	})
})
