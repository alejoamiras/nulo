/**
 * Conformance mirror: buildFuelRoute output must satisfy EVERY rule SwapBridgeRouter's
 * `_validateRoute` enforces (contracts/bridge/evm/src/UniswapFuelSwap.sol). The Solidity side
 * is fuzzed over the same grammar (RouteGrammarFuzz.t.sol); this file pins the TS builder to
 * those rules so a future route-shape change cannot drift past the contract's acceptance.
 *
 * The oracle below re-states the documented rules — first-sell, last-out, hookless,
 * continuity with the WETH↔native unwrap confined to the final boundary — independently of
 * how buildFuelRoute derives its answer.
 */
import { describe, expect, it } from "vitest"
import type { Address } from "viem"
import { buildFuelRoute, type FuelRouteConfig } from "./route"

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address
const NATIVE = "0x0000000000000000000000000000000000000000" as Address

function conformsToRouterRules(cfg: FuelRouteConfig): string | null {
	const { path, zeroForOnes } = buildFuelRoute(cfg)

	if (path.length !== 2) return "builder must emit exactly the two-hop production shape"

	// Rule: hooks are banned on every hop.
	for (const k of path) if (k.hooks !== NATIVE && k.hooks !== addr(0)) return "hooked pool"

	// Rule: hop-1 sells the bridged token.
	const h1In = zeroForOnes[0] ? path[0].currency0 : path[0].currency1
	if (h1In.toLowerCase() !== cfg.token.toLowerCase()) return "first hop does not sell the token"

	// Rule: hop-2 sells native ETH and outputs FeeJuice.
	if (zeroForOnes[1] !== true) return "final hop must sell native"
	const h2Out = path[1].currency1
	if (h2Out.toLowerCase() !== cfg.feeJuice.toLowerCase()) return "final hop does not output FeeJuice"
	if (path[1].currency0 !== NATIVE) return "final pool is not the native pair"

	// Rule: continuity across the single boundary is exactly the sanctioned WETH→native unwrap.
	const out1 = zeroForOnes[0] ? path[0].currency1 : path[0].currency0
	if (out1.toLowerCase() !== cfg.weth.toLowerCase()) return "boundary is not WETH→native"
	if (path[1].currency0 !== NATIVE) return "unwrap boundary not final"

	return null
}

describe("buildFuelRoute conforms to _validateRoute grammar", () => {
	it("token below WETH (live mainnet ordering)", () => {
		const cfg: FuelRouteConfig = {
			token: addr(0x1111),
			weth: addr(0xeeee),
			feeJuice: addr(0xf00d),
			tokenWeth: { fee: 500, tickSpacing: 10 },
			ethFj: { fee: 10000, tickSpacing: 200 },
		}
		expect(conformsToRouterRules(cfg)).toBeNull()
	})

	it("token above WETH (flipped ordering)", () => {
		const cfg: FuelRouteConfig = {
			token: addr(0xffff),
			weth: addr(0x2222),
			feeJuice: addr(0xf00d),
			tokenWeth: { fee: 3000, tickSpacing: 60 },
			ethFj: { fee: 10000, tickSpacing: 200 },
		}
		expect(conformsToRouterRules(cfg)).toBeNull()
	})

	it("feeJuice sorting either side of WETH keeps the route conformant", () => {
		for (const fj of [addr(0x01), addr(0xfe)]) {
			const cfg: FuelRouteConfig = {
				token: addr(0x3333),
				weth: addr(0x4444),
				feeJuice: fj,
				tokenWeth: { fee: 3000, tickSpacing: 60 },
				ethFj: { fee: 500, tickSpacing: 10 },
			}
			expect(conformsToRouterRules(cfg)).toBeNull()
		}
	})
})
