/**
 * `GasBalanceReader` — the gas-balance (FeeJuice) readout subsystem,
 * extracted verbatim from the execution facade.
 *
 * Owns the `${networkId}:${accountAddress}`-keyed TTL cache, the
 * single-flight dedup (fresh popup opens fire several concurrent
 * readouts — FeeSettingsCard + GasBalanceCard — and each independently
 * triggered FPC discovery before the guard existed), and the ONE-batched
 * compute (public FeeJuice via `balance_of_public` leading — fast-arm
 * eligible — plus the PrivateFPC's `balance_of` when one is registered,
 * in a single `batchedViewSimulation` invocation).
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
			this.deps.logDebug(`getGasBalances: dedup — awaiting in-flight request for ${cacheKey}`)
			return inFlight
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
		for (const [key, entry] of this.cache) {
			this.cache.set(key, { ...entry, fetchedAt: 0 })
		}
	}

	private async compute(cacheKey: string, networkId: string, accountAddress: string): Promise<GasBalances> {
		const chainId = await this.deps.getChainId(networkId)
		const deps = await this.deps.getViewDeps(networkId, accountAddress)

		// PrivateFPC discovery FIRST so both reads ride one batched simulation.
		// Two separate invocations paid the block-anchor setup twice and
		// serialized the private read behind the public round-trip; the batch
		// keeps `balance_of_public` leading so it stays fast-arm eligible
		// (direct-to-node prefix — see batched-view-simulation.ts).
		this.deps.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
		let bridgedFpc: FpcInfo | undefined
		try {
			const fpcs = await this.deps.getFpcs(chainId)
			bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
		} catch (err) {
			this.deps.logDebug(`getGasBalances: FPC discovery failed, reading public only:`, getErrorMessage(err))
		}

		let publicFeeJuice = "0"
		let privateFeeJuice: string | null = null
		try {
			const result = await batchedViewSimulation(
				[
					{ kind: "call", contract: feeJuiceAddress, method: "balance_of_public", args: [accountAddress] },
					...(bridgedFpc
						? [{ kind: "call" as const, contract: bridgedFpc.address, method: "balance_of", args: [accountAddress] }]
						: []),
				],
				deps,
			)
			if (result.encoded[0]?.[0]) {
				publicFeeJuice = result.encoded[0][0].toBigInt().toString()
			}
			if (bridgedFpc && result.encoded[1]?.[0]) {
				privateFeeJuice = result.encoded[1][0].toBigInt().toString()
			}
		} catch (err) {
			this.deps.logDebug(`getGasBalances: batched FeeJuice balance read failed:`, getErrorMessage(err))
			this.deps.logError("Failed to read FeeJuice balances", getErrorMessage(err))
		}
		this.deps.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)

		const result = { publicFeeJuice, privateFeeJuice }
		this.cache.set(cacheKey, { result, fetchedAt: Date.now() })
		return result
	}
}
