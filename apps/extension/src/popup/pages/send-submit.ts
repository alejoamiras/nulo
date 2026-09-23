import { TOAST_DURATION } from "@/composables/toast.js"
import { classifyCancellableRejection } from "@/popup/utils/cancellable-rejection"
import { transferFailureCopy, transferFailureLogLevel } from "@/popup/utils/transfer-failure-copy"

/** Everything the transfer needs, read off the form before the page navigates away. */
export interface TransferSnapshot {
	networkId: string
	accountAddress: string
	tokenId: number
	transferType: number
	destination: string
	amount: bigint
	feeSettings: unknown
	/** A consumable estimate the SW may reuse; absent when none was ready. */
	precomputedEstimateId: string | undefined
	/** The token contract, for the awaiting row only. */
	contract: string
}

export interface SubmitDeps {
	executeTransfer: (
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: number,
		destination: string,
		amount: bigint,
		feeSettings: unknown,
		precomputedEstimateId: string | undefined,
	) => Promise<unknown>
	awaiting: {
		add: (row: { id: string; account: string; destination: string; contract: string }) => void
		remove: (id: string) => void
	}
	openToast: (toast: { label: string; icon: string; color?: string }, duration?: number) => void
	/** Runs once the transfer settles either way — the page's execution-port teardown. */
	onSettled: () => void
}

/**
 * Fires the transfer and never waits for it: progress lives in the durable operation journal, so
 * the page leaves at once. The awaiting row is removed by its own id on rejection, never by a
 * destination search that could hit a sibling's row.
 */
export function submitTransfer(deps: SubmitDeps, snap: TransferSnapshot): string {
	const awaitingId = crypto.randomUUID()
	deps.awaiting.add({ id: awaitingId, account: snap.accountAddress, destination: snap.destination, contract: snap.contract })

	deps.executeTransfer(
		snap.networkId,
		snap.accountAddress,
		snap.tokenId,
		snap.transferType,
		snap.destination,
		snap.amount,
		snap.feeSettings,
		snap.precomputedEstimateId,
	)
		.then(() => {
			deps.openToast({ label: "Transaction submitted", icon: "check-circle" })
		})
		.catch((err: unknown) => {
			deps.awaiting.remove(awaitingId)
			// A cancel already reads "Cancelled" on its activity card; a failure toast would contradict it.
			if (classifyCancellableRejection(err) === "silent") return

			deps.openToast({ label: transferFailureCopy(err), icon: "warning", color: "red" }, TOAST_DURATION.LONG)
			if (transferFailureLogLevel(err) === "debug") console.debug("[send] executeTransfer refused:", err)
			else console.error("[send] executeTransfer failed:", err)
		})
		.finally(deps.onSettled)

	return awaitingId
}
