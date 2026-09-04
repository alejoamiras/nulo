/**
 * Draft → executable `Operation` narrowing, shared by the dApp-interaction
 * materializer (silent path) and the popup Execute window (confirm path).
 *
 * The executable `Operation` requires `feeSettings` on the two send-like kinds;
 * a `DraftOperation` has it optional. These helpers bridge the gap WITHOUT an
 * `as unknown as Operation` cast:
 *   - `requiresFeeSelection` — the UX gate the popup runs before executing; if a
 *     send-like still needs the user to pick a fee method, the row never leaves
 *     the popup.
 *   - `assertExecutableOperation` — a TS assertion that narrows `DraftOperation`
 *     to `Operation` (throws if a send-like reached it with no `feeSettings`),
 *     so the compiler treats the value as executable afterwards.
 *
 * `Operation` itself is deliberately NOT loosened — it stays the strict executable
 * contract everywhere else.
 */

import { isSelfPay } from "./fee-payer"
import type { DraftOperation, Operation } from "./operation"

/**
 * True iff `op` is a send-like operation that still needs the user to pick a fee
 * payment method. Legitimate "no fee needed" send-likes (embedded fee payment, or
 * `aztec_sendTx` default-entrypoint / an `exec.feePayer` that carries the payment) are
 * treated as ready. A payer that is the account itself with no fee call is a requested
 * self-pay: the payload carries no payment, so its fee settings must exist like any other.
 * Non-send kinds never need fee selection.
 */
export function requiresFeeSelection(op: DraftOperation): boolean {
	if (op.kind === "send_transaction") {
		return op.feeSettings === undefined && op.fee?.embeddedFeePayment === undefined
	}
	if (op.kind === "aztec_sendTx") {
		const isNoFrom = op.executionMode === "default_entrypoint"
		const hasEmbeddedFeePayer = op.exec?.feePayer !== undefined && !isSelfPay(op.exec, op.opts?.from)
		return op.feeSettings === undefined && !isNoFrom && !hasEmbeddedFeePayer
	}
	return false
}

/**
 * TS assertion: narrows a {@link DraftOperation} to the executable `Operation`.
 * Throws if a send-like reached this point with no `feeSettings` — a drift alarm
 * (the popup's `requiresFeeSelection` gate, or the silent path's
 * `isConfirmationNeeded`, should have guaranteed it). After this assertion the
 * compiler treats the value as `Operation`.
 */
export function assertExecutableOperation(op: DraftOperation): asserts op is Operation {
	if ((op.kind === "send_transaction" || op.kind === "aztec_sendTx") && op.feeSettings === undefined) {
		throw new Error(`assertExecutableOperation: ${op.kind} is missing feeSettings`)
	}
}
