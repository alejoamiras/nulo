/**
 * `FeeJuiceStrategy` — plain FeeJuice fee payment (kind `"fj"`).
 *
 * Single-pass: build → simulate (`skipFeeEnforcement`) → finalize.
 * No fee-payload injection, no pre-simulation gas fiddling.
 *
 * Under a probe (dApp estimate fold), the sim runs STUBBED and doubles as
 * authwit discovery: no effects ⇒ done in ONE sim (stub gas == validated gas,
 * the measured B1 invariant); discovered effects ⇒ VALIDATED rebuild + re-sim
 * so the freshly signed witnesses are verified before the estimate leaves.
 */

import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import type { Action } from "../spec"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { finalizeGasLimits, isInitWrapped, probedFirstSimOpts, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class FeeJuiceStrategy implements FeeStrategy {
	public readonly kind = "fj" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)
		try {
			let built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE, task)
			suggestGasLimits(built.txRequest, ctx.op.fee)
			let simulatedTx = await this.deps.simulateTxTask(built.pxe, built.txRequest, probedFirstSimOpts(ctx.probe, built), task)
			let discovered: Action[] = []
			if (ctx.probe) {
				discovered = await ctx.probe.extractEffects(simulatedTx, { node: built.node, network: built.network })
				// Discovered effects OR an init-wrapped build force a validated
				// rebuild+re-sim: effects so the witnesses are VERIFIED; init-wrap
				// because the stub's constructor gas is untrustworthy (B1 exclusion).
				if (discovered.length || isInitWrapped(built)) {
					if (discovered.length) ctx.op.actions.push(...discovered)
					if (ctx.signal?.aborted) throw new JobCancelledSentinel("")
					built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE, task)
					suggestGasLimits(built.txRequest, ctx.op.fee)
					simulatedTx = await this.deps.simulateTxTask(
						built.pxe,
						built.txRequest,
						{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] },
						task,
					)
				}
			}
			await finalizeGasLimits(
				built.node,
				built.txRequest,
				simulatedTx,
				ctx.gasPadding,
				undefined,
				ctx.op.fee,
				ctx.feeMultiplier,
				built.txsLimits,
			)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
