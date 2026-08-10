/**
 * `DiscoveryAwareEstimator` — the ONE owner of "discover authwits, then
 * estimate" for the dApp send paths. Owned and invoked exclusively by
 * `DappSendExecutor`; the Send-page transfer flow and `executeSendTransaction`
 * use the probe-free validated pipeline and can never reach this class (the
 * split, distinctly-typed deps are the fence — audited constraint).
 *
 * TWO PIPELINES, routed per-op in `estimate`:
 * - CLASSIC (standalone stubbed discovery sim → splice discovered actions →
 *   validated strategy pipeline) — the pre-fold choreography, kept verbatim
 *   for every op the fold rules exclude.
 * - FOLDED (strategy's first sim runs stubbed with a `CollectingDiscoveryProbe`
 *   and doubles as discovery) — B1-gated at 0.00% stub-vs-validated gas delta
 *   on live testnet; discovered effects force a validated rebuild so fresh
 *   witnesses are verified before any estimate leaves the pipeline.
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
import { CollectingDiscoveryProbe } from "./discovery-probe"
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
	/** The FOLDED pipeline — same strategy dispatch with `ctx.probe` set, so a
	 *  probe-aware strategy runs its first sim stubbed and discovery collapses
	 *  into it. Reached only through the fold routing below. */
	buildAndEstimateFolded(
		inputOp: { networkId: string; accountAddress: string; actions: Action[]; fee?: FeeOptions },
		feeSettings: FeeSettings,
		probe: DiscoveryProbe,
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
	 *
	 * Routing: fold-eligible ops take the FOLDED pipeline (the strategy's
	 * first sim runs stubbed and doubles as discovery — one sim saved);
	 * everything else keeps the classic standalone-discovery choreography.
	 * Fold eligibility is deliberately narrow:
	 * - `fpc` and `fj` payment kinds (both B1-gated at 0.00% stub delta).
	 *   `fjwc` (claim-coupled setup phase) and `embedded` (dApp-budget
	 *   semantics) keep the classic choreography.
	 * - NO pre-attached `add_private_authwit` action of ANY content kind (the
	 *   F-4 rule): a stubbed sim accepts every witness unconditionally, so it
	 *   would mask a broken pre-supplied witness that the validated pipeline
	 *   fails loudly on — intent-authwit-carrying ops NEVER take a fold.
	 */
	public async estimate(
		operation: Operation,
		actions: readonly Action[],
		detectedFee: FeeOptions | undefined,
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
	): Promise<DiscoveryEstimateResult> {
		const hasPreAttachedAuthwit = actions.some((a) => a.kind === "add_private_authwit")
		const foldableKind = feeSettings.paymentMethod.kind === "fpc" || feeSettings.paymentMethod.kind === "fj"
		if (foldableKind && !hasPreAttachedAuthwit) {
			const probe = new CollectingDiscoveryProbe()
			const op = {
				...operation,
				actions: [...actions],
				...(detectedFee ? { fee: detectedFee } : {}),
			} as SendTransactionOperation
			const built = await this.deps.buildAndEstimateFolded(op, feeSettings, probe, parentTask, signal)
			return { built, discoveredActions: [...probe.collected] }
		}

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
