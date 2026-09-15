/**
 * The only popup input the service worker accepts per approved operation.
 * Everything else — the calls, the signer, the execution mode, the payload — is
 * re-materialized from the dApp's stored request, so a buggy or compromised
 * popup can pick a fee method within the requested fee path and hand back the
 * SW-minted ids it was given, and nothing more.
 */

import type { DraftOperation, FeeSettings, Operation } from "@nulo/wallet-bridge"
import { assertExecutableOperation, isSelfPay, requiresFeeSelection } from "@nulo/wallet-bridge"

export type OperationApprovalDelta = {
	/** The user's fee choice. Read only for send-likes that need one. */
	readonly feeSettings?: FeeSettings
	/** Estimate→confirm reuse id the SW returned for this operation. */
	readonly estimateId?: string
	/** Preview-snapshot id the SW returned for this operation. */
	readonly previewId?: string
}

/** True when the request names the account itself as payer: the wallet pays from held Fee Juice. */
function isRequestedSelfPay(op: DraftOperation): boolean {
	return op.kind === "aztec_sendTx" && isSelfPay(op.exec, op.opts?.from)
}

/**
 * Complete a materialized draft with the popup's fee choice, field by field.
 * A send-like whose request already fixes its fee path keeps it (the delta is
 * ignored); one that needs a choice accepts only a method on the requested
 * path — Fee Juice alone for a requested self-pay, any selectable method
 * otherwise. Non-send kinds never read the delta.
 */
export function applyFeeSelection(op: DraftOperation, feeSettings: FeeSettings | undefined): Operation {
	if (op.kind !== "aztec_sendTx" && op.kind !== "send_transaction") {
		assertExecutableOperation(op)
		return op
	}
	if (!requiresFeeSelection(op)) {
		assertExecutableOperation(op)
		return op
	}
	if (!feeSettings) throw new Error("Select a fee payment method for each transaction")
	const kind = feeSettings.paymentMethod.kind
	if (kind === "embedded") throw new Error("Fee payment method is not selectable for this request")
	if (isRequestedSelfPay(op) && kind !== "fj") throw new Error("This request pays its own fee with Fee Juice")
	const completed = { ...op, feeSettings }
	assertExecutableOperation(completed)
	return completed
}
