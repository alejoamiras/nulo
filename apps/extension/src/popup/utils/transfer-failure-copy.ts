import { OperationNotRecordedError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"

export const TRANSFER_NOT_STARTED_COPY = "Couldn't start this transaction. Nothing was sent — try again."
export const TRANSFER_FAILED_COPY = "Simulation failed, transaction not sent"
/** The Send banner's own words: the acceptance lapsed between the form and the broadcast line. */
export const TRANSFER_TERMS_COPY = "Accept the Terms to send"

/** The Send screen's failure toast. A refusal raised before any build says so; "Simulation failed"
 *  would be false there, since nothing was simulated. */
export function transferFailureCopy(err: unknown): string {
	if (err instanceof TermsAcceptanceRequiredError) return TRANSFER_TERMS_COPY
	return err instanceof OperationNotRecordedError ? TRANSFER_NOT_STARTED_COPY : TRANSFER_FAILED_COPY
}

/** `console.error` is captured for every user; an expected refusal belongs at `debug`. */
export function transferFailureLogLevel(err: unknown): "debug" | "error" {
	return err instanceof TermsAcceptanceRequiredError ? "debug" : "error"
}
