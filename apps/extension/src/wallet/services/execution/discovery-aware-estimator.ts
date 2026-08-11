/**
 * `DiscoveryAwareEstimator` — the ONE owner of "discover authwits, then
 * estimate" for the dApp send paths. Owned and invoked exclusively by
 * `DappSendExecutor`; the Send-page transfer flow and `executeSendTransaction`
 * use the probe-free validated pipeline and can never reach this class (the
 * split, distinctly-typed deps are the fence — audited constraint).
 *
 * CURRENT SHAPE — INERT EXTRACTION: this replicates the previous inline
 * choreography byte-for-byte (standalone stubbed app-only discovery sim →
 * splice discovered actions → validated strategy pipeline). The folded
 * single-sim modes land behind the testnet measurement gates; until then the
 * probe below is CONSTRUCTED but no strategy consumes it, and every sizing
 * sim stays validated. The structural pins prove inertness at the
 * sim-OPTIONS level, not just call counts.
 *
 * `DiscoveryProbe` is deliberately CHAIN-BOUND (this exact one-argument
 * "pure extractor" was proven impossible twice — message hashing needs live
 * `nodeInfo` behind `assertLiveChainIdentity`, fetched lazily ONLY when
 * effects exist; see the fee-estimation-speedup ledger #11 and this plan's
 * audit round 1). Dropping the live-chain assert would weaken authwit-hash
 * derivation against a drifted RPC — it is pinned as preserved.
 */

import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import type { WrappedTask } from "@/wallet/services/task/service"
import type { AuthwitDiscoverer } from "./authwit-discoverer"
import type { FeeEstimate } from "./fee/fee-strategy"
import type { Action, AddPrivateAuthwitAction, FeeOptions, FeeSettings, Operation, SendTransactionOperation } from "./spec"

/** Chain-bound extraction capability handed to folded strategies (unused by
 *  any strategy in the inert shape). `built` carries the live node + network
 *  the hashing must be asserted against. */
export interface DiscoveryProbe {
	extractEffects(sim: unknown, ctx: { node: FeeEstimate["node"]; network: FeeEstimate["network"] }): Promise<AddPrivateAuthwitAction[]>
}

export interface DiscoveryAwareEstimatorDeps {
	authwit: AuthwitDiscoverer
	/** The probe-free validated pipeline (the service's strategy map). */
	buildAndEstimateValidated(
		inputOp: { networkId: string; accountAddress: string; actions: Action[]; fee?: FeeOptions },
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
	): Promise<FeeEstimate>
	/** Discovery's throwaway build — same callback shape the discoverer has
	 *  always been fed (hardcoded PREEXISTING_FEE_JUICE inside). */
	buildForDiscovery: Parameters<AuthwitDiscoverer["discoverPrivateAuthwits"]>[1]
}

export interface DiscoveryEstimateResult {
	built: FeeEstimate
	/** Actions discovery added — surfaced so the executor keeps its existing
	 *  splice/record bookkeeping unchanged. */
	discoveredActions: AddPrivateAuthwitAction[]
}

export class DiscoveryAwareEstimator {
	public constructor(private readonly deps: DiscoveryAwareEstimatorDeps) {}

	/**
	 * Discover-then-estimate for a send-like dApp operation. `actions` is the
	 * post-planner set; the caller keeps its own pre-discovery snapshot (the
	 * reuse-fingerprint normalization point) — this method never mutates the
	 * caller's array.
	 */
	public async estimate(
		operation: Operation,
		actions: readonly Action[],
		detectedFee: FeeOptions | undefined,
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
	): Promise<DiscoveryEstimateResult> {
		const discoveredActions = await this.deps.authwit.discoverPrivateAuthwits(
			{ ...operation, actions: [...actions] } as SendTransactionOperation,
			this.deps.buildForDiscovery,
		)
		// Stage boundary preserved from the inline shape: a cancel landing
		// during discovery must not start the sizing pipeline.
		if (signal?.aborted) throw new JobCancelledSentinel("")
		const finalActions = discoveredActions.length ? [...actions, ...discoveredActions] : [...actions]
		const op = {
			...operation,
			actions: finalActions,
			...(detectedFee ? { fee: detectedFee } : {}),
		} as SendTransactionOperation
		const built = await this.deps.buildAndEstimateValidated(op, feeSettings, parentTask, signal)
		return { built, discoveredActions }
	}
}
