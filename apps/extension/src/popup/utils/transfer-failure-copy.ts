import { OperationNotRecordedError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { isSendCheckable, type OperationRecord, wasNeverSent } from "@/wallet/services/operation-journal/spec"

export const TRANSFER_NOT_STARTED_COPY = "Couldn't start this transaction. Nothing was sent — try again."
/** The Send banner's own words: the acceptance lapsed between the form and the broadcast line. */
export const TRANSFER_TERMS_COPY = "Accept the Terms to send"
export const TRANSFER_NOTHING_SENT_COPY = "Nothing was sent. You can try again."
export const TRANSFER_NOT_CONFIRMED_COPY = "Checking whether it reached the network. Don't send it again yet."
export const TRANSFER_STATUS_UNKNOWN_COPY = "Check History before sending it again."

/** `details`: the snack may offer the send's record page. */
export type TransferFailureSnack = { label: string; sub: string; details: boolean }

const STATUS_UNKNOWN: TransferFailureSnack = { label: "Send status unknown", sub: TRANSFER_STATUS_UNKNOWN_COPY, details: false }

/**
 * The Send screen's failure snack. The wallet's own refusals keep their words; any other failure
 * reads from the send's record, since only its stage proves whether anything went out. Without a
 * record (a timeout or a dropped port never names one) the status is unknown.
 */
export function transferFailureSnack(err: unknown, record: OperationRecord | undefined): TransferFailureSnack {
	if (err instanceof TermsAcceptanceRequiredError) return { label: "Send failed", sub: TRANSFER_TERMS_COPY, details: true }
	if (err instanceof OperationNotRecordedError) return { label: "Send failed", sub: TRANSFER_NOT_STARTED_COPY, details: true }
	if (record === undefined) return STATUS_UNKNOWN
	if (isSendCheckable(record)) return { label: "Send not confirmed", sub: TRANSFER_NOT_CONFIRMED_COPY, details: true }
	if (wasNeverSent(record)) return { label: "Send failed", sub: TRANSFER_NOTHING_SENT_COPY, details: true }
	return STATUS_UNKNOWN
}

/** `console.error` is captured for every user; an expected refusal belongs at `debug`. */
export function transferFailureLogLevel(err: unknown): "debug" | "error" {
	return err instanceof TermsAcceptanceRequiredError ? "debug" : "error"
}
