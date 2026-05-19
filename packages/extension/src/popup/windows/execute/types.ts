/**
 * Shared types for the dApp Execute approval window.
 *
 * Why a `Draft*` type set: send-like ops (`send_transaction`, `aztec_sendTx`)
 * declare `feeSettings: FeeSettings` (non-optional) in the wallet-bridge
 * contract — that's the executable Operation shape the SW expects after
 * approval. While the popup is open, however, the user may not yet have
 * picked a fee method; the row exists with `feeSettings === undefined`.
 *
 * Pre-Phase-2-followup, this gap was papered over with `feeSettings: undefined!`
 * non-null assertions at the init site, which let a popup-side bug ship
 * an undefined-feeSettings op to the SW and surface as a `TypeError:
 * Cannot read properties of undefined (reading 'priorityLevel')`.
 *
 * The fix:
 *
 * 1. This file declares `DraftOperation` — the same union as `Operation`
 *    but with `feeSettings` honestly optional on send-likes.
 * 2. The popup `index.vue` + `OperationCard.vue` both type their rows as
 *    `DraftUIOperation` (Draft + UI-only fields).
 * 3. `operation-validation.ts` provides `requiresFeeSelection` (UX gate)
 *    and `assertExecutableOperation` (type-narrowing assertion) used at
 *    the approve handler to safely cast Draft → executable Operation.
 *
 * The wallet-bridge `Operation` type is intentionally NOT changed —
 * codex's review correctly pointed out that loosening it would weaken a
 * contract that is otherwise correctly enforced everywhere else.
 */

import type { AztecSendTxOperation, FeeSettings, Operation, SendTransactionOperation } from "@nulo/wallet-bridge"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"

/** `aztec_sendTx` with feeSettings honestly optional (popup may not yet
 *  have the user's selection). Becomes executable once feeSettings is set. */
export type DraftAztecSendTxOperation = Omit<AztecSendTxOperation, "feeSettings"> & {
	feeSettings?: FeeSettings
}

/** `send_transaction` with feeSettings honestly optional. */
export type DraftSendTransactionOperation = Omit<SendTransactionOperation, "feeSettings"> & {
	feeSettings?: FeeSettings
}

/**
 * Discriminated union: all Operation variants, with `feeSettings`
 * optionalised on the two send-like kinds where the wallet (not the
 * dApp) supplies it.
 */
export type DraftOperation =
	| Exclude<Operation, AztecSendTxOperation | SendTransactionOperation>
	| DraftAztecSendTxOperation
	| DraftSendTransactionOperation

/** Popup row type: a draft operation plus UI-only attachments. */
export type DraftUIOperation = DraftOperation & {
	network: Network
	account?: Account
}
