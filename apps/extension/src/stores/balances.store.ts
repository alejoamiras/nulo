/**
 * The ONE popup-side owner of fee-juice balance + FPC-list fetching.
 *
 * Before this store, FeeSettingsCard and GasBalanceCard each carried a private
 * copy of the same machinery (init coalescing, raw-request reuse, retry
 * backoff, SWR peek, generation guards). The store owns app-lifetime service
 * clients (app.store `inFlightJournal` precedent: connect-once, never
 * disconnected) and a `(profileId, networkId, chainId, accountAddress)`-keyed
 * entry map (activity.store slice precedent); the cards are subscribers with
 * declared capabilities. The SW-side GasBalanceReader keeps its own TTL /
 * cross-document dedup role — this store's job is instance coalescing,
 * retry/degraded policy, and ONE connection lifecycle.
 *
 * Invariants (audit-derived, each pinned in balances.store.test.ts):
 * - Entries are PROFILE-scoped and epoch-fenced: a profile switch bumps the
 *   departing profile's epoch and clears its entries synchronously; fetches
 *   and raw flights are epoch-stamped; a superseded ensure CANCELS with the
 *   typed `EnsureSuperseded` — it never re-enters (the underlying RPCs bind
 *   to the SW's ACTIVE profile, so a stale flight must never be re-blessed).
 * - Raw RPC promises are reused across timed-out attempts (per key+leg+epoch):
 *   a retry re-attaches a fresh timeout to the SAME pending request — plain
 *   single-flight would re-stack uncancellable pre-connect RPCs.
 * - FORCED refreshes (tx-settle) never join a raw flight that predates the
 *   trigger: they wait the live flight out, then re-enter fresh.
 * - The gas slice separates `display` (last-known, SWR) from `verified`
 *   (cleared by any failed refresh) — display can keep painting while gating
 *   correctly sees unknown. Peek commits are version-guarded.
 * - Cause-specific signals: `version` (any commit), `retryVersion` (retry-path
 *   commits only — the degraded-recovery signal), `forcedVersion` (successful
 *   forced commits only — the optimistic-overlay reset signal). `retryDebt`
 *   is independent of slice status: only a successful retry-path commit
 *   clears it.
 * - Subscriber capabilities drive ALL traffic: legs fetched, backoff retry
 *   (only while a retry-capable subscriber holds the key), tx-settle refresh
 *   (only keys with a txRefresh-capable subscriber), and peek. Today's
 *   per-card traffic is reproduced by construction.
 */
import { type ActivityScope, activityScopeKey } from "@nulo/wallet-core/activity"
import { defineStore } from "pinia"
import { ref, watch } from "vue"
import { useAppStore } from "@/stores/app.store"
import { INIT_FETCH_TIMEOUT_MS, INIT_RETRY_BACKOFF_MS, withTimeout } from "@/popup/components/modules/send/fee-helpers"
import { ExecutionServiceClient } from "@/wallet/services/execution/client"
import type { GasBalances } from "@/wallet/services/execution/models"
import { FpcServiceClient } from "@/wallet/services/fpc/client"
import type { FpcInfo } from "@/wallet/services/fpc/spec"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { TxStatus } from "@/wallet/services/transaction/spec"

export type BalanceScope = ActivityScope
export type SliceStatus = "idle" | "fetching" | "ready" | "degraded"

export interface GasSlice {
	/** Last-known (SWR): survives failed refreshes; peek commits are version-guarded. */
	display?: GasBalances
	/** Cleared by any failed refresh — the ONLY gating-grade data. */
	verified?: GasBalances
	status: SliceStatus
	version: number
	retryVersion: number
	forcedVersion: number
	retryDebt: boolean
	lastError?: string
}

export interface FpcSlice {
	data?: FpcInfo[]
	status: SliceStatus
	version: number
	retryVersion: number
	retryDebt: boolean
	lastError?: string
}

export interface BalanceEntry {
	gas: GasSlice
	fpc: FpcSlice
	/** SWR marker: display data came from a peek/stale source; cleared by a fresh gas commit. */
	stale: boolean
	epoch: number
}

export type BalanceLeg = "gas" | "fpc"
export interface SubscribeCaps {
	legs: BalanceLeg[]
	retry: boolean
	txRefresh: boolean
	peek: boolean
}

