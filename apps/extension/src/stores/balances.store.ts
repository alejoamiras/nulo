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

/**
 * Call-site bound on each store fetch. The popup→SW transport's own 60s
 * timer only arms after the port reaches Connected — an unreachable SW
 * would otherwise hang ensure (and the Confirm gate behind it) forever.
 */
export const INIT_FETCH_TIMEOUT_MS = 20_000

/** Silent-retry backoff after a degraded fetch. The last step repeats until
 *  the key's last retry-capable subscriber releases or a retry succeeds. */
export const INIT_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000]

/**
 * Rejects with a labeled error after `ms` if `promise` hasn't settled. The
 * underlying operation is NOT cancelled — the SW side single-flights these
 * reads, so a later retry re-attaches to the same in-flight computation.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
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

interface FetchOpts {
	cause: "ensure" | "retry" | "forced"
	forceRefresh?: boolean
}

/** Success commit for the gas leg. `forcedPendingLive` = a forced run is live
 *  for this key: a non-forced success then carries PRE-trigger data (a
 *  post-trigger non-forced fetch would have JOINED the forced leg run) and
 *  must not clear the stale-mark. */
function gasSuccessEntry(entry: BalanceEntry, opts: FetchOpts, result: GasBalances, forcedPendingLive: boolean): BalanceEntry {
	const preTrigger = opts.cause !== "forced" && forcedPendingLive
	return {
		...entry,
		stale: preTrigger ? entry.stale : false,
		gas: {
			...entry.gas,
			display: result,
			verified: result,
			status: "ready",
			version: entry.gas.version + 1,
			retryVersion: opts.cause === "retry" ? entry.gas.retryVersion + 1 : entry.gas.retryVersion,
			forcedVersion: opts.cause === "forced" ? entry.gas.forcedVersion + 1 : entry.gas.forcedVersion,
			// Debt clears ONLY on a retry-path success (D11): a plain
			// ensure landing fresh data leaves the loop to finish its
			// own cycle — the retry success is what bumps retryVersion
			// and wakes the degraded card's recovery watch.
			retryDebt: opts.cause === "retry" ? false : entry.gas.retryDebt,
			lastError: undefined,
		},
	}
}

function gasFailureEntry(entry: BalanceEntry, opts: FetchOpts, failed: string | undefined): BalanceEntry {
	return {
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
	}
}

function fpcSuccessEntry(entry: BalanceEntry, opts: FetchOpts, result: FpcInfo[]): BalanceEntry {
	return {
		...entry,
		fpc: {
			...entry.fpc,
			data: result ?? [],
			status: "ready",
			version: entry.fpc.version + 1,
			retryVersion: opts.cause === "retry" ? entry.fpc.retryVersion + 1 : entry.fpc.retryVersion,
			// Same D11 rule as the gas leg: only a retry-path success clears debt.
			retryDebt: opts.cause === "retry" ? false : entry.fpc.retryDebt,
			lastError: undefined,
		},
	}
}

/** lastGoodFpc retention: keep prior data (same key = same identity). */
function fpcFailureEntry(entry: BalanceEntry, failed: string | undefined): BalanceEntry {
	return {
		...entry,
		fpc: { ...entry.fpc, status: "degraded", version: entry.fpc.version + 1, retryDebt: true, lastError: failed },
	}
}

/**
 * The store's machinery, hoisted out of the Pinia setup closure so every
 * method sits at nesting depth 0 — the setup body only constructs it, installs
 * the profile-switch belt (which needs Pinia context), and returns the API.
 * Field and method bodies are the former closures verbatim.
 */
class BalancesCore {
	// ── app-lifetime clients (connect-once; tx client is event-only so its
	//    connect is explicit — the lazy path only fires on RPC use) ──────────
	private readonly execution = new ExecutionServiceClient()
	private readonly fpc = new FpcServiceClient()
	private readonly transactions = new TransactionServiceClient()
	private txConnected = false

