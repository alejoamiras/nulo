import { OperationNotRecordedError } from "@nulo/extension-messaging/errors"

export const TRANSFER_NOT_STARTED_COPY = "Couldn't start this transaction. Nothing was sent — try again."
export const TRANSFER_FAILED_COPY = "Simulation failed, transaction not sent"

/** The Send screen's failure toast. A refusal raised before any build says so; "Simulation failed"
 *  would be false there, since nothing was simulated. */
export function transferFailureCopy(err: unknown): string {
	return err instanceof OperationNotRecordedError ? TRANSFER_NOT_STARTED_COPY : TRANSFER_FAILED_COPY
}
