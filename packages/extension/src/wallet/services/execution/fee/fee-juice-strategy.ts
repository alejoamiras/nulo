/**
 * `FeeJuiceStrategy` — plain FeeJuice fee payment (kind `"fj"`).
 *
 * Single-pass: build → simulate (`skipFeeEnforcement`) → finalize.
 * No fee-payload injection, no pre-simulation gas fiddling.
 */

import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { finalizeGasLimits, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class FeeJuiceStrategy implements FeeStrategy {
	public readonly kind = "fj" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)
		try {
			const built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE, task)
			const { txRequest, node, pxe, account } = built
			suggestGasLimits(txRequest, ctx.op.fee)
			const simulatedTx = await this.deps.simulateTxTask(
				pxe,
				txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] },
				task,
			)
			await finalizeGasLimits(node, txRequest, simulatedTx, ctx.gasPadding, undefined, ctx.op.fee, ctx.feeMultiplier)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
