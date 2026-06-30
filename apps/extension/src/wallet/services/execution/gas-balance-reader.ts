/**
 * `GasBalanceReader` — the gas-balance (FeeJuice) readout subsystem,
 * extracted verbatim from the execution facade.
 *
 * Owns the `${networkId}:${accountAddress}`-keyed TTL cache, the
 * single-flight dedup (fresh popup opens fire several concurrent
 * readouts — FeeSettingsCard + GasBalanceCard — and each independently
 * triggered FPC discovery before the guard existed), and the two-call
 * compute (public FeeJuice via `balance_of_public`, private FeeJuice via
 * the PrivateFPC's `balance_of` when one is registered).
 *
 * Invalidation is owned by the FACADE's event subscriptions (settled-tx
 * per-account eviction; PrivateFPC mutation full clear) — registration
 * order in `init()` is load-bearing and stays there. The module exposes
 * the two eviction primitives those subscribers call.
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

	/** Settled-tx invalidation: evict every key for the account. */
	public invalidateAccount(account: string): void {
		for (const key of this.cache.keys()) {
			if (key.endsWith(`:${account}`)) {
				this.cache.delete(key)
			}
		}
	}

	/** PrivateFPC-mutation invalidation: the cache is keyed only by
	 *  `${networkId}:${account}`, so swapping the PrivateFPC address would
	 *  otherwise serve stale private-FJ readouts for up to the TTL.
	 *  Coarse but correct. */
	public clear(): void {
		this.cache.clear()
	}

	private async compute(cacheKey: string, networkId: string, accountAddress: string): Promise<GasBalances> {
		const chainId = await this.deps.getChainId(networkId)
		const deps = await this.deps.getViewDeps(networkId, accountAddress)

		// Public FeeJuice balance via balance_of_public on the FeeJuice contract
		this.deps.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
		let publicFeeJuice = "0"
		try {
			const publicResult = await batchedViewSimulation(
				[
					{
						kind: "call",
						contract: feeJuiceAddress,
						method: "balance_of_public",
						args: [accountAddress],
					},
				],
				deps,
			)
			if (publicResult.encoded[0]?.[0]) {
				publicFeeJuice = publicResult.encoded[0][0].toBigInt().toString()
			}
		} catch (err) {
			this.deps.logDebug(`getGasBalances: Failed to get public FeeJuice balance:`, getErrorMessage(err))
			this.deps.logError("Failed to get public FeeJuice balance", getErrorMessage(err))
		}
		this.deps.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}`)

		// Private FeeJuice balance via balance_of on PrivateFPC
		let privateFeeJuice: string | null = null
		try {
			const fpcs = await this.deps.getFpcs(chainId)
			const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
			if (bridgedFpc) {
				const privateResult = await batchedViewSimulation(
					[
						{
							kind: "call",
							contract: bridgedFpc.address,
							method: "balance_of",
							args: [accountAddress],
						},
					],
					deps,
				)
				if (privateResult.encoded[0]?.[0]) {
					privateFeeJuice = privateResult.encoded[0][0].toBigInt().toString()
				}
			}
		} catch (err) {
			this.deps.logDebug(`getGasBalances: Failed to get private FeeJuice balance:`, getErrorMessage(err))
			this.deps.logError("Failed to get private FeeJuice balance", getErrorMessage(err))
		}
		this.deps.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)

		const result = { publicFeeJuice, privateFeeJuice }
		this.cache.set(cacheKey, { result, fetchedAt: Date.now() })
		return result
	}
}
