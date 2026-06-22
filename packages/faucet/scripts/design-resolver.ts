import type { ComponentResolverFunction } from "unplugin-vue-components"

/**
 * `@nulo/design` primitives the faucet uses as bare tags. Mirrors the extension's primitives-only
 * resolver discipline: only framework-agnostic primitives newly introduced during the design adoption
 * resolve here. Components the faucet already imports explicitly (Button, Card, Toast, AddressDisplay,
 * Spinner, BalanceRow, DripButton, DisclaimerTag, EmojiGrid) stay explicit — converting them would be
 * churn with zero reuse gain.
 *
 * The set contains ONLY tags that are actually used as bare tags today (so it stays in lockstep with
 * the committed `src/types/components.d.ts` — an unused entry would make `vue-tsc` reject a future bare
 * tag until the next build regenerates the dts). Add a primitive here the moment a template uses it as
 * a bare tag, then `bun run build` to regenerate + commit the dts (e.g. Text/Icon, or Tag/Badge if a
 * status-pill swap ever wins its visual check).
 */
export const NULO_DESIGN_COMPONENTS = new Set(["Flex"])

export function nuloDesignResolver(): ComponentResolverFunction {
	return (name: string) => {
		if (NULO_DESIGN_COMPONENTS.has(name)) return { name, from: "@nulo/design" }
	}
}
