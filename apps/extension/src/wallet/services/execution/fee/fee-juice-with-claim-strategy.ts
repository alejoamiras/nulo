/**
 * `FeeJuiceWithClaimStrategy` — FeeJuice with an L1→L2 claim payload
 * prepended (kind `"fjwc"`). Single-pass, same shape as `"fj"` but with
 * the claim payload injected into `op.actions` before building.
 *
 * Mutates `ctx.op.actions` via `unshift` — caller is expected to clone
 * before dispatch (the facade does this).
 */

import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { getFeeJuiceClaimPayload } from "@/wallet/utils/fee-juice"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { finalizeGasLimits, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class FeeJuiceWithClaimStrategy implements FeeStrategy {
	public readonly kind = "fjwc" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		if (ctx.feeSettings.paymentMethod.kind !== "fjwc") {
			throw new Error("FeeJuiceWithClaimStrategy called with non-fjwc payment method")
		}
		const { claimAmount, claimSecret, messageLeafIndex } = ctx.feeSettings.paymentMethod
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)
		try {
			ctx.op.actions.unshift(...getFeeJuiceClaimPayload(ctx.op.accountAddress, claimAmount, claimSecret, messageLeafIndex))
			const built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM, task)
			const { txRequest, node, pxe, account } = built
			suggestGasLimits(txRequest, ctx.op.fee)
			const simulatedTx = await this.deps.simulateTxTask(
				pxe,
				txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] },
				task,
			)
			await finalizeGasLimits(node, txRequest, simulatedTx, ctx.gasPadding, undefined, ctx.op.fee, ctx.feeMultiplier, built.txsLimits)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
