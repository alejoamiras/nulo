import { z } from "zod"
import type { IncomingTransferRecord, IncomingTrustRecord } from "./spec"

/**
 * Whether a receipt has already been shown to its account. Keyed by receipt id, not by a
 * discovery-time watermark, which loses same-millisecond receipts and replays late-found history.
 * Floors are the chain's own block numbers: a receipt sent after a floor was taken is mined in a
 * higher block, whatever the device clock says.
 */

/** Played entries an account keeps; older ones fold into its floor. */
export const ARRIVAL_PLAYED_CAP = 500
export const ARRIVAL_ID_MAX = 200

/** The view the popup judges rows by. `sinceBlock: null` plays nothing. */
export type ArrivalState = {
	sinceBlock: number | null
	/** Per token contract: the block its history ends at, or `"pending"` while no tip could be read. */
	floors: Record<string, number | "pending">
	played: string[]
}

/** The stored row, per `(profile, network, account)`. */
export type ArrivalRow = {
	sinceBlock: number
	played: Array<[id: string, l2BlockNumber: number]>
}

const blockSchema = z.number().int().nonnegative()

/** A row that fails to parse reads as missing: it is rebaselined, never trusted. */
export const ArrivalRowSchema: z.ZodType<ArrivalRow> = z.object({
	sinceBlock: blockSchema,
	played: z.array(z.tuple([z.string().max(ARRIVAL_ID_MAX), blockSchema])).max(ARRIVAL_PLAYED_CAP),
})

type ArrivalCandidate = Pick<IncomingTransferRecord, "id" | "contract" | "l2BlockNumber" | "amountRaw">
type FloorSource = Pick<IncomingTrustRecord, "contract" | "arrivalFloor" | "arrivalFloorPending">

/** The view of an account's row under its network's token floors; no row plays nothing. */
export function arrivalStateOf(row: ArrivalRow | undefined, trust: FloorSource[]): ArrivalState {
	const floors: ArrivalState["floors"] = {}
	for (const t of trust) {
		if (t.arrivalFloorPending) floors[t.contract] = "pending"
		else if (t.arrivalFloor !== undefined) floors[t.contract] = t.arrivalFloor
	}
	if (!row) return { sinceBlock: null, floors, played: [] }
	return { sinceBlock: row.sinceBlock, floors, played: row.played.map(([id]) => id) }
}

export function arrivalKey(profileId: string, networkId: string, accountAddress: string): string {
	return `${profileId}|${networkId}|${accountAddress}`
}

/** A receipt of nothing, like dust, is an ordinary row: only an amount above zero arrives. */
function isPositiveAmount(amountRaw: string): boolean {
	try {
		return BigInt(amountRaw) > 0n
	} catch {
		return false
	}
}

export function isArrivalEligible(record: ArrivalCandidate, state: ArrivalState): boolean {
	if (state.sinceBlock === null || state.played.includes(record.id) || !isPositiveAmount(record.amountRaw)) return false
	const floor = state.floors[record.contract]
	if (floor === "pending") return false
	return record.l2BlockNumber > Math.max(state.sinceBlock, floor ?? -1)
}

/**
 * Adds each record to `played`. Past the cap the account floor rises to the newest evicted entry's
 * block and only entries above it stay: an evicted id is then at or under the floor, so forgetting
 * it can never let it play again.
 */
export function claimPlayed(row: ArrivalRow, records: Pick<IncomingTransferRecord, "id" | "l2BlockNumber">[]): ArrivalRow {
	const byId = new Map(row.played)
	for (const r of records) byId.set(r.id, r.l2BlockNumber)
	const played = [...byId].sort((a, b) => b[1] - a[1])
	if (played.length <= ARRIVAL_PLAYED_CAP) return { sinceBlock: row.sinceBlock, played }
	const evictedBlock = played[ARRIVAL_PLAYED_CAP][1]
	return {
		sinceBlock: Math.max(row.sinceBlock, evictedBlock),
		played: played.filter(([, block]) => block > evictedBlock),
	}
}
