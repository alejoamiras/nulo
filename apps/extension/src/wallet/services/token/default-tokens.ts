/**
 * Built-in default-token seed list. One entry per (chainId, contract); the
 * seeder adds any missing entry after unlock, through the same journaled
 * machinery as a manual add — but gated on the TOFU pins below, because
 * seeding is zero-interaction (no preview popup for the user to inspect).
 *
 * Pin provenance (captured by `scripts/seed-preflight.ts` against the
 * canonical public RPCs — re-run it whenever a network resets):
 * - `expectedClassId`: live-captured from the node. The load-bearing pin —
 *   the artifact and every FnImpl derive from the class, so a hostile RPC
 *   cannot swap in a different contract implementation.
 * - `expectedSymbol`: the CHAIN's symbol, live-captured with
 *   `scripts/seed-preflight-metadata.ts` (standards Token storage layout —
 *   the upstream sample Token's layout decodes garbage; that mismatch shipped
 *   a wrong "cUSD" pin that hard-skipped the token on every unlock). Chain
 *   metadata disagreeing with the pin means we should not silently seed it.
 * - decimals cannot be captured without a live simulation, so it is
 *   bounds-checked (0..18) at seed time and recorded in the seed marker for
 *   manual QA confirmation, not equality-pinned.
 *
 * The V6 testnet has no seed yet. Its "Test USDC" is the L2 token unleashed's V6 testnet
 * generation pre-creates (`bridge.tokens[].l2Token` in its testnet manifest); the aztec-update
 * skill's reset step adds it here, with pins from both preflights, once that generation exists.
 */

export type DefaultTokenSeed = {
	chainId: number
	contract: string
	/** TOFU pin: `currentContractClassId` the instance must present. */
	expectedClassId: string
	/** Product-intent pin: chain symbol must match exactly. */
	expectedSymbol: string
	/** Compiled-in label for the row shown BEFORE the chain has answered. Never
	 *  persisted and never compared: the token row carries the chain's own name. */
	displayName: string
}

export const DEFAULT_TOKEN_SEEDS: readonly DefaultTokenSeed[] = []

export function seedsForChain(chainId: number): DefaultTokenSeed[] {
	return DEFAULT_TOKEN_SEEDS.filter((s) => s.chainId === chainId)
}

export function findSeed(chainId: number, contract: string): DefaultTokenSeed | undefined {
	return DEFAULT_TOKEN_SEEDS.find((s) => s.chainId === chainId && s.contract.toLowerCase() === contract.toLowerCase())
}
