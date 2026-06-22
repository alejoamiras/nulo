import type { ComponentResolverFunction } from "unplugin-vue-components"

/**
 * `@nulo/design` primitives the faucet uses as bare tags. Mirrors the extension's primitives-only
 * resolver discipline: only framework-agnostic primitives newly introduced during the design adoption
 * resolve here. Components the faucet already imports explicitly (Button, Card, Toast, AddressDisplay,
 * Spinner, BalanceRow, DripButton, DisclaimerTag, EmojiGrid) stay explicit — converting them would be
 * churn with zero reuse gain. Grows only when a later phase actually adopts a primitive (e.g. Tag/Badge
 * if a status-pill swap wins its visual check).
 */
export const NULO_DESIGN_COMPONENTS = new Set(["Flex", "Text", "Icon"])

export function nuloDesignResolver(): ComponentResolverFunction {
	return (name: string) => {
		if (NULO_DESIGN_COMPONENTS.has(name)) return { name, from: "@nulo/design" }
	}
}
