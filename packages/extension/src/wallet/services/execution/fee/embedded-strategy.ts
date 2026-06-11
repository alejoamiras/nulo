/**
 * `EmbeddedStrategy` — dApp's own FPC pre-embedded in `ExecutionPayload`
 * (kind `"embedded"`). The dApp has already set `feePayer` in the
 * payload; no Nulo-side fee-payload injection required.
 *
 * Fee-cap quirk: see `applyEmbeddedFpcGasCap` JSDoc in `embedded-fpc-cap.ts`
 * for the full rationale. Short version — `completeFeeOptions`'s default
 * `1.5× minFees` over-budgets the dApp's FPC; we cap to `1.0×` so the FPC
 * assertion (`gasLimits * maxFeesPerGas <= budgetedAmount`) passes for
 * dApps following upstream-recommended fee patterns (FeeJuicePaymentMethod-
 * WithClaim, sponsored-FPC with claim_and_end_setup).
 */

import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { applyEmbeddedFpcGasCap } from "./embedded-fpc-cap"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { finalizeGasLimits, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class EmbeddedStrategy implements FeeStrategy {
	public readonly kind = "embedded" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		if (!ctx.op.fee?.embeddedFeePayment) {
			throw new Error("Embedded fee payment not specified")
		}
		const embeddedMethod =
			ctx.op.fee.embeddedFeePayment === "fjwc"
				? AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
				: AccountFeePaymentMethodOptions.EXTERNAL
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)

		try {
			const { txRequest, node, pxe, account, network, nonce, txCalls } = await this.deps.txBuilder.buildStandard(
				ctx.op,
				embeddedMethod,
				task,
			)
			suggestGasLimits(txRequest, ctx.op.fee)
			await applyEmbeddedFpcGasCap(txRequest, ctx.op.fee, node)
			const simulatedTx = await this.deps.simulateTxTask(
				pxe,
				txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] },
				task,
			)
			// Use 1x multiplier so max_gas_cost stays within the dApp's embedded amount.
			await finalizeGasLimits(node, txRequest, simulatedTx, ctx.gasPadding, undefined, ctx.op.fee, 1)
			task.complete()
			return { txRequest, node, pxe, account, network, nonce, txCalls, feePaymentMethod: embeddedMethod }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
