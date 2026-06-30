import { FpcType } from "@/wallet/services/fpc/client"

export interface RawFpc {
	id: string
	address: string
	name?: string
	type: FpcType
	isProtocol?: boolean
}

export interface PreparedFpc extends RawFpc {
	typeName: string
	typeDescription: string
}

export interface SyntheticPublicFjRow {
	id: "public-fj"
	synthetic: "public-fj"
	name: "Public Fee Juice"
	typeDescription: "Pays fees from your public Fee Juice"
}

export type DisplayRow = PreparedFpc | SyntheticPublicFjRow

export const PUBLIC_FJ_ROW: SyntheticPublicFjRow = {
	id: "public-fj",
	synthetic: "public-fj",
	name: "Public Fee Juice",
	typeDescription: "Pays fees from your public Fee Juice",
}

export function isSyntheticRow(row: DisplayRow): row is SyntheticPublicFjRow {
	return (row as SyntheticPublicFjRow).synthetic === "public-fj"
}

export function prepareFpc(fpc: RawFpc): PreparedFpc {
	if (fpc.type === FpcType.DefaultSponsoredFpc) {
		return { ...fpc, typeName: "sponsored", typeDescription: "Fees covered by sponsor" }
	}
	if (fpc.type === FpcType.PrivateFpc) {
		return { ...fpc, typeName: "private", typeDescription: "Pays fees from your private Fee Juice" }
	}
	return { ...fpc, typeName: "fpc", typeDescription: "" }
}

/**
 * Sort order for the manage-FPCs list. The synthetic Public Fee Juice
 * row sorts first, then PrivateFPC, then SponsoredFPC. Within a type,
 * protocol rows sort before user-added rows; the page applies a
 * stringCompare on `name` for tie-breaks.
 */
export function fpcSortOrder(fpc: PreparedFpc): number {
	if (fpc.type === FpcType.PrivateFpc) return 1
	if (fpc.type === FpcType.DefaultSponsoredFpc) return fpc.isProtocol ? 2 : 3
	return 4
}
