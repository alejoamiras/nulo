import { EmbeddedStrategy } from "./embedded-strategy"
import { FeeJuiceStrategy } from "./fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee-juice-with-claim-strategy"
import type { FeeStrategy, FeeStrategyDeps } from "./fee-strategy"
import { FpcStrategy } from "./fpc-strategy"
import type { FeeSettings } from "../spec"

/**
 * Q-04 pilot: the fee-strategy dispatch map as a pure, explicitly-typed
 * builder. The composition root (`ExecutionService.init()`) still constructs
 * `FeeStrategyDeps` at its original point — the eager/lazy capture modes of
 * every dependency are the CALLER's, unchanged — and still owns the field
 * assignment, so initialization order stays legible at the root. Keys are
 * deliberately literal, never derived from `strategy.kind`: a derived key
 * would silently accept a kind/slot mismatch; the composition pin asserts the
 * agreement instead.
 */
export function buildFeeStrategies(deps: FeeStrategyDeps): Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy> {
	return new Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy>([
		["fj", new FeeJuiceStrategy(deps)],
		["fjwc", new FeeJuiceWithClaimStrategy(deps)],
		["fpc", new FpcStrategy(deps)],
		["embedded", new EmbeddedStrategy(deps)],
	])
}
