import { getErrorMessage } from "@nulo/wallet-core/utils"
import { WalletError, type WalletErrorPayload } from "../errors"

/** The error portion of a response envelope's `content`. The caller attaches
 *  `requestId` (and, for the offscreen transport, `from`/`to`). */
export interface ErrorResponseContent {
	/** Flat error message. Always present — kept for logging + older clients. */
	error: string
	/** Structured payload. Present only for a `WalletError` subclass, so the
	 *  client can reconstruct the original class + code + details. */
	errorPayload?: WalletErrorPayload
}

/**
 * Project any thrown value into the response envelope's error fields.
 *
 * A `WalletError` round-trips as a structured `errorPayload` so the client's
 * `instanceof` checks survive the JSON boundary; anything else flattens to a
 * message string. Shared by both services so the projection can't drift.
 */
export function buildErrorResponseContent(error: unknown): ErrorResponseContent {
	const content: ErrorResponseContent = { error: getErrorMessage(error) }
	if (error instanceof WalletError) content.errorPayload = error.toPayload()
	return content
}
