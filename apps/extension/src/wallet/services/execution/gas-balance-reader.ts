/**
 * `GasBalanceReader` — the gas-balance (FeeJuice) readout subsystem,
 * extracted verbatim from the execution facade.
 *
 * Owns the `${networkId}:${accountAddress}`-keyed TTL cache, the
 * single-flight dedup (fresh popup opens fire several concurrent
 * readouts — FeeSettingsCard + GasBalanceCard — and each independently
 * triggered FPC discovery before the guard existed), and the two-leg
 * compute: public FeeJuice via `balance_of_public` and the PrivateFPC's
 * `balance_of` when one is registered, as CONCURRENT independent
 * invocations with per-leg failure isolation (they ride different
 * arms — direct-to-node vs PXE — so they must not shared-fate).
 *
 * Invalidation is owned by the FACADE's event subscriptions (settled-tx
 * per-account; PrivateFPC mutation full sweep) — registration order in
 * `init()` is load-bearing and stays there. Invalidation MARKS STALE
 * rather than deleting: `get()` recomputes past-TTL entries either way,
 * while `peek()` keeps serving the last-known value so the UI can render
 * it dimmed instead of a skeleton (stale-while-revalidate).
 */

import { getErrorMessage } from "@nulo/wallet-core/utils"
import { FpcType, type FpcInfo } from "@/wallet/services/fpc/service"
import { feeJuiceAddress } from "@/wallet/utils/fee-juice"
import { batchedViewSimulation, type BatchedViewSimulationDeps } from "./helpers/batched-view-simulation"
import type { GasBalances } from "./spec"

export const GAS_BALANCE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Pause before the one-shot re-read of a THROWN leg. Sized to the cold-start
 *  offscreen boot window (observed ~200ms) with margin — long enough for the
 *  transport to come up, short enough that the first paint isn't hostage. */
export const GAS_BALANCE_FAILED_LEG_RETRY_DELAY_MS = 1_500

export interface GasBalanceReaderDeps {
	getChainId(networkId: string): Promise<number>
	getViewDeps(networkId: string, accountAddress: string): Promise<BatchedViewSimulationDeps>
	getFpcs(chainId: number): Promise<FpcInfo[]>
	logDebug(msg: string, ...rest: unknown[]): void
	logError(msg: string, ...rest: unknown[]): void
	/** Test seam; production omits it and gets the 1.5s default. */
	failedLegRetryDelayMs?: number
}

/** A leg's outcome. `failed` is true only when the read THREW (transient
 *  transport/RPC failure) — a structural null (missing return slot, no
 *  PrivateFPC registered) is a definitive answer, not a failure, and must
 *  not trigger retries or already-stale caching. */
type LegOutcome = { value: string | null; failed: boolean }

export class GasBalanceReader {
	private cache = new Map<string, { result: GasBalances; fetchedAt: number }>()
	/** Single-flight dedup for concurrent callers of the same key. Flights
	 *  carry the epoch they started under: a joiner from a later epoch must
	 *  not receive the flight's VALUE — the stale-marking commit fence only
	 *  demotes the cache entry, not the promise result crossing to joiners. */
	private inFlight = new Map<string, { promise: Promise<GasBalances>; epoch: number }>()
	/** Bumped on every invalidation. A compute that started before the bump
	 *  caches its snapshot already-stale, so it can still be peeked (dimmed)
	 *  but the next `get` recomputes. Global on purpose: over-staling a
	 *  sibling account's concurrent compute costs one extra recompute and
	 *  keeps the bookkeeping trivial. */
	private epoch = 0
	/** Bumped only by `evictAll`. A compute in flight across an eviction must
	 *  not write its snapshot back at all — a stale-marked write-back would
	 *  resurrect another profile's figures as peekable last-knowns, re-opening
	 *  the leak eviction exists to close. */
	private evictGeneration = 0

	public constructor(private readonly deps: GasBalanceReaderDeps) {}

	public async get(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
		const cacheKey = `${networkId}:${accountAddress}`
		if (!forceRefresh) {
			const cached = this.cache.get(cacheKey)
			if (cached && Date.now() - cached.fetchedAt < GAS_BALANCE_TTL_MS) {
				return cached.result
			}
		}

		const inFlight = this.inFlight.get(cacheKey)
		if (inFlight) {
			if (!forceRefresh && inFlight.epoch === this.epoch) {
				this.deps.logDebug(`getGasBalances: dedup — awaiting in-flight request for ${cacheKey}`)
				return inFlight.promise
			}
			// A forced read must not JOIN a flight that may predate the
			// invalidation that triggered it (post-settlement caller, pre-
			// settlement snapshot), and a caller from a LATER epoch must not
			// receive a value computed under the previous context (a profile
			// switch mid-flight: the private leg reads the OLD profile's FPCs).
			// Wait it out, then re-enter: the epoch stamp has marked that
			// flight's cache entry stale, so re-entry recomputes; if someone
			// already restarted, their current-epoch flight is joined.
			const reenter = () => this.get(networkId, accountAddress, false)
			return inFlight.promise.then(reenter, reenter)
		}
		const epochAtStart = this.epoch
		const evictGenAtStart = this.evictGeneration
		const pending = this.compute(cacheKey, networkId, accountAddress, epochAtStart, evictGenAtStart).finally(() => {
			this.inFlight.delete(cacheKey)
		})
		this.inFlight.set(cacheKey, { promise: pending, epoch: epochAtStart })
		return pending
	}

