/**
 * Operation validation helpers for the dApp Execute approval window.
 *
 * Bridges popup draft state (where send-like `feeSettings` may be
 * undefined because the user hasn't picked one yet) to the executable
 * `Operation` shape the SW expects.
 *
 * Kept in a plain `.ts` (not the SFC) so it's unit-testable without a
 * Vue test harness.
 *
 * - `requiresFeeSelection` is the UX gate the approve handler runs
 *   BEFORE attempting to execute. If any op needs the user to pick a
 *   fee method first, the popup shows a validation error and the
 *   operations array never leaves the popup.
 *
 * - `assertExecutableOperation` is a TypeScript assertion function that
 *   narrows a `DraftOperation` to `Operation`. Called AFTER the
 *   `requiresFeeSelection` gate has guaranteed everything is ready,
 *   it lets the compiler verify the eventual `as Operation` cast is
 *   honest.
 */

import type { Operation } from "@nulo/wallet-bridge"
import type { DraftOperation } from "./types"

/**
 * True iff `op` is a send-like operation that still needs the user to
 * pick a fee payment method.
 *
 * Legitimate "no fee needed" cases the predicate treats as ready:
 *  - `send_transaction` with `op.fee?.embeddedFeePayment` set (dApp
 *    embeds the fee call).
 *  - `aztec_sendTx` with `executionMode === "default_entrypoint"` — the
 *    dApp uses the default entrypoint which handles its own fee path;
 *    the popup pre-fills `feeSettings: { paymentMethod: { kind: "embedded" } }`
 *    for these rows so they wouldn't fail this check anyway.
 *  - `aztec_sendTx` with `exec.feePayer` set — same shape; embedded.
 *
 * Non-send kinds (register / simulate / read-only) never need fee selection.
 *
 * NB on the `default_entrypoint` asymmetry (documented in
 * `phase-2-followup-feesettings/plan.md`): `isConfirmationNeeded` in
 * `dapp-interaction/service.ts:379-387` routes `default_entrypoint` ops
 * to the popup (user confirmation required), but the popup treats them
 * as "no fee UI" because the dApp handles fee payment. Both are correct;
 * the asymmetry is split across two files.
 */
export function requiresFeeSelection(op: DraftOperation): boolean {
	if (op.kind === "send_transaction") {
		return op.feeSettings === undefined && op.fee?.embeddedFeePayment === undefined
	}
	if (op.kind === "aztec_sendTx") {
		const isNoFrom = op.executionMode === "default_entrypoint"
		const hasEmbeddedFeePayer = op.exec?.feePayer !== undefined
		return op.feeSettings === undefined && !isNoFrom && !hasEmbeddedFeePayer
	}
	return false
}

/**
 * TS assertion: narrows a {@link DraftOperation} to the executable
 * `Operation` shape.
 *
 * Throws if the operation isn't ready. Caller MUST run
 * {@link requiresFeeSelection} first so the user sees an attributable
 * validation error rather than a thrown exception.
 *
 * After this assertion, the TypeScript compiler treats the value as
 * `Operation` — the `as Operation` cast at the approve handler is no
 * longer a lie.
 */
export function assertExecutableOperation(op: DraftOperation): asserts op is Operation {
	if ((op.kind === "send_transaction" || op.kind === "aztec_sendTx") && op.feeSettings === undefined) {
		throw new Error(`assertExecutableOperation: ${op.kind} is missing feeSettings`)
	}
}
