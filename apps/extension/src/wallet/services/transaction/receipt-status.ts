import { TxStatus as AztecTxStatus, TxExecutionResult as AztecTxExecutionResult } from "@aztec-labs/stdlib/tx"
import { TxExecutionResult, TxStatus } from "./spec"

export function txStatusFromReceipt(status: AztecTxStatus): TxStatus {
	switch (status) {
		case AztecTxStatus.PENDING:
			return TxStatus.Pending
		case AztecTxStatus.DROPPED:
			return TxStatus.Dropped
		case AztecTxStatus.PROPOSED:
			return TxStatus.Proposed
		case AztecTxStatus.CHECKPOINTED:
			return TxStatus.Checkpointed
		case AztecTxStatus.PROVEN:
			return TxStatus.Proven
		case AztecTxStatus.FINALIZED:
			return TxStatus.Finalized
		default:
			throw new Error("unknown tx status")
	}
}

export function executionResultFromReceipt(result: AztecTxExecutionResult | undefined): TxExecutionResult | undefined {
	if (!result) return undefined
	switch (result) {
		case AztecTxExecutionResult.SUCCESS:
			return TxExecutionResult.Success
		// 5.0 collapsed the three revert variants (app-logic / teardown / both) into one
		// REVERTED. Map it to AppLogicReverted as the catch-all "reverted" label; the Nulo
		// enum's TeardownReverted/BothReverted are now unreachable (follow-up: collapse + UI review).
		case AztecTxExecutionResult.REVERTED:
			return TxExecutionResult.AppLogicReverted
		default:
			return undefined
	}
}
