/**
 * FpcStrategy — external FPC (Fee Payment Contract) fee payment (kind "fpc").
 *
 * Two-pass estimation:
 *   Pass 1: build + simulate with FeeJuice to get total gas used
 *   Between: fetch baseFees (with priority multiplier), compute maxFee,
 *     prepend FPC fee payload to op.actions
 *   Pass 2: re-build + re-simulate with External + override gasSettings
 *   Finish: re-compute maxFee with padded gas, splice in final fee payload
 *
 * ## Action array mutation (CAUTION — audited)
 *
 * The FPC 2-pass path mutates `op.actions` twice: once via `unshift`
 * after Pass 1, once via `splice(0, op.actions.length, ...)` after Pass 2.
 * The final splice preserves `originalActions` captured before Pass 1's
 * mutation. This sequence is intentional and load-bearing — the audit
 * flagged it explicitly. Do NOT refactor to a non-mutating shape
 * without re-verifying the TxExecutionRequest bytes match the original
 * pipeline.
 *
 * The `originalActions` capture + restore sequence is intentional and
 * load-bearing — preserves the pre-strategy tx-request bytes verbatim.
 */

import { GasSettings } from "@aztec/stdlib/gas"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { predictedWorstMinFees } from "@nulo/bridge-core/fee-juice"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { DEFAULT_FEE_MULTIPLIER, finalizeGasLimits, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class FpcStrategy implements FeeStrategy {
	public readonly kind = "fpc" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		if (ctx.feeSettings.paymentMethod.kind !== "fpc") {
			throw new Error("FpcStrategy called with non-fpc payment method")
		}
		const { fpcId } = ctx.feeSettings.paymentMethod
		const fpc = await this.deps.fpcService.getFpcImpl(fpcId)
		const originalActions = [...ctx.op.actions]
		const multiplier = ctx.feeMultiplier ?? DEFAULT_FEE_MULTIPLIER
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)

		try {
			// first approach
			let built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE, task)
			suggestGasLimits(built.txRequest, ctx.op.fee)
			let simulatedTx = await this.deps.simulateTxTask(
				built.pxe,
				built.txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] },
				task,
			)
			// Fetch actual fees for FPC fee payload (with priority multiplier). Same
			// inclusion-safe predicted-worst basis as `finalizeGasLimits`.
			const baseFees = (await predictedWorstMinFees(built.node)).mul(multiplier)
			let maxFee = simulatedTx.gasUsed.totalGas.add(fpc.getTotalGas()).computeFee(baseFees)
			ctx.op.actions.unshift(...fpc.getFeePayload(ctx.op.accountAddress, maxFee))
			// precise estimation (rebuild — the rebinding of `built` is the
			// two-pass shape the byte-parity constraint freezes; the
			// gasSettings below deliberately reads the FIRST pass's sim)
			built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.EXTERNAL, task)
			built.txRequest.txContext.gasSettings = new GasSettings(
				simulatedTx.gasUsed.totalGas.add(fpc.getTotalGas()),
				simulatedTx.gasUsed.teardownGas.add(fpc.getTeardownGas()),
				baseFees,
				built.txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
			)
			simulatedTx = await this.deps.simulateTxTask(
				built.pxe,
				built.txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] },
				task,
			)
			maxFee = simulatedTx.gasUsed.totalGas.mul(ctx.gasPadding).computeFee(baseFees)
			ctx.op.actions.splice(0, ctx.op.actions.length, ...fpc.getFeePayload(ctx.op.accountAddress, maxFee), ...originalActions)
			await finalizeGasLimits(built.node, built.txRequest, simulatedTx, ctx.gasPadding, baseFees)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