	// ── state ────────────────────────────────────────────────────────────────
	readonly entries = ref<Record<string, BalanceEntry>>({})
	private readonly epochs = new Map<string, number>() // profileId → epoch
	private readonly subscribers = new Map<string, Map<number, { scope: BalanceScope; caps: SubscribeCaps }>>()
	private readonly rawFlights = new Map<string, Promise<unknown>>() // `${key}|${leg}|${epoch}`
	private readonly legFlights = new Map<string, Promise<void>>() // `${key}|${leg}|${epoch}` single-flight per attempt
	// Epoch-scoped like raw flights: a post-switch ensure must never JOIN a
	// pre-switch leg flight (it would await work fenced out of committing).
	// Keys with a forced gas fetch live (counted — forced runs can overlap):
	// while present, a PRE-trigger run's success commit must not clear the
	// forced stale-mark — its data predates the trigger, so the on-screen
	// value stays known-invalidated (dim + dot) until the post-trigger fetch
	// itself commits.
	private readonly forcedGasPending = new Map<string, number>()
	// Monotonic per-key forced-TRIGGER sequence. Authority follows trigger
	// recency, never settlement order: a forced run whose seq is no longer
	// current was overtaken by a newer settle — its data pre-dates that
	// trigger, so its commit is skipped wholesale (an inverted settlement
	// order must not let the older run overwrite the newer run's result).
	private readonly forcedGasSeq = new Map<string, number>()
	private readonly retryTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>()
	private readonly lruTouch = new Map<string, number>()
	private readonly keyProfile = new Map<string, string>()
	private subToken = 0
	private lruTick = 0

	private ensureTxSubscription(): void {
		if (this.txConnected) return
		this.txConnected = true
		this.transactions.onTransactionUpdated.add(this.onTransactionSettled)
		this.transactions.connect()
	}

	private epochOf(profileId: string): number {
		return this.epochs.get(profileId) ?? 0
	}

	/** Profile switch fence: bump the departing profile's epoch and clear its
	 *  entries. Called synchronously by the app-shell watcher (belt) and on the
	 *  last release of a profile's subscribers (suspenders). */
	invalidateProfile(profileId: string): void {
		this.epochs.set(profileId, this.epochOf(profileId) + 1)
		const next: Record<string, BalanceEntry> = {}
		for (const [key, entry] of Object.entries(this.entries.value)) {
			const owner = this.keyProfile.get(key)
			if (owner !== profileId) next[key] = entry
			else {
				this.stopRetry(key)
				this.lruTouch.delete(key)
				this.keyProfile.delete(key)
				// Per-key forced state dies with the fence: old-epoch runs must
				// not be counted against (or grant authority to) the next
				// epoch's fetches. Their own finally is epoch-guarded.
				this.forcedGasPending.delete(key)
				this.forcedGasSeq.delete(key)
			}
		}
		this.entries.value = next
	}

	private entryFor(key: string, scope: BalanceScope): BalanceEntry {
		let entry = this.entries.value[key]
		// Touch BEFORE any eviction: an untouched brand-new key would sort
		// oldest and evict itself.
		this.lruTouch.set(key, ++this.lruTick)
		if (!entry) {
			entry = newEntry(this.epochOf(scope.profileId))
			this.entries.value = { ...this.entries.value, [key]: entry }
			this.keyProfile.set(key, scope.profileId)
			this.evictIfNeeded()
		}
		return entry
	}

	private commitEntry(key: string, entry: BalanceEntry): void {
		this.entries.value = { ...this.entries.value, [key]: entry }
	}

	private evictIfNeeded(): void {
		const keys = Object.keys(this.entries.value)
		if (keys.length <= MAX_CACHED_ENTRIES) return
		const evictable = keys
			// Forced-pending keys are exempt (transient, fetch-bounded): evicting
			// one would orphan its keyProfile row, so a later profile fence could
			// no longer clear its forced state — a permanently stranded count.
			.filter((k) => (!this.subscribers.has(k) || this.subscribers.get(k)?.size === 0) && !this.forcedGasPending.has(k))
			.sort((a, b) => (this.lruTouch.get(a) ?? 0) - (this.lruTouch.get(b) ?? 0))
		const excess = keys.length - MAX_CACHED_ENTRIES
		const next = { ...this.entries.value }
		for (const k of evictable.slice(0, excess)) {
			delete next[k]
			this.lruTouch.delete(k)
			this.keyProfile.delete(k)
			// Keep auxiliary metadata aligned with the LRU (a settled force's
			// seq row would otherwise outlive its evicted entry).
			this.forcedGasSeq.delete(k)
			this.stopRetry(k)
		}
		this.entries.value = next
	}

