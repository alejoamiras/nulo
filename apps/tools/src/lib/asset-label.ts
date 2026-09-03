import { type BridgeJournalRecord, isSendRecord } from "@nulo/bridge-core"

/** The journal's asset discriminant (mirrors `@nulo/bridge-core`'s `assetKindOf` return). */
export type AssetKind = "bridge-token" | "fee-juice"

/** The display identity a record carries for its own token — any ERC-20, not one deployment's. */
export interface AssetBlock {
	displaySymbol: string
	decimals: number
}

/** A record predating the generation carries no token identity of its own; it can only be named
 *  generically, and it can never run here (its deployment binding no longer matches). */
const UNKNOWN_SYMBOL = "TOKEN"
const UNKNOWN_DECIMALS = 18

/**
 * Display symbol for a bridged asset. A gas-only bridge carries Aztec Fee Juice, NOT a token — per
 * the gas-naming convention its L2-surface name is "FJ" public / "Private FJ" private ($AZTEC is
 * only the L1-side name).
 */
export function assetSymbol(assetKind: AssetKind | undefined, isPrivate: boolean, token?: AssetBlock): string {
	if (assetKind === "fee-juice") return isPrivate ? "Private FJ" : "FJ"
	return token?.displaySymbol ?? UNKNOWN_SYMBOL
}

/** Decimals for a bridged asset. Fee Juice is the 18-decimal protocol standard; a send uses its own
 *  token block's decimals. An amount formatted at the wrong decimals shows a wildly wrong number. */
export function assetDecimals(assetKind: AssetKind | undefined, token?: AssetBlock): number {
	if (assetKind === "fee-juice") return 18
	return token?.decimals ?? UNKNOWN_DECIMALS
}

/** A record's own token identity: present on every schema-3 send except a gas-only one. */
export function recordTokenBlock(rec: BridgeJournalRecord): AssetBlock | undefined {
	return isSendRecord(rec) ? rec.token : undefined
}
