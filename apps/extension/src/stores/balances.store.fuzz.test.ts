/**
 * Randomized interleaving explorer for the balances store (fast-check).
 *
 * The example-based suite pins the interleavings we THOUGHT of; every review
 * round of this store found one nobody wrote down. This test drives the real
 * store with a random operation tape — subscribes/releases with random caps,
 * ensures, tx-settle forced refreshes, profile fences, and crucially a random
 * SETTLEMENT ORDER for every in-flight RPC — and checks machine-wide
 * invariants after every step instead of example outcomes:
 *
 *  A. PROVENANCE: gating-grade `gas.verified` data (and retained `fpc.data`)
 *     always comes from an RPC issued for the entry's own account AND after
 *     the owning profile's most recent fence — a cross-epoch commit is an
 *     instant fail. (Payloads are tagged with a call id; a side table records
 *     each call's account + fence count at issue time.)
 *  B. COHERENCE: `degraded` ⇒ no verified data; `ready` ⇒ verified present.
 *  C. QUIESCENCE: once every RPC has settled and timers are drained, no slice
 *     is stuck `fetching`, no retry debt survives a successful drain, and a
 *     further 70s of virtual time produces ZERO new client calls — orphaned
 *     backoff timers and stranded forced counters both fail here.
 *
 * Failures print fast-check's seed + shrunk counterexample tape; replay by
 * passing `{ seed, path }` to fc.assert. Deepen locally with
 * NULO_FUZZ_RUNS=2000.
 */
import fc from "fast-check"
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
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({ profile: undefined })
	return { useAppStore: () => fake }
})

import { TxStatus } from "@/wallet/services/transaction/spec"
import { type BalanceScope, type SubscribeCaps, useBalancesStore } from "./balances.store"

