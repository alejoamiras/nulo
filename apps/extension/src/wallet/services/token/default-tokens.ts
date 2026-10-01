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
 */

import { CHAIN_IDS } from "@/utils/chain-ids"

/** The L2 tokens unleashed's testnet generation pre-creates (`bridge.tokens[].l2Token` in its
 *  `apps/tools/public/testnet-bridge.json`), deployed by its hub. A new generation moves them; the
 *  aztec-update skill's reset step re-points them here, which moves the seeds and the price map. */
export const TESTNET_TOKENS = {
	USDC: "0x13c87a385b8f3db8383ed873c6741d13f12b14ec57d597eece3f94f1230edffc",
	USDT: "0x1de9adfe7950a24885eebfa5b19a971b673e0a444bfc8ec07372abc4647c3ed2",
	EURC: "0x11ce3b1b90841b47058a5b1c230399cf3b4612ee2bb990d4831be70f6b624a33",
	GBPC: "0x0449820d169281c91a161c193261ba54fa194b51f4dab50ae766074e23b8b74e",
} as const

/** Live-captured 2026-10-01 from the Testnet node for all four tokens (original == current): the
 *  aztec-standards 6.0.0-rc.1 Token class. Their symbols, names ("Test USDC", …) and 6 decimals
 *  came from `seed-preflight-metadata.ts` the same day. */
const TESTNET_TOKEN_CLASS_ID = "0x24c34002788720c941a327a20c369b12c8bdcff3b5a974673a8f618763471505"

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

export const DEFAULT_TOKEN_SEEDS: readonly DefaultTokenSeed[] = [
	{
		chainId: CHAIN_IDS.TESTNET,
		contract: TESTNET_TOKENS.USDC,
		expectedClassId: TESTNET_TOKEN_CLASS_ID,
		expectedSymbol: "USDC",
		displayName: "Test USDC",
	},
	{
		chainId: CHAIN_IDS.TESTNET,
		contract: TESTNET_TOKENS.USDT,
		expectedClassId: TESTNET_TOKEN_CLASS_ID,
		expectedSymbol: "USDT",
		displayName: "Test USDT",
	},
	{
		chainId: CHAIN_IDS.TESTNET,
		contract: TESTNET_TOKENS.EURC,
		expectedClassId: TESTNET_TOKEN_CLASS_ID,
		expectedSymbol: "EURC",
		displayName: "Test EURC",
	},
	{
		chainId: CHAIN_IDS.TESTNET,
		contract: TESTNET_TOKENS.GBPC,
		expectedClassId: TESTNET_TOKEN_CLASS_ID,
		expectedSymbol: "GBPC",
		displayName: "Test GBPC",
	},
]

export function seedsForChain(chainId: number): DefaultTokenSeed[] {
	return DEFAULT_TOKEN_SEEDS.filter((s) => s.chainId === chainId)
}

export function findSeed(chainId: number, contract: string): DefaultTokenSeed | undefined {
	return DEFAULT_TOKEN_SEEDS.find((s) => s.chainId === chainId && s.contract.toLowerCase() === contract.toLowerCase())
}
