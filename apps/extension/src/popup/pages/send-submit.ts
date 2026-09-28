import { journalIdOf } from "@nulo/extension-messaging/errors"
import type { ToastAction, ToastOptions } from "@/composables/toast"
import { classifyCancellableRejection } from "@/popup/utils/cancellable-rejection"
import { transferFailureCopy, transferFailureLogLevel } from "@/popup/utils/transfer-failure-copy"
import { formatSnackAmount } from "@/utils/snack-amount"
import { trimAddress } from "@/utils/string"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

/** View opens `/popup/tx/<hash>`, so the hash is offered only once it is a 32-byte hex string. */
const TX_HASH = /^0x[0-9a-f]{64}$/i
/** Details opens `/popup/journal/<id>`, so only a journal id of 16 hex characters is offered. */
const JOURNAL_ID = /^[0-9a-f]{16}$/

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
	/** The token's symbol and decimals, for the result's text; the symbol is contract-controlled. */
	symbol: string
	decimals: number
	/** `appStore.scopeEpoch` at submit: the result is announced only while it is unchanged. */
	epoch: number
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
	) => Promise<string>
	awaiting: {
		add: (row: { id: string; account: string; destination: string; contract: string }) => void
		remove: (id: string) => void
	}
	openToast: (toast: ToastOptions) => void
	/** Whether the popup is still unlocked in the scope the transfer was submitted from. */
	isCurrent: (epoch: number) => boolean
	viewTransaction: (hash: string) => void
	/** The active profile's journal record under this id, if it has one. */
	readJournal: (id: string) => Promise<OperationRecord | undefined>
	viewJournal: (id: string) => void
	/** Runs once the transfer settles either way — the page's execution-port teardown. */
	onSettled: () => void
}

/**
 * Fires the transfer and never waits for it: progress lives in the durable operation journal, so
 * the page leaves at once. The awaiting row is removed by its own id on rejection, never by a
 * destination search that could hit a sibling's row. A result that lands after a lock or a scope
 * change opens no snack; the activity list still shows it.
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
		.then((hash) => {
			if (!deps.isCurrent(snap.epoch)) return
			deps.openToast({ kind: "success", label: "Transaction submitted", sub: submittedSub(snap), action: viewAction(deps, hash) })
		})
		.catch(async (err: unknown) => {
			deps.awaiting.remove(awaitingId)
			// A cancel already reads "Cancelled" on its activity card; a failure toast would contradict it.
			if (classifyCancellableRejection(err) === "silent") return

			if (transferFailureLogLevel(err) === "debug") console.debug("[send] executeTransfer refused:", err)
			else console.error("[send] executeTransfer failed:", err)
			if (!deps.isCurrent(snap.epoch)) return
			const action = await detailsAction(deps, snap, journalIdOf(err))
			if (deps.isCurrent(snap.epoch)) deps.openToast({ kind: "error", label: "Send failed", sub: transferFailureCopy(err), action })
		})
		.finally(deps.onSettled)

	return awaitingId
}

function submittedSub(snap: TransferSnapshot): string {
	const amount = formatSnackAmount(snap.amount, snap.decimals)
	const symbol = sanitizeWireString(snap.symbol, 32)
	return `${amount} ${symbol} to ${trimAddress(snap.destination, 6, 4, "…")}`
}

function viewAction(deps: SubmitDeps, hash: string): ToastAction | undefined {
	if (!TX_HASH.test(hash)) return undefined
	return { label: "View", onSelect: () => deps.viewTransaction(hash) }
}

/** Details only for the record the wallet named beside this failure, read back as this send's
 *  failed transfer. Any doubt, a failed read included, leaves the snack without it. */
async function detailsAction(deps: SubmitDeps, snap: TransferSnapshot, id: string | null): Promise<ToastAction | undefined> {
	if (id === null || !JOURNAL_ID.test(id)) return undefined
	const record = await deps.readJournal(id).catch(() => {
		console.debug("[send] Details withheld: the journal read failed")
		return undefined
	})
	if (!record || !isFailedTransferOf(record, snap)) return undefined
	return { label: "Details", onSelect: () => deps.viewJournal(id) }
}

function isFailedTransferOf(record: OperationRecord, snap: TransferSnapshot): boolean {
	return (
		record.kind === "transfer" &&
		record.progress.stage === "failed" &&
		record.terminalAt !== null &&
		record.networkId === snap.networkId &&
		record.accountAddress === snap.accountAddress
	)
}