// Account addresses are PROFILE-UNIQUE so the mock (which only sees RPC args,
// never the profile) can attribute every call to its owning profile.
const SCOPES: BalanceScope[] = [
	{ profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xa1" },
	{ profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xa2" },
	{ profileId: "p2", networkId: "n1", chainId: 111, accountAddress: "0xb1" },
	{ profileId: "p2", networkId: "n1", chainId: 111, accountAddress: "0xb2" },
]
const PROFILE_OF_ACCOUNT = new Map(SCOPES.map((s) => [s.accountAddress, s.profileId]))

interface PendingCall {
	id: number
	kind: "gas" | "fpc" | "peek"
	account?: string
	settle: (ok: boolean) => void
}
interface CallMeta {
	account?: string
	fencesAtCall: number
}

const TIMER_STEPS = [0, 50, 5_000, 20_000]

describe("balances store — randomized interleavings (fuzz)", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("invariants hold under arbitrary operation/settlement schedules", async () => {
		const numRuns = Number(process.env.NULO_FUZZ_RUNS ?? 120)
		await fc.assert(
			fc.asyncProperty(fc.array(fc.nat({ max: 999_983 }), { minLength: 40, maxLength: 120 }), async (tape) => {
				// ── per-run world ────────────────────────────────────────────
				setActivePinia(createPinia())
				const pending: PendingCall[] = []
				const callMeta = new Map<number, CallMeta>()
				const fences: Record<string, number> = { p1: 0, p2: 0 }
				let nextCallId = 1
				let totalCalls = 0

				mocks.getGasBalances.mockReset().mockImplementation(
					(_net: string, account: string) =>
						new Promise((resolve, reject) => {
							const id = nextCallId++
							totalCalls++
							callMeta.set(id, { account, fencesAtCall: fences[PROFILE_OF_ACCOUNT.get(account) ?? "p1"] ?? 0 })
							pending.push({
								id,
								kind: "gas",
								account,
								settle: (ok) =>
									ok
										? resolve({ publicFeeJuice: String(id), privateFeeJuice: null })
										: reject(new Error(`gas ${id} down`)),
							})
						}),
				)
				mocks.getFpcs.mockReset().mockImplementation(
					() =>
						new Promise((resolve, reject) => {
							const id = nextCallId++
							totalCalls++
							// FPC RPCs carry no account; provenance binds via the store
							// key the awaiting fetch commits to (checked against fences
							// through the entry's own profile at observation time).
							callMeta.set(id, { fencesAtCall: Math.max(fences.p1, fences.p2) })
							pending.push({
								id,
								kind: "fpc",
								settle: (ok) =>
									ok ? resolve([{ id: `fpc-${id}`, type: 1, name: "S" }]) : reject(new Error(`fpc ${id} down`)),
							})
						}),
				)
				mocks.peekGasBalances.mockReset().mockImplementation(
					(_net: string, account: string) =>
						new Promise((resolve, reject) => {
							const id = nextCallId++
							totalCalls++
							callMeta.set(id, { account, fencesAtCall: fences[PROFILE_OF_ACCOUNT.get(account) ?? "p1"] ?? 0 })
							pending.push({
								id,
								kind: "peek",
								account,
								settle: (ok) =>
									ok
										? resolve({ balances: { publicFeeJuice: `${id}`, privateFeeJuice: null }, stale: id % 2 === 0 })
										: reject(new Error(`peek ${id}`)),
							})
						}),
				)

				const store = useBalancesStore()
				const subs: Array<{ scope: BalanceScope; caps: SubscribeCaps; release: () => void; released: boolean }> = []
				let txHandler: ((tx: unknown) => void) | undefined

				const liveSubs = () => subs.filter((s) => !s.released)
				const lastOfProfile = (profileId: string, releasing: (typeof subs)[number]) =>
					liveSubs().filter((s) => s.scope.profileId === profileId).length === 1 && releasing.scope.profileId === profileId

				const flush = () => vi.advanceTimersByTimeAsync(0)

				const checkInvariants = () => {
					for (const [key, entry] of Object.entries(store.entries)) {
						const [profileId, , , accountAddress] = JSON.parse(key) as [string, string, number, string]
						// B — coherence.
						if (entry.gas.status === "degraded") {
							expect(entry.gas.verified, `degraded gas slice of ${key} must not carry verified data`).toBeUndefined()
						}
						if (entry.gas.status === "ready") {
							expect(entry.gas.verified, `ready gas slice of ${key} must carry verified data`).toBeDefined()
						}
						// A — provenance of gating-grade data.
						if (entry.gas.verified?.publicFeeJuice != null) {
							const meta = callMeta.get(Number(entry.gas.verified.publicFeeJuice))
							expect(meta, `verified payload of ${key} must come from a tracked RPC`).toBeDefined()
							expect(meta?.account, `verified payload of ${key} fetched for the wrong account`).toBe(accountAddress)
							expect(
								meta?.fencesAtCall,
								`verified payload of ${key} was fetched BEFORE the last fence of ${profileId} — cross-epoch commit`,
							).toBe(fences[profileId])
						}
						if (entry.fpc.data?.[0]) {
							const meta = callMeta.get(Number(String(entry.fpc.data[0].id).replace("fpc-", "")))
							expect(meta, `fpc data of ${key} must come from a tracked RPC`).toBeDefined()
							expect(
								(meta?.fencesAtCall ?? -1) >= fences[profileId],
								`fpc data of ${key} predates the last fence of ${profileId}`,
							).toBe(true)
						}
					}
				}

				// ── interpret the tape ───────────────────────────────────────
				for (const n of tape) {
					const op = n % 100
					const p1 = Math.floor(n / 100) % 4
					const p2 = Math.floor(n / 400) % 4
					if (op < 20) {
						const caps: SubscribeCaps = {
							legs: p2 % 3 === 0 ? ["gas"] : p2 % 3 === 1 ? ["gas", "fpc"] : ["fpc"],
							retry: p2 % 2 === 0,
							txRefresh: p1 % 2 === 0,
							peek: n % 3 === 0,
						}
						const scope = SCOPES[p1]
						const handle = store.subscribe(scope, caps)
						subs.push({ scope, caps, release: handle.release, released: false })
						txHandler = txAdd.mock.calls.at(-1)?.[0] as typeof txHandler
					} else if (op < 35) {
						const live = liveSubs()
						if (live.length > 0) {
							const target = live[p1 % live.length]
							const wasLast = lastOfProfile(target.scope.profileId, target)
							target.released = true
							target.release()
							// Shadow the suspenders: the last release of a profile
							// fences it inside the store.
							if (wasLast) fences[target.scope.profileId] += 1
						}
					} else if (op < 60) {
						const scope = SCOPES[p1]
						const legs: ("gas" | "fpc")[] = p2 % 2 === 0 ? ["gas"] : ["gas", "fpc"]
						void store.ensure(scope, { legs }).catch(() => {})
					} else if (op < 70) {
						if (txHandler) txHandler({ account: SCOPES[p1].accountAddress, status: TxStatus.Proven })
					} else if (op < 78) {
						const profileId = p1 % 2 === 0 ? "p1" : "p2"
						store.invalidateProfile(profileId)
						fences[profileId] += 1
					} else if (op < 98) {
						if (pending.length > 0) {
							const idx = p1 * 4 + p2
							const call = pending.splice(idx % pending.length, 1)[0]
							call.settle(n % 5 !== 0) // ~20% of settlements are failures
						}
					} else {
						await vi.advanceTimersByTimeAsync(TIMER_STEPS[p1])
					}
					await flush()
					checkInvariants()
				}

				// ── drain to quiescence ──────────────────────────────────────
				for (let i = 0; i < 60 && pending.length > 0; i++) {
					pending.splice(0).forEach((c) => c.settle(true))
					await flush()
				}
				for (let i = 0; i < 5; i++) {
					await vi.advanceTimersByTimeAsync(35_000)
					pending.splice(0).forEach((c) => c.settle(true))
					await flush()
				}
				expect(pending.length, "drain must reach quiescence — a call is wedged").toBe(0)
				checkInvariants()
				for (const [key, entry] of Object.entries(store.entries)) {
					expect(entry.gas.status, `gas slice of ${key} stuck fetching after drain`).not.toBe("fetching")
					expect(entry.fpc.status, `fpc slice of ${key} stuck fetching after drain`).not.toBe("fetching")
				}
				// C — post-drain silence: every retry resolved successfully, so
				// no timer, no stranded forced state, may produce further calls.
				const callsAfterDrain = totalCalls
				await vi.advanceTimersByTimeAsync(35_000)
				await vi.advanceTimersByTimeAsync(35_000)
				expect(totalCalls, "client calls after a clean drain — an orphaned timer or stranded counter is firing").toBe(
					callsAfterDrain,
				)
			}),
			{ numRuns },
		)
	}, 120_000)
})