	// ── capabilities ─────────────────────────────────────────────────────────
	private capsUnion(key: string): SubscribeCaps {
		const union: SubscribeCaps = { legs: [], retry: false, txRefresh: false, peek: false }
		const subs = this.subscribers.get(key)
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

	subscribe(scope: BalanceScope, caps: SubscribeCaps): { release: () => void } {
		this.ensureTxSubscription()
		const key = activityScopeKey(scope)
		const token = ++this.subToken
		const hadRetryCapable = this.capsUnion(key).retry
		let subs = this.subscribers.get(key)
		if (!subs) {
			subs = new Map()
			this.subscribers.set(key, subs)
		}
		subs.set(token, { scope, caps })
		this.entryFor(key, scope)
		// 0→1 retry-capable transition = today's reset-on-identity-change.
		if (!hadRetryCapable && caps.retry) this.resetRetryAttempts(key)
		if (caps.peek) void this.primeFromPeek(key, scope)
		let released = false
		return {
			release: () => {
				if (released) return
				released = true
				const current = this.subscribers.get(key)
				current?.delete(token)
				if (!this.capsUnion(key).retry) this.stopRetry(key) // 1→0 = today's chain death
				if (current && current.size === 0) {
					this.subscribers.delete(key)
					// Last subscriber of this profile gone → suspenders fence.
					const profileId = scope.profileId
					const anyLeft = [...this.subscribers.values()].some((m) => [...m.values()].some((s) => s.scope.profileId === profileId))
					if (!anyLeft) this.invalidateProfile(profileId)
				}
			},
		}
	}

	// ── SWR peek (display-only, version-guarded) ─────────────────────────────
	private async primeFromPeek(key: string, scope: BalanceScope): Promise<void> {
		const versionAtStart = this.entries.value[key]?.gas.version ?? 0
		try {
			const peeked = await this.execution.peekGasBalances(scope.networkId, scope.accountAddress)
			const entry = this.entries.value[key]
			if (!peeked || !entry) return
			// A late peek must never overwrite a newer fetch/forced commit.
			if (entry.gas.version !== versionAtStart) return
			// A forced fetch marks stale without bumping the version — a slow
			// fresh peek landing mid-force would pass the version guard and
			// un-dim the known-invalidated value. Defer to the force entirely.
			if (this.forcedGasPending.has(key)) return
			this.commitEntry(key, {
				...entry,
				// Honor the SW's own staleness verdict: a within-TTL peek is
				// FRESH and must not dim the card (today's fresh-peek behavior).
				stale: peeked.stale,
				gas: { ...entry.gas, display: peeked.balances, version: entry.gas.version + 1 },
			})
		} catch {
			// Peek is best-effort; the real fetch is unaffected.
		}
	}

	// ── the fetch pipeline ───────────────────────────────────────────────────
	private rawReuse<T>(key: string, leg: BalanceLeg, epoch: number, start: () => Promise<T>): Promise<T> {
		const flightKey = `${key}|${leg}|${epoch}`
		const existing = this.rawFlights.get(flightKey)
		if (existing) return existing as Promise<T>
		const flight = start()
		this.rawFlights.set(flightKey, flight)
		flight
			.finally(() => {
				if (this.rawFlights.get(flightKey) === flight) this.rawFlights.delete(flightKey)
			})
			.catch(() => {
				// Settle-probe chain must never surface as unhandled; the real
				// rejection is observed by the awaiting fetch.
			})
		return flight
	}

	private async fetchGas(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const inFlight = this.legFlights.get(`${key}|gas|${epoch}`)
		if (inFlight && opts.cause !== "forced") return inFlight
		// An async method runs synchronously to its first await exactly like the
		// former IIFE, so the single-flight registration below keeps its position.
		const run = this.runGasFetch(key, scope, epoch, opts)
		this.legFlights.set(`${key}|gas|${epoch}`, run)
		try {
			await run
		} finally {
			// Epoch-guarded: after a profile fence the per-key forced state was
			// already cleared — decrementing here would corrupt the NEW epoch's
			// counter if a fresh forced run started since.
			if (opts.cause === "forced" && this.epochOf(scope.profileId) === epoch) {
				const left = (this.forcedGasPending.get(key) ?? 1) - 1
				if (left <= 0) this.forcedGasPending.delete(key)
				else this.forcedGasPending.set(key, left)
			}
			if (this.legFlights.get(`${key}|gas|${epoch}`) === run) this.legFlights.delete(`${key}|gas|${epoch}`)
		}
	}

	/** Register a forced run BEFORE any await: count it live and take the next
	 *  trigger seq (authority follows trigger recency). Returns this run's seq. */
	private beginForcedRun(key: string): number {
		this.forcedGasPending.set(key, (this.forcedGasPending.get(key) ?? 0) + 1)
		const mySeq = (this.forcedGasSeq.get(key) ?? 0) + 1
		this.forcedGasSeq.set(key, mySeq)
		return mySeq
	}

	/** The two post-RPC re-checks, read fresh in the await's own continuation:
	 *  fenced (no cross-epoch commit), and an OUTRANKED forced run (a newer
	 *  settle started since this one's trigger) is superseded wholesale —
	 *  success or failure, its data pre-dates the newer trigger. */
	private isGasRunStale(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts, mySeq: number): boolean {
		if (this.epochOf(scope.profileId) !== epoch) return true
		return opts.cause === "forced" && mySeq !== this.forcedGasSeq.get(key)
	}

	private async runGasFetch(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const entry0 = this.entries.value[key]
		if (!entry0) return
		// A forced refresh means the on-screen value is known-invalidated:
		// mark it stale at START so the card dims immediately and a FAILED
		// force can't leave it rendered as current (settle-refresh dim rule).
		const mySeq = opts.cause === "forced" ? this.beginForcedRun(key) : 0
		this.commitEntry(key, {
			...entry0,
			stale: opts.cause === "forced" ? true : entry0.stale,
			gas: { ...entry0.gas, status: "fetching" },
		})
		let result: GasBalances | undefined
		let failed: string | undefined
		try {
			if (opts.cause === "forced") {
				// Never join a raw flight that predates the trigger: wait it
				// out, then start fresh. The wait is BOUNDED — an unbounded
				// wait on a wedged transport would hold every joiner of this
				// run past the fetch bound the constant promises; on timeout
				// we re-enter anyway (one stacked RPC, transport-bounded).
				const stale = this.rawFlights.get(`${key}|gas|${epoch}`)
				if (stale) {
					await withTimeout(
						stale.then(
							() => {},
							() => {},
						),
						INIT_FETCH_TIMEOUT_MS,
						"pre-trigger gas flight",
					).catch(() => {})
				}
				this.rawFlights.delete(`${key}|gas|${epoch}`)
			}
			result = await withTimeout(
				this.rawReuse(key, "gas", epoch, () =>
					this.execution.getGasBalances(scope.networkId, scope.accountAddress, opts.forceRefresh),
				),
				INIT_FETCH_TIMEOUT_MS,
				"getGasBalances",
			)
		} catch (err) {
			failed = err instanceof Error ? err.message : String(err)
		}
		if (this.isGasRunStale(key, scope, epoch, opts, mySeq)) return
		const entry = this.entries.value[key]
		if (!entry) return
		this.commitEntry(
			key,
			result !== undefined
				? gasSuccessEntry(entry, opts, result, this.forcedGasPending.has(key))
				: gasFailureEntry(entry, opts, failed),
		)
	}

	private async fetchFpc(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const inFlight = this.legFlights.get(`${key}|fpc|${epoch}`)
		if (inFlight) return inFlight
		const run = this.runFpcFetch(key, scope, epoch, opts)
		this.legFlights.set(`${key}|fpc|${epoch}`, run)
		try {
			await run
		} finally {
			if (this.legFlights.get(`${key}|fpc|${epoch}`) === run) this.legFlights.delete(`${key}|fpc|${epoch}`)
		}
	}

	private async runFpcFetch(key: string, scope: BalanceScope, epoch: number, opts: FetchOpts): Promise<void> {
		const entry0 = this.entries.value[key]
		if (!entry0) return
		this.commitEntry(key, { ...entry0, fpc: { ...entry0.fpc, status: "fetching" } })
		let result: FpcInfo[] | undefined
		let failed: string | undefined
		try {
			result = await withTimeout(
				this.rawReuse(key, "fpc", epoch, () => this.fpc.getFpcs(scope.chainId)),
				INIT_FETCH_TIMEOUT_MS,
				"getFpcs",
			)
		} catch (err) {
			failed = err instanceof Error ? err.message : String(err)
		}
		if (this.epochOf(scope.profileId) !== epoch) return
		const entry = this.entries.value[key]
		if (!entry) return
		this.commitEntry(key, result !== undefined ? fpcSuccessEntry(entry, opts, result) : fpcFailureEntry(entry, failed))
	}

	async ensure(scope: BalanceScope, opts: { legs: BalanceLeg[]; forceRefresh?: boolean }): Promise<EnsureSnapshot> {
		const key = activityScopeKey(scope)
		const epoch = this.epochOf(scope.profileId)
		this.entryFor(key, scope)
		const cause: FetchOpts["cause"] = opts.forceRefresh ? "forced" : "ensure"
		await Promise.all([
			opts.legs.includes("gas") ? this.fetchGas(key, scope, epoch, { cause, forceRefresh: opts.forceRefresh }) : Promise.resolve(),
			opts.legs.includes("fpc") ? this.fetchFpc(key, scope, epoch, { cause }) : Promise.resolve(),
		])
		if (this.epochOf(scope.profileId) !== epoch) throw new EnsureSuperseded()
		const entry = this.entries.value[key]
		if (!entry) throw new EnsureSuperseded()
		this.adoptGasRetryDebt(key, entry, opts.legs)
		const degraded = anyLegDegraded(entry, opts.legs)
		if (degraded) this.scheduleRetry(key, scope)
		return { scope, epoch, gas: { verified: entry.gas.verified }, fpc: { data: entry.fpc.data }, degraded }
	}

	/** Debt follows the OBSERVING cause, not the flight's: an ensure that
	 *  JOINED a failing forced flight (whose own failure creates no debt —
	 *  D11) still has a retry-capable stake in the outcome. Without this,
	 *  the degraded card would paint its retrying notice while no loop runs
	 *  and retryVersion never bumps to wake its recovery watch. Gas-only:
	 *  the fpc leg has no forced cause, so every degraded fpc already
	 *  carries its debt from the failure commit. */
	private adoptGasRetryDebt(key: string, entry: BalanceEntry, legs: BalanceLeg[]): void {
		if (legs.includes("gas") && entry.gas.status === "degraded" && !entry.gas.retryDebt) {
			this.commitEntry(key, { ...entry, gas: { ...entry.gas, retryDebt: true } })
		}
	}

	// ── retry backoff (runs only while retryDebt && a retry-capable sub) ─────
	private resetRetryAttempts(key: string): void {
		const state = this.retryTimers.get(key)
		if (state) {
			clearTimeout(state.timer)
			this.retryTimers.delete(key)
		}
	}
	private stopRetry(key: string): void {
		this.resetRetryAttempts(key)
	}

	private scheduleRetry(key: string, scope: BalanceScope): void {
		if (!this.capsUnion(key).retry) return
		const entry = this.entries.value[key]
		if (!entry || (!entry.gas.retryDebt && !entry.fpc.retryDebt)) return
		if (this.retryTimers.has(key)) return
		const attempt = 0
		this.armRetry(key, scope, attempt)
	}

	private armRetry(key: string, scope: BalanceScope, attempt: number): void {
		// One chain per key: a concurrent ensure can arm a timer while a
		// runRetry is mid-flight; overwriting its map entry without clearing
		// would orphan a still-pending setTimeout into a duplicate chain.
		const existing = this.retryTimers.get(key)
		if (existing) clearTimeout(existing.timer)
		const delay = INIT_RETRY_BACKOFF_MS[Math.min(attempt, INIT_RETRY_BACKOFF_MS.length - 1)]
		const timer = setTimeout(() => {
			this.retryTimers.delete(key)
			void this.runRetry(key, scope, attempt)
		}, delay)
		this.retryTimers.set(key, { timer, attempt })
	}

	/** Re-arm only while debt remains AND retry capability survived the flight —
	 *  a subscriber can drop the retry cap mid-flight. */
	private shouldRearmRetry(key: string): boolean {
		const after = this.entries.value[key]
		return Boolean(after && (after.gas.retryDebt || after.fpc.retryDebt) && this.capsUnion(key).retry)
	}

	private async runRetry(key: string, scope: BalanceScope, attempt: number): Promise<void> {
		const union = this.capsUnion(key)
		if (!union.retry) return
		const entry = this.entries.value[key]
		if (!entry || (!entry.gas.retryDebt && !entry.fpc.retryDebt)) return
		const epoch = this.epochOf(scope.profileId)
		const legs = retryLegsFor(entry, union.legs)
		await Promise.all([
			legs.includes("gas") ? this.fetchGas(key, scope, epoch, { cause: "retry" }) : Promise.resolve(),
			legs.includes("fpc") ? this.fetchFpc(key, scope, epoch, { cause: "retry" }) : Promise.resolve(),
		])
		if (this.shouldRearmRetry(key)) this.armRetry(key, scope, attempt + 1)
	}

	// ── tx-settle → forced gas refresh for txRefresh-capable keys ────────────
	// An arrow field: it is handed to the transaction client's event handler.
	private readonly onTransactionSettled = (tx: { account: string; status: unknown }): void => {
		if (tx.status === TxStatus.Pending) return
		for (const [key, subs] of this.subscribers) {
			const anyTxRefresh = [...subs.values()].some((s) => s.caps.txRefresh)
			if (!anyTxRefresh) continue
			const scope = [...subs.values()][0]?.scope
			if (!scope || scope.accountAddress !== tx.account) continue
			void this.fetchGas(key, scope, this.epochOf(scope.profileId), { cause: "forced", forceRefresh: true })
		}
	}

	entry(scope: BalanceScope): BalanceEntry | undefined {
		return this.entries.value[activityScopeKey(scope)]
	}
}

function anyLegDegraded(entry: BalanceEntry, legs: BalanceLeg[]): boolean {
	return (legs.includes("gas") && entry.gas.status === "degraded") || (legs.includes("fpc") && entry.fpc.status === "degraded")
}

/** Legs that still owe a retry AND are retry-covered by the current subscriber union. */
function retryLegsFor(entry: BalanceEntry, unionLegs: BalanceLeg[]): BalanceLeg[] {
	const legs: BalanceLeg[] = []
	if (entry.gas.retryDebt && unionLegs.includes("gas")) legs.push("gas")
	if (entry.fpc.retryDebt && unionLegs.includes("fpc")) legs.push("fpc")
	return legs
}

export const useBalancesStore = defineStore("balances", () => {
	const core = new BalancesCore()

	// The BELT: fence the departing profile the instant the active profile
	// changes, synchronously — before any component watcher can fetch under
	// the new identity against old entries. (The suspenders is the
	// last-subscriber-release path in subscribe().)
	const appStore = useAppStore()
	watch(
		() => appStore.profile?.id,
		(_next, prev) => {
			if (prev !== undefined) core.invalidateProfile(prev)
		},
		{ flush: "sync" },
	)

	return {
		entries: core.entries,
		subscribe: core.subscribe.bind(core),
		ensure: core.ensure.bind(core),
		entry: core.entry.bind(core),
		invalidateProfile: core.invalidateProfile.bind(core),
	}
})
