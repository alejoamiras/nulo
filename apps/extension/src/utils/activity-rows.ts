/**
 * Pure helper that merges the three activity-feed sources into one
 * date-sorted row list:
 *   - on-chain txs (TransactionService)
 *   - terminal journal records (OperationJournalService — cancelled,
 *     interrupted, failed-pre-broadcast)
 *   - incoming-transfer records (IncomingTransferService — fungible-token
 *     receives, filtered by trust state at the service layer)
 *
 * Lives in `utils/` (L0) so both popup-pages (L6) and feed modules (L4)
 * can import. Extracted from the inline merges that previously lived in
 * both `popup/pages/activity.vue` and `popup/components/modules/general/
 * RecentActivityView.vue` — duplication risked drift between the two
 * surfaces (codex + opus audit M3).
 */

import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { Tx } from "@/wallet/services/transaction/spec"
import { ACTIVITY_FEED_KINDS } from "./journal-state"

export type ActivityRowTx = { type: "tx"; key: string; sortKey: number; tx: Tx }
export type ActivityRowJournal = { type: "journal"; key: string; sortKey: number; op: OperationRecord }
export type ActivityRowIncoming = { type: "incoming"; key: string; sortKey: number; inc: IncomingTransferRecord }
export type ActivityRow = ActivityRowTx | ActivityRowJournal | ActivityRowIncoming

export interface BuildActivityRowsParams {
	/** Chain-tx rows. Owns hash / status / fee / explorer URL. */
	transactions: Tx[]
	/** Journal records that ended without producing a chain tx. Filtered
	 *  here on kind ∈ ACTIVITY_FEED_KINDS, `terminalAt !== null`,
	 *  succeeded → not displayed (the matching chain tx covers it). */
	terminalJournalOps: OperationRecord[]
	/** Incoming-transfer records. Already filtered + sorted by the service
	 *  layer; we just attach them as a row type. */
	incomingTransfers: IncomingTransferRecord[]
	/** Active account address used to scope journal rows. Incoming records
	 *  are already account-scoped at the service layer. */
	accountAddress?: string
}

export function buildActivityRows({
	transactions,
	terminalJournalOps,
	incomingTransfers,
	accountAddress,
}: BuildActivityRowsParams): ActivityRow[] {
	const rows: ActivityRow[] = []

	for (const tx of transactions) {
		rows.push({ type: "tx", key: `tx:${tx.hash}`, sortKey: tx.updatedAt, tx })
	}

	for (const op of terminalJournalOps) {
		if (op.progress?.stage === "succeeded") continue
		if (!ACTIVITY_FEED_KINDS.has(op.kind)) continue
		if (op.accountAddress !== accountAddress) continue
		if (op.terminalAt === null) continue
		rows.push({ type: "journal", key: `journal:${op.id}`, sortKey: op.terminalAt, op })
	}

	for (const inc of incomingTransfers) {
		// Path 2: prefer the chain-derived block timestamp (UTC seconds) over
		// the wall-clock `discoveredAt`. Block timestamp survives token
		// remove + re-add (records get re-indexed from PXE with identical
		// `blockTimestamp`s) AND survives a new-device restore from the
		// same mnemonic. Wall-clock falls back only for legacy records OR
		// when PXE failed to resolve the block at scan-time. Multiply seconds
		// by 1000 so the magnitude is comparable to the millisecond values
		// used for tx / journal sortKeys.
		const sortKey = inc.blockTimestamp !== undefined ? inc.blockTimestamp * 1000 : inc.discoveredAt
		rows.push({ type: "incoming", key: `incoming:${inc.id}`, sortKey, inc })
	}

	return rows.sort((a, b) => b.sortKey - a.sortKey)
}
