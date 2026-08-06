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

export interface GasBalanceReaderDeps {
	getChainId(networkId: string): Promise<number>
	getViewDeps(networkId: string, accountAddress: string): Promise<BatchedViewSimulationDeps>
	getFpcs(chainId: number): Promise<FpcInfo[]>
	logDebug(msg: string, ...rest: unknown[]): void
	logError(msg: string, ...rest: unknown[]): void
}

export class GasBalanceReader {
	private cache = new Map<string, { result: GasBalances; fetchedAt: number }>()
	/** Single-flight dedup for concurrent callers of the same key. */
	private inFlight = new Map<string, Promise<GasBalances>>()
	/** Bumped on every invalidation. A compute that started before the bump
	 *  caches its snapshot already-stale, so it can still be peeked (dimmed)
	 *  but the next `get` recomputes. Global on purpose: over-staling a
	 *  sibling account's concurrent compute costs one extra recompute and
	 *  keeps the bookkeeping trivial. */
	private epoch = 0

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
			if (!forceRefresh) {
				this.deps.logDebug(`getGasBalances: dedup — awaiting in-flight request for ${cacheKey}`)
				return inFlight
			}
			// A forced read must not JOIN a flight that may predate the
			// invalidation that triggered it (post-settlement caller, pre-
			// settlement snapshot). Wait it out, then re-enter: the epoch
			// stamp has marked that flight's cache entry stale, so re-entry
			// recomputes; if someone already restarted, their flight is joined.
			const reenter = () => this.get(networkId, accountAddress, false)
			return inFlight.then(reenter, reenter)
		}
		const pending = this.compute(cacheKey, networkId, accountAddress).finally(() => {
			this.inFlight.delete(cacheKey)
		})
		this.inFlight.set(cacheKey, pending)
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

	private async compute(cacheKey: string, networkId: string, accountAddress: string): Promise<GasBalances> {
		const chainId = await this.deps.getChainId(networkId)
		const deps = await this.deps.getViewDeps(networkId, accountAddress)
		const epochAtStart = this.epoch

		// Two invocations ON PURPOSE, launched concurrently. The public read
		// rides the direct-to-node fast arm while the PrivateFPC read executes
		// through PXE — different failure domains, so one leg's rejection must
		// never discard the other's result (a single shared batch would
		// shared-fate them and cache a fabricated "0"/null for the whole TTL).
		// Concurrency is the win over the old shape, which serialized the
		// private read behind the public round-trip.
		this.deps.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
		const publicPromise = (async (): Promise<string | null> => {
			try {
				const result = await batchedViewSimulation(
					[{ kind: "call", contract: feeJuiceAddress, method: "balance_of_public", args: [accountAddress] }],
					deps,
				)
				// A missing return slot or a thrown leg is UNKNOWN, never a
				// fabricated zero — consumers fail closed / render an em dash.
				return result.encoded[0]?.[0] ? result.encoded[0][0].toBigInt().toString() : null
			} catch (err) {
				this.deps.logDebug(`getGasBalances: Failed to get public FeeJuice balance:`, getErrorMessage(err))
				this.deps.logError("Failed to get public FeeJuice balance", getErrorMessage(err))
				return null
			}
		})()
		const privatePromise = (async (): Promise<string | null> => {
			try {
				const fpcs = await this.deps.getFpcs(chainId)
				const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
				if (!bridgedFpc) return null
				const result = await batchedViewSimulation(
					[{ kind: "call", contract: bridgedFpc.address, method: "balance_of", args: [accountAddress] }],
					deps,
				)
				return result.encoded[0]?.[0] ? result.encoded[0][0].toBigInt().toString() : null
			} catch (err) {
				this.deps.logDebug(`getGasBalances: Failed to get private FeeJuice balance:`, getErrorMessage(err))
				this.deps.logError("Failed to get private FeeJuice balance", getErrorMessage(err))
				return null
			}
		})()
		const [publicFeeJuice, privateFeeJuice] = await Promise.all([publicPromise, privatePromise])
		this.deps.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)

		const result = { publicFeeJuice, privateFeeJuice }
		// An invalidation that landed mid-compute outranks this snapshot:
		// cache it already-stale so peek can serve it dimmed but the next
		// get recomputes.
		this.cache.set(cacheKey, { result, fetchedAt: this.epoch === epochAtStart ? Date.now() : 0 })
		return result
	}
}
