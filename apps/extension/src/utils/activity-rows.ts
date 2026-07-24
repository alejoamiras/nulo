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
	/** Incoming-transfer records. */
	incomingTransfers: IncomingTransferRecord[]
	/** Active account address. When provided, ALL three row types are scoped to
	 *  it — defense-in-depth after upstream ingest filtering (the incoming
	 *  composable + the tx store already drop foreign-scope records, but a render
	 *  filter here means a single missed guard can't leak another account's rows). */
	accountAddress?: string
	/** Active chain id — scopes tx rows (tx carries `chainId`). Applied only when set. */
	chainId?: number
	/** Active network id — scopes incoming rows (record carries `networkId`). Applied only when set. */
	networkId?: string
	/** Active profile id — scopes rows that name a profile. Two profiles can derive
	 *  the same address, so account + chain alone are not a unique scope. */
	profileId?: string
}

export function buildActivityRows({
	transactions,
	terminalJournalOps,
	incomingTransfers,
	accountAddress,
	chainId,
	networkId,
	profileId,
}: BuildActivityRowsParams): ActivityRow[] {
	/** Two profiles can hold the same address, so a row that names a profile
	 *  must match the one being viewed. Rows written before scope stamping name
	 *  none and stay visible — they cannot be attributed either way. */
	const wrongProfile = (rowProfileId: string | undefined) =>
		profileId !== undefined && rowProfileId !== undefined && rowProfileId !== profileId
	const rows: ActivityRow[] = []

	for (const tx of transactions) {
		// Scope tx to the active account+chain when a scope is supplied (a late/
		// out-of-scope tx from the store's flat list must not render under B).
		if (accountAddress !== undefined && tx.account !== accountAddress) continue
		if (chainId !== undefined && tx.chainId !== chainId) continue
		if (wrongProfile(tx.profileId)) continue
		rows.push({ type: "tx", key: `tx:${tx.hash}`, sortKey: tx.updatedAt, tx })
	}

	for (const op of terminalJournalOps) {
		if (op.progress?.stage === "succeeded") continue
		if (!ACTIVITY_FEED_KINDS.has(op.kind)) continue
		if (op.accountAddress !== accountAddress) continue
		if (wrongProfile(op.profileId)) continue
		if (op.terminalAt === null) continue
		rows.push({ type: "journal", key: `journal:${op.id}`, sortKey: op.terminalAt, op })
	}

	for (const inc of incomingTransfers) {
		// Scope incoming to the active account+network when supplied.
		if (accountAddress !== undefined && inc.accountAddress !== accountAddress) continue
		if (networkId !== undefined && inc.networkId !== networkId) continue
		// Path 2: prefer the chain-derived block timestamp (UTC seconds) over
		// the wall-clock `discoveredAt`. Block timestamp survives token
		// remove + re-add (records get re-indexed from PXE with identical
		// `blockTimestamp`s) AND survives a new-device restore from the
		// same mnemonic. Wall-clock falls back only for legacy records OR
		// when PXE failed to resolve the block at scan-time. Multiply seconds
		// by 1000 so the magnitude is comparable to the millisecond values
		// used for tx / journal sortKeys.
		const sortKey = inc.blockTimestamp !== undefined ? inc.blockTimestamp * 1000 : inc.discoveredAt
		rows.push({ type: "incoming", key: `incoming:${inc.siloedNullifier}`, sortKey, inc })
	}

	return rows.sort((a, b) => b.sortKey - a.sortKey)
}
