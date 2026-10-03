/**
 * The home-preview row math for `RecentActivityView`: a chronological merge of terminal journal
 * records, settled chain txs and incoming transfers, scoped like `buildActivityRows` but with the
 * preview's OWN rules (journal rows arrive pre-filtered, incoming rows are token-scoped when the view
 * is a token page, and the list is sliced to the slots the in-flight cards leave). Deliberately not
 * `buildActivityRows`: unifying would broaden or drop rows.
 */
import { type ActivityRow, incomingInScope, incomingRow, scopedTxRows } from "@/utils/activity-rows"
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

export type RecentActivityRow = ActivityRow

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

/** The token check runs first, so another token's receipt never has its scope fields read. */
function tokenScopedIncomingRows(incoming: IncomingTransferRecord[], scope: RecentRowScope, token: RecentTokenScope): RecentActivityRow[] {
	const rows: RecentActivityRow[] = []
	for (const inc of incoming) {
		// Token-scoped views (token-detail page) only show incoming for the active token. The home view shows all.
		if (token && inc.tokenId !== token.id) continue
		if (!incomingInScope(inc, scope)) continue
		rows.push(incomingRow(inc))
	}
	return rows
}