export interface EnsureSnapshot {
	scope: BalanceScope
	epoch: number
	gas: { verified?: GasBalances }
	fpc: { data?: FpcInfo[] }
	degraded: boolean
}

/** A superseded ensure (profile epoch moved on): the caller treats it as a
 *  discarded run — no degraded state, no retry. Never re-entered internally. */
export class EnsureSuperseded extends Error {
	constructor() {
		super("ensure superseded by a profile switch")
		this.name = "EnsureSuperseded"
	}
}

/** How many unsubscribed entries to keep before evicting the least recent. */
const MAX_CACHED_ENTRIES = 32

function newGasSlice(): GasSlice {
	return { status: "idle", version: 0, retryVersion: 0, forcedVersion: 0, retryDebt: false }
}
function newFpcSlice(): FpcSlice {
	return { status: "idle", version: 0, retryVersion: 0, retryDebt: false }
}
function newEntry(epoch: number): BalanceEntry {
	return { gas: newGasSlice(), fpc: newFpcSlice(), stale: false, epoch }
}

export const useBalancesStore = defineStore("balances", () => {
	// ── app-lifetime clients (connect-once; tx client is event-only so its
	//    connect is explicit — the lazy path only fires on RPC use) ──────────
	const execution = new ExecutionServiceClient()
	const fpc = new FpcServiceClient()
	const transactions = new TransactionServiceClient()
	let txConnected = false
	function ensureTxSubscription(): void {
		if (txConnected) return
		txConnected = true
		transactions.onTransactionUpdated.add(onTransactionSettled)
		transactions.connect()
	}

	// ── state ────────────────────────────────────────────────────────────────
	const entries = ref<Record<string, BalanceEntry>>({})
	const epochs = new Map<string, number>() // profileId → epoch
	const subscribers = new Map<string, Map<number, { scope: BalanceScope; caps: SubscribeCaps }>>()
	const rawFlights = new Map<string, Promise<unknown>>() // `${key}|${leg}|${epoch}`
	const legFlights = new Map<string, Promise<void>>() // `${key}|${leg}|${epoch}` single-flight per attempt
	// Epoch-scoped like raw flights: a post-switch ensure must never JOIN a
	// pre-switch leg flight (it would await work fenced out of committing).
	const retryTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>()
	const lruTouch = new Map<string, number>()
	let subToken = 0
	let lruTick = 0

	const epochOf = (profileId: string): number => epochs.get(profileId) ?? 0

	/** Profile switch fence: bump the departing profile's epoch and clear its
	 *  entries. Called synchronously by the app-shell watcher (belt) and on the
	 *  last release of a profile's subscribers (suspenders). */
	function invalidateProfile(profileId: string): void {
		epochs.set(profileId, epochOf(profileId) + 1)
		const next: Record<string, BalanceEntry> = {}
		for (const [key, entry] of Object.entries(entries.value)) {
			const owner = keyProfile.get(key)
			if (owner !== profileId) next[key] = entry
			else {
				stopRetry(key)
				lruTouch.delete(key)
				keyProfile.delete(key)
			}
		}
		entries.value = next
	}
	const keyProfile = new Map<string, string>()

	function entryFor(key: string, scope: BalanceScope): BalanceEntry {
		let entry = entries.value[key]
		// Touch BEFORE any eviction: an untouched brand-new key would sort
		// oldest and evict itself.
		lruTouch.set(key, ++lruTick)
		if (!entry) {
			entry = newEntry(epochOf(scope.profileId))
			entries.value = { ...entries.value, [key]: entry }
			keyProfile.set(key, scope.profileId)
			evictIfNeeded()
		}
		return entry
	}

	function commitEntry(key: string, entry: BalanceEntry): void {
		entries.value = { ...entries.value, [key]: entry }
	}

	function evictIfNeeded(): void {
		const keys = Object.keys(entries.value)
		if (keys.length <= MAX_CACHED_ENTRIES) return
		const evictable = keys
			.filter((k) => !subscribers.has(k) || subscribers.get(k)?.size === 0)
			.sort((a, b) => (lruTouch.get(a) ?? 0) - (lruTouch.get(b) ?? 0))
		const excess = keys.length - MAX_CACHED_ENTRIES
		const next = { ...entries.value }
		for (const k of evictable.slice(0, excess)) {
			delete next[k]
			lruTouch.delete(k)
			keyProfile.delete(k)
			stopRetry(k)
		}
		entries.value = next
	}

	// ── capabilities ─────────────────────────────────────────────────────────
	function capsUnion(key: string): SubscribeCaps {
		const union: SubscribeCaps = { legs: [], retry: false, txRefresh: false, peek: false }
		const subs = subscribers.get(key)
		if (!subs) return union
		const legs = new Set<BalanceLeg>()
		for (const { caps } of subs.values()) {
			for (const leg of caps.legs) legs.add(leg)
			union.retry ||= caps.retry
			union.txRefresh ||= caps.txRefresh
			union.peek ||= caps.peek
		}
		union.legs = [...legs]
		return union
	}

	function subscribe(scope: BalanceScope, caps: SubscribeCaps): { release: () => void } {
		ensureTxSubscription()
		const key = activityScopeKey(scope)
		const token = ++subToken
		const hadRetryCapable = capsUnion(key).retry
		let subs = subscribers.get(key)
		if (!subs) {
			subs = new Map()
			subscribers.set(key, subs)
		}
		subs.set(token, { scope, caps })
		entryFor(key, scope)
		// 0→1 retry-capable transition = today's reset-on-identity-change.
		if (!hadRetryCapable && caps.retry) resetRetryAttempts(key)
		if (caps.peek) void primeFromPeek(key, scope)
		let released = false
		return {
			release: () => {
				if (released) return
				released = true
				const current = subscribers.get(key)
				current?.delete(token)
				if (!capsUnion(key).retry) stopRetry(key) // 1→0 = today's chain death
				if (current && current.size === 0) {
					subscribers.delete(key)
					// Last subscriber of this profile gone → suspenders fence.
					const profileId = scope.profileId
					const anyLeft = [...subscribers.values()].some((m) => [...m.values()].some((s) => s.scope.profileId === profileId))
					if (!anyLeft) invalidateProfile(profileId)
				}
			},
		}
	}

	// ── SWR peek (display-only, version-guarded) ─────────────────────────────
	async function primeFromPeek(key: string, scope: BalanceScope): Promise<void> {
		const versionAtStart = entries.value[key]?.gas.version ?? 0
		try {
			const peeked = await execution.peekGasBalances(scope.networkId, scope.accountAddress)
			const entry = entries.value[key]
			if (!peeked || !entry) return
			// A late peek must never overwrite a newer fetch/forced commit.
			if (entry.gas.version !== versionAtStart) return
			commitEntry(key, {
				...entry,
				stale: true,
				gas: { ...entry.gas, display: peeked.balances, version: entry.gas.version + 1 },
			})
		} catch {
			// Peek is best-effort; the real fetch is unaffected.
		}
	}

	// ── the fetch pipeline ───────────────────────────────────────────────────
	function rawReuse<T>(key: string, leg: BalanceLeg, epoch: number, start: () => Promise<T>): Promise<T> {
		const flightKey = `${key}|${leg}|${epoch}`
		const existing = rawFlights.get(flightKey)
		if (existing) return existing as Promise<T>
		const flight = start()
		rawFlights.set(flightKey, flight)
		flight
			.finally(() => {
				if (rawFlights.get(flightKey) === flight) rawFlights.delete(flightKey)
			})
			.catch(() => {
				// Settle-probe chain must never surface as unhandled; the real
				// rejection is observed by the awaiting fetch.
			})
		return flight
	}

	interface FetchOpts {
		cause: "ensure" | "retry" | "forced"
		forceRefresh?: boolean
	}

	async function fetchGas(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const inFlight = legFlights.get(`${key}|gas|${epoch}`)
		if (inFlight && opts.cause !== "forced") return inFlight
		const run = (async () => {
			const entry0 = entries.value[key]
			if (!entry0) return
			commitEntry(key, { ...entry0, gas: { ...entry0.gas, status: "fetching" } })
			let result: GasBalances | undefined
			let failed: string | undefined
			try {
				if (opts.cause === "forced") {
					// Never join a raw flight that predates the trigger: wait it
					// out, then start fresh.
					const stale = rawFlights.get(`${key}|gas|${epoch}`)
					if (stale) await stale.catch(() => {})
					rawFlights.delete(`${key}|gas|${epoch}`)
				}
				result = await withTimeout(
					rawReuse(key, "gas", epoch, () => execution.getGasBalances(scope.networkId, scope.accountAddress, opts.forceRefresh)),
					INIT_FETCH_TIMEOUT_MS,
					"getGasBalances",
				)
			} catch (err) {
				failed = err instanceof Error ? err.message : String(err)
			}
			if (epochOf(scope.profileId) !== epoch) return // fenced: no cross-epoch commit
			const entry = entries.value[key]
			if (!entry) return
			if (result !== undefined) {
				commitEntry(key, {
					...entry,
					stale: false,
					gas: {
						...entry.gas,
						display: result,
						verified: result,
						status: "ready",
						version: entry.gas.version + 1,
						retryVersion: opts.cause === "retry" ? entry.gas.retryVersion + 1 : entry.gas.retryVersion,
						forcedVersion: opts.cause === "forced" ? entry.gas.forcedVersion + 1 : entry.gas.forcedVersion,
						retryDebt: opts.cause === "retry" || opts.cause === "ensure" ? false : entry.gas.retryDebt,
						lastError: undefined,
					},
				})
			} else {
				commitEntry(key, {
					...entry,
					gas: {
						...entry.gas,
						verified: undefined, // display retained (SWR); gating sees unknown
						status: "degraded",
						version: entry.gas.version + 1,
						// A tx-refresh failure creates no retry debt (D11).
						retryDebt: opts.cause === "forced" ? entry.gas.retryDebt : true,
						lastError: failed,
					},
				})
			}
		})()
		legFlights.set(`${key}|gas|${epoch}`, run)
		try {
			await run
		} finally {
			if (legFlights.get(`${key}|gas|${epoch}`) === run) legFlights.delete(`${key}|gas|${epoch}`)
		}
	}

	async function fetchFpc(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const inFlight = legFlights.get(`${key}|fpc|${epoch}`)
		if (inFlight) return inFlight
		const run = (async () => {
			const entry0 = entries.value[key]
			if (!entry0) return
			commitEntry(key, { ...entry0, fpc: { ...entry0.fpc, status: "fetching" } })
			let result: FpcInfo[] | undefined
			let failed: string | undefined
			try {
				result = await withTimeout(
					rawReuse(key, "fpc", epoch, () => fpc.getFpcs(scope.chainId)),
					INIT_FETCH_TIMEOUT_MS,
					"getFpcs",
				)
			} catch (err) {
				failed = err instanceof Error ? err.message : String(err)
			}
			if (epochOf(scope.profileId) !== epoch) return
			const entry = entries.value[key]
			if (!entry) return
			if (result !== undefined) {
				commitEntry(key, {
					...entry,
					fpc: {
						...entry.fpc,
						data: result ?? [],
						status: "ready",
						version: entry.fpc.version + 1,
						retryVersion: opts.cause === "retry" ? entry.fpc.retryVersion + 1 : entry.fpc.retryVersion,
						retryDebt: false,
						lastError: undefined,
					},
				})
			} else {
				// lastGoodFpc retention: keep prior data (same key = same identity).
				commitEntry(key, {
					...entry,
					fpc: { ...entry.fpc, status: "degraded", version: entry.fpc.version + 1, retryDebt: true, lastError: failed },
				})
			}
		})()
		legFlights.set(`${key}|fpc|${epoch}`, run)
		try {
			await run
		} finally {
			if (legFlights.get(`${key}|fpc|${epoch}`) === run) legFlights.delete(`${key}|fpc|${epoch}`)
		}
	}

	async function ensure(scope: BalanceScope, opts: { legs: BalanceLeg[]; forceRefresh?: boolean }): Promise<EnsureSnapshot> {
		const key = activityScopeKey(scope)
		const epoch = epochOf(scope.profileId)
		entryFor(key, scope)
		const cause: FetchOpts["cause"] = opts.forceRefresh ? "forced" : "ensure"
		await Promise.all([
			opts.legs.includes("gas") ? fetchGas(key, scope, epoch, { cause, forceRefresh: opts.forceRefresh }) : Promise.resolve(),
			opts.legs.includes("fpc") ? fetchFpc(key, scope, epoch, { cause }) : Promise.resolve(),
		])
		if (epochOf(scope.profileId) !== epoch) throw new EnsureSuperseded()
		const entry = entries.value[key]
		if (!entry) throw new EnsureSuperseded()
		const degraded =
			(opts.legs.includes("gas") && entry.gas.status === "degraded") || (opts.legs.includes("fpc") && entry.fpc.status === "degraded")
		if (degraded) scheduleRetry(key, scope)
		return { scope, epoch, gas: { verified: entry.gas.verified }, fpc: { data: entry.fpc.data }, degraded }
	}

	// ── retry backoff (runs only while retryDebt && a retry-capable sub) ─────
	function resetRetryAttempts(key: string): void {
		const state = retryTimers.get(key)
		if (state) {
			clearTimeout(state.timer)
			retryTimers.delete(key)
		}
	}
	function stopRetry(key: string): void {
		resetRetryAttempts(key)
	}

	function scheduleRetry(key: string, scope: BalanceScope): void {
		if (!capsUnion(key).retry) return
		const entry = entries.value[key]
		if (!entry || (!entry.gas.retryDebt && !entry.fpc.retryDebt)) return
		if (retryTimers.has(key)) return
		const attempt = 0
		armRetry(key, scope, attempt)
	}

	function armRetry(key: string, scope: BalanceScope, attempt: number): void {
		const delay = INIT_RETRY_BACKOFF_MS[Math.min(attempt, INIT_RETRY_BACKOFF_MS.length - 1)]
		const timer = setTimeout(() => {
			retryTimers.delete(key)
			void runRetry(key, scope, attempt)
		}, delay)
		retryTimers.set(key, { timer, attempt })
	}

	async function runRetry(key: string, scope: BalanceScope, attempt: number): Promise<void> {
		const union = capsUnion(key)
		if (!union.retry) return
		const entry = entries.value[key]
		if (!entry || (!entry.gas.retryDebt && !entry.fpc.retryDebt)) return
		const epoch = epochOf(scope.profileId)
		const legs: BalanceLeg[] = []
		if (entry.gas.retryDebt && union.legs.includes("gas")) legs.push("gas")
		if (entry.fpc.retryDebt && union.legs.includes("fpc")) legs.push("fpc")
		await Promise.all([
			legs.includes("gas") ? fetchGas(key, scope, epoch, { cause: "retry" }) : Promise.resolve(),
			legs.includes("fpc") ? fetchFpc(key, scope, epoch, { cause: "retry" }) : Promise.resolve(),
		])
		const after = entries.value[key]
		if (after && (after.gas.retryDebt || after.fpc.retryDebt) && capsUnion(key).retry) {
			armRetry(key, scope, attempt + 1)
		}
	}

	// ── tx-settle → forced gas refresh for txRefresh-capable keys ────────────
	function onTransactionSettled(tx: { account: string; status: unknown }): void {
		if (tx.status === TxStatus.Pending) return
		for (const [key, subs] of subscribers) {
			const anyTxRefresh = [...subs.values()].some((s) => s.caps.txRefresh)
			if (!anyTxRefresh) continue
			const scope = [...subs.values()][0]?.scope
			if (!scope || scope.accountAddress !== tx.account) continue
			void fetchGas(key, scope, epochOf(scope.profileId), { cause: "forced", forceRefresh: true })
		}
	}

	function entry(scope: BalanceScope): BalanceEntry | undefined {
		return entries.value[activityScopeKey(scope)]
	}

	// The BELT: fence the departing profile the instant the active profile
	// changes, synchronously — before any component watcher can fetch under
	// the new identity against old entries. (The suspenders is the
	// last-subscriber-release path in subscribe().)
	const appStore = useAppStore()
	watch(
		() => appStore.profile?.id,
		(_next, prev) => {
			if (prev !== undefined) invalidateProfile(prev)
		},
		{ flush: "sync" },
	)

	return {
		entries,
		subscribe,
		ensure,
		entry,
		invalidateProfile,
		scopeKeyFor: activityScopeKey,
		__testing: { capsUnion, epochOf },
	}
})
