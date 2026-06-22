import { BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"

/** The journal's asset discriminant (mirrors `@nulo/bridge-core`'s `assetKindOf` return). */
export type AssetKind = "bridge-token" | "fee-juice"

/**
 * Display symbol for a bridged asset. A Fuel (fee-juice) record carries Aztec Fee Juice as gas, NOT the
 * token bridge's asset — so it must never render the bridge symbol. Per the gas-naming convention the
 * L2-surface name is "FJ" public / "Private FJ" private ($AZTEC is only the L1-side name). Token bridges
 * use the configured bridge symbol. Used wherever a fee-juice record can surface on a shared bridge view
 * (the background completion toast + the journal card) so it isn't mislabelled as the token (codex MEDIUM/LOW).
 */
export function assetSymbol(assetKind: AssetKind | undefined, isPrivate: boolean): string {
	if (assetKind === "fee-juice") return isPrivate ? "Private FJ" : "FJ"
	return BRIDGE_TOKEN_SYMBOL
}

/** Decimals for a bridged asset. Fee Juice is the 18-decimal protocol standard; the token bridge uses its
 *  own configured decimals. A fee-juice amount formatted at the token's decimals shows a wildly wrong number. */
export function assetDecimals(assetKind: AssetKind | undefined): number {
	return assetKind === "fee-juice" ? 18 : BRIDGE_TOKEN_DECIMALS
}