	/**
	 * Cache-only read of the last-known balances — instant, never fetches.
	 * Serves expired AND invalidated entries with `stale: true` so the UI
	 * can paint the last value dimmed while a real refresh runs; `null`
	 * only when this key was never fetched in this SW lifetime.
	 */
	public peek(networkId: string, accountAddress: string): { balances: GasBalances; stale: boolean } | null {
		const entry = this.cache.get(`${networkId}:${accountAddress}`)
		if (!entry) return null
		return { balances: entry.result, stale: Date.now() - entry.fetchedAt >= GAS_BALANCE_TTL_MS }
	}

	/** Settled-tx invalidation: mark every key for the account stale (not
	 *  deleted — `peek` keeps the last-known value for dimmed display). */
	public invalidateAccount(account: string): void {
		this.epoch += 1
		for (const [key, entry] of this.cache) {
			if (key.endsWith(`:${account}`)) {
				this.cache.set(key, { ...entry, fetchedAt: 0 })
			}
		}
	}

	/** PrivateFPC-mutation invalidation: the cache is keyed only by
	 *  `${networkId}:${account}`, so swapping the PrivateFPC address would
	 *  otherwise serve stale private-FJ readouts for up to the TTL.
	 *  Coarse but correct; stale-marked, not deleted, same as above. */
	public invalidateAll(): void {
		this.epoch += 1
		for (const [key, entry] of this.cache) {
			this.cache.set(key, { ...entry, fetchedAt: 0 })
		}
	}

	/** Cross-profile invalidation (active-profile switch). Unlike the
	 *  same-profile sweeps above, the cached values were computed under
	 *  ANOTHER profile's context (the private leg reads profile-filtered
	 *  FPCs), so they must not survive as peekable last-knowns — the new
	 *  profile would paint the old profile's figures dimmed. Evict outright. */
	public evictAll(): void {
		this.epoch += 1
		this.evictGeneration += 1
		this.cache.clear()
	}

	private async compute(
		cacheKey: string,
		networkId: string,
		accountAddress: string,
		epochAtStart: number,
		evictGenAtStart: number,
	): Promise<GasBalances> {
		const chainId = await this.deps.getChainId(networkId)
		const deps = await this.deps.getViewDeps(networkId, accountAddress)

		// Two invocations ON PURPOSE, launched concurrently. The public read
		// rides the direct-to-node fast arm while the PrivateFPC read executes
		// through PXE — different failure domains, so one leg's rejection must
		// never discard the other's result (a single shared batch would
		// shared-fate them and cache a fabricated "0"/null for the whole TTL).
		// Concurrency is the win over the old shape, which serialized the
		// private read behind the public round-trip.
		this.deps.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
		const readPublic = async (): Promise<string | null> => {
			const result = await batchedViewSimulation(
				[{ kind: "call", contract: feeJuiceAddress, method: "balance_of_public", args: [accountAddress] }],
				deps,
			)
			// A missing return slot or a thrown leg is UNKNOWN, never a
			// fabricated zero — consumers fail closed / render an em dash.
			return result.encoded[0]?.[0] ? result.encoded[0][0].toBigInt().toString() : null
		}
		const readPrivate = async (): Promise<string | null> => {
			const fpcs = await this.deps.getFpcs(chainId)
			const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
			if (!bridgedFpc) return null
			const result = await batchedViewSimulation(
				[{ kind: "call", contract: bridgedFpc.address, method: "balance_of", args: [accountAddress] }],
				deps,
			)
			return result.encoded[0]?.[0] ? result.encoded[0][0].toBigInt().toString() : null
		}
		const [publicLeg, privateLeg] = await Promise.all([
			this.legWithRetry("public", readPublic),
			this.legWithRetry("private", readPrivate),
		])
		const { value: publicFeeJuice } = publicLeg
		const { value: privateFeeJuice } = privateLeg
		this.deps.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)

		const result = { publicFeeJuice, privateFeeJuice }
		// An eviction that landed mid-compute means this snapshot belongs to
		// ANOTHER profile's context: return it to the (pre-switch) caller but
		// never write it back — a stale-marked write-back would still be
		// peekable under the new profile.
		if (this.evictGeneration !== evictGenAtStart) return result
		// Cache already-stale (fetchedAt: 0) when a stale-marking invalidation
		// landed mid-compute (it outranks this snapshot) OR when a leg FAILED —
		// a degraded snapshot must cost the next `get()` a recompute, not serve
		// its unknown for the full TTL (the cold-start "—" used to persist for
		// 5 minutes over a race the transport recovered from in under a second).
		const degraded = publicLeg.failed || privateLeg.failed
		this.cache.set(cacheKey, { result, fetchedAt: this.epoch === epochAtStart && !degraded ? Date.now() : 0 })
		return result
	}

	/** Run a leg; on a THROW, wait out the boot window and re-read once.
	 *  First failure logs at debug (the retry usually recovers it); only a
	 *  failed retry earns the error-level log the old single-shot always paid. */
	private async legWithRetry(label: "public" | "private", read: () => Promise<string | null>): Promise<LegOutcome> {
		try {
			return { value: await read(), failed: false }
		} catch (err) {
			this.deps.logDebug(`getGasBalances: ${label} FeeJuice leg failed, retrying once:`, getErrorMessage(err))
		}
		await new Promise((r) => setTimeout(r, this.deps.failedLegRetryDelayMs ?? GAS_BALANCE_FAILED_LEG_RETRY_DELAY_MS))
		try {
			return { value: await read(), failed: false }
		} catch (err) {
			this.deps.logError(`Failed to get ${label} FeeJuice balance`, getErrorMessage(err))
			return { value: null, failed: true }
		}
	}
}
