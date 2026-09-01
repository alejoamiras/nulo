/**
 * The home-preview row math for `RecentActivityView`: a chronological merge of terminal journal
 * records, settled chain txs and incoming transfers, scoped like `buildActivityRows` but with the
 * preview's OWN rules (journal rows arrive pre-filtered, incoming rows are token-scoped when the view
 * is a token page, and the list is sliced to the slots the in-flight cards leave). Deliberately not
 * `buildActivityRows`: unifying would broaden or drop rows.
 */
import { isForeignProfile } from "@/utils/activity-rows"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { Tx } from "@/wallet/services/transaction/spec"

export interface RecentRowScope {
	accountAddress?: string
	chainId?: number
	networkId?: string
	profileId?: string
}

/** The token page's token object when the view is token-scoped; a PRESENT token with an undefined id still scopes. */
export type RecentTokenScope = { id?: number } | undefined

export type RecentActivityRow =
	| { type: "journal"; key: string; sortKey: number; op: OperationRecord }
	| { type: "tx"; key: string; sortKey: number; tx: Tx }
	| { type: "incoming"; key: string; sortKey: number; inc: IncomingTransferRecord }

/** Count slots only for cards that actually render: the send.vue fallback card is suppressed by
 *  the template when ANY journal card or orphan executing task is on screen, so it counts only when
 *  it is the sole in-flight card (mirrors the template's `v-else-if` chain). */
export function remainingRowSlots(p: { journalCount: number; orphanCount: number; fallbackRendered: boolean; budget: number }): number {
	const inFlightCount = p.journalCount + p.orphanCount + (p.fallbackRendered ? 1 : 0)
	return Math.max(0, p.budget - inFlightCount)
}

export function buildRecentActivityRows(p: {
	journalOps: OperationRecord[]
	transactions: Tx[]
	incomingTransfers: IncomingTransferRecord[]
	scope: RecentRowScope
	token: RecentTokenScope
}): RecentActivityRow[] {
	const rows: RecentActivityRow[] = []
	for (const op of p.journalOps) {
		rows.push({ type: "journal", key: `journal:${op.id}`, sortKey: op.terminalAt ?? 0, op })
	}
	rows.push(...scopedTxRows(p.transactions, p.scope), ...tokenScopedIncomingRows(p.incomingTransfers, p.scope, p.token))
	rows.sort((a, b) => b.sortKey - a.sortKey)
	return rows
}

/** Layer-A containment (defense-in-depth): scope tx rows to the active account + chain exactly as
 *  `buildActivityRows` does — so both feed surfaces make identical scope decisions. Tolerant when a
 *  scope field is unknown, never "active-now". */
function scopedTxRows(transactions: Tx[], scope: RecentRowScope): RecentActivityRow[] {
	const rows: RecentActivityRow[] = []
	for (const tx of transactions) {
		if (scope.accountAddress !== undefined && tx.account !== scope.accountAddress) continue
		if (scope.chainId !== undefined && tx.chainId !== scope.chainId) continue
		if (isForeignProfile(scope.profileId, tx.profileId)) continue
		rows.push({ type: "tx", key: `tx:${tx.hash}`, sortKey: tx.updatedAt, tx })
	}
	return rows
}

function tokenScopedIncomingRows(incoming: IncomingTransferRecord[], scope: RecentRowScope, token: RecentTokenScope): RecentActivityRow[] {
	const rows: RecentActivityRow[] = []
	for (const inc of incoming) {
		// Token-scoped views (token-detail page) only show incoming for the active token. The home view shows all.
		if (token && inc.tokenId !== token.id) continue
		if (scope.accountAddress !== undefined && inc.accountAddress !== scope.accountAddress) continue
		if (scope.networkId !== undefined && inc.networkId !== scope.networkId) continue
		if (isForeignProfile(scope.profileId, inc.profileId)) continue
		// Path 2: prefer block timestamp (chain-derived, survives remove+re-add). Fall back to
		// discoveredAt for legacy records or when PXE didn't resolve the block. *1000 to align
		// magnitude with tx.updatedAt (ms).
		const sortKey = inc.blockTimestamp !== undefined ? inc.blockTimestamp * 1000 : inc.discoveredAt
		rows.push({ type: "incoming", key: `incoming:${inc.id}`, sortKey, inc })
	}
	return rows
}
