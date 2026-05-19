/**
 * Embedded-FPC `maxFeesPerGas` cap.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY THIS HELPER EXISTS (read this before deleting it)
 * ─────────────────────────────────────────────────────────────────
 *
 * Nulo's standard tx pipeline calls `completeFeeOptions({forEstimation:true})`
 * (in `@nulo/aztec-runtime/account/fee-options.ts`) which mirrors upstream
 * `BaseWallet.completeFeeOptions` byte-for-byte: when the dApp doesn't
 * supply `maxFeesPerGas`, the default is `node.getCurrentMinFees().mul(1.5)`
 * — i.e. minFees with a 50% safety padding (upstream's `minFeePadding = 0.5`).
 *
 * That `1.5×` default is correct for the *general* case. It is WRONG for
 * embedded-FPC payments. Here's why:
 *
 * When a dApp uses an embedded FPC (the `feePayer` field on the
 * `ExecutionPayload` points at an FPC contract that pays gas on the user's
 * behalf), the FPC contract carries a budgeted `amount`. The FPC's setup
 * function asserts that `gasLimits * maxFeesPerGas <= budgetedAmount`. If
 * the wallet inflates `maxFeesPerGas` beyond the dApp's budget, the FPC
 * assertion fails and the tx reverts.
 *
 * Upstream-recommended dApp patterns that hit this exactly:
 *   • `FeeJuicePaymentMethodWithClaim` (the L1→L2 bridge fee-claim flow):
 *     dApp derives the budget from `node.getCurrentMinFees()` directly,
 *     no padding — because the underlying bridge claim is sized at minFees.
 *   • Sponsored-FPC contracts with a `claim_and_end_setup` call: the
 *     sponsor-side accounting uses `getCurrentMinFees()` as the cap.
 *
 * Both patterns appear in aztec.js docs as the canonical examples. dApps
 * following them assume the wallet won't pad above `1.0×` for the embedded
 * fee path.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHAT THIS HELPER DOES
 * ─────────────────────────────────────────────────────────────────
 *
 * For txRequests with `fee.embeddedFeePayment` set ("fpc" or "fjwc"):
 *
 *   • If the dApp supplied `fee.maxFeesPerGas` explicitly, use those values
 *     (the dApp knows what its FPC budget is). On code paths where
 *     `gasSettings` isn't yet threaded through `buildStandard` —
 *     `executeAztecProfileTx`, `executeNoFromSendTx`, and the
 *     embedded-strategy `buildAndEstimate` — this branch is the ONLY way
 *     dApp-supplied explicit fees reach `txRequest.txContext.gasSettings`.
 *
 *   • If the dApp did NOT supply explicit fees, override `maxFeesPerGas`
 *     to `node.getCurrentMinFees()` (no padding) so the FPC budget
 *     assertion passes.
 *
 * No-op when `fee.embeddedFeePayment` is undefined (regular non-embedded
 * payment). Other gas-settings fields (`gasLimits`, `teardownGasLimits`,
 * `maxPriorityFeesPerGas`) pass through unchanged.
 *
 * ─────────────────────────────────────────────────────────────────
 * IF YOU'RE THINKING OF DELETING THIS HELPER
 * ─────────────────────────────────────────────────────────────────
 *
 * Two pre-PR-74 audits (codex + opus 4.7) both flagged that dropping the
 * cap and letting `completeFeeOptions`'s `1.5×` default flow through
 * would silently break dApps using the patterns above. Before removing,
 * verify with a real dApp that hits an embedded fee path. See
 * `implementations-plan/embedded-fpc-firsttx-cosmetic/plan-v2.md`.
 */
import { GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { TxExecutionRequest } from "@aztec/stdlib/tx"
import type { FeeOptions } from "@/wallet/services/execution/client"

export async function applyEmbeddedFpcGasCap(txRequest: TxExecutionRequest, fee: FeeOptions, node: AztecNode): Promise<void> {
	if (!fee.embeddedFeePayment) return
	const maxFeesPerGas = fee.maxFeesPerGas
		? new GasFees(BigInt(fee.maxFeesPerGas.feePerDaGas), BigInt(fee.maxFeesPerGas.feePerL2Gas))
		: await node.getCurrentMinFees()
	txRequest.txContext.gasSettings = new GasSettings(
		txRequest.txContext.gasSettings.gasLimits,
		txRequest.txContext.gasSettings.teardownGasLimits,
		maxFeesPerGas,
		txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
	)
}
