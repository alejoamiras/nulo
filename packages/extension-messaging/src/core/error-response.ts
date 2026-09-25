import { getErrorMessage } from "@nulo/wallet-core/utils"
import { JournaledRejection, WalletError, type WalletErrorPayload } from "../errors"

/** The error portion of a response envelope's `content`. The caller attaches
 *  `requestId` (and, for the offscreen transport, `from`/`to`). */
export interface ErrorResponseContent {
	/** Flat error message. Always present — kept for logging + older clients. */
	error: string
	/** Structured payload. Present only for a `WalletError` subclass, so the
	 *  client can reconstruct the original class + code + details. */
	errorPayload?: WalletErrorPayload
	/** The journal record the operation settled as failed. Present only for a
	 *  `JournaledRejection`, never read off the error itself. */
	journalId?: string
}

/**
 * Project any thrown value into the response envelope's error fields.
 *
 * A `WalletError` round-trips as a structured `errorPayload` so the client's
 * `instanceof` checks survive the JSON boundary; anything else flattens to a
 * message string. A `JournaledRejection` projects its `error` the same way and
 * adds its `journalId`. Shared by both services so the projection can't drift.
 */
export function buildErrorResponseContent(thrown: unknown): ErrorResponseContent {
	const journaled = thrown instanceof JournaledRejection ? thrown : undefined
	const error = journaled ? journaled.error : thrown
	const content: ErrorResponseContent = { error: getErrorMessage(error) }
	if (error instanceof WalletError) content.errorPayload = error.toPayload()
	if (journaled) content.journalId = journaled.journalId
	return content
}
