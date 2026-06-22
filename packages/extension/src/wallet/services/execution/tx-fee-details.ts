/**
 * Projections from a finalized `TxExecutionRequest`'s gas settings to the
 * wire shapes the activity record and fee-estimate responses carry.
 * Extracted from the execution facade so the executor modules share one
 * copy — and so the projection math is unit-pinned (it reads the same
 * same-typed gasSettings slots the structural fee fixtures guard).
 */

import type { TxExecutionRequest } from "@aztec/stdlib/tx"
import { computeMaxFee } from "@/utils/fee-estimation"
import type { TxGasDetails } from "@/wallet/services/transaction/spec"

/** Extract estimated fee from finalized gas settings on a TxExecutionRequest. */
export function getEstimatedFee(txRequest: TxExecutionRequest): string {
	const gs = txRequest.txContext.gasSettings
	return computeMaxFee(
		{ daGas: gs.gasLimits.daGas, l2Gas: gs.gasLimits.l2Gas },
		{ daGas: gs.teardownGasLimits.daGas, l2Gas: gs.teardownGasLimits.l2Gas },
		{ feePerDaGas: gs.maxFeesPerGas.feePerDaGas, feePerL2Gas: gs.maxFeesPerGas.feePerL2Gas },
	).toString()
}

/** Extract gas breakdown from finalized gas settings. */
export function getGasDetails(txRequest: TxExecutionRequest): TxGasDetails {
	const gs = txRequest.txContext.gasSettings
	return {
		l2GasLimit: gs.gasLimits.l2Gas,
		daGasLimit: gs.gasLimits.daGas,
		teardownL2GasLimit: gs.teardownGasLimits.l2Gas,
		teardownDaGasLimit: gs.teardownGasLimits.daGas,
		feePerL2Gas: gs.maxFeesPerGas.feePerL2Gas.toString(),
		feePerDaGas: gs.maxFeesPerGas.feePerDaGas.toString(),
	}
}
