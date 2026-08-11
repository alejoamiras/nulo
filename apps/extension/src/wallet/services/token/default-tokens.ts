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
 * - `expectedSymbol`: product intent (what the wallet is SUPPOSED to list);
 *   chain metadata disagreeing means we should not silently seed it.
 * - decimals cannot be captured without a live simulation, so it is
 *   bounds-checked (0..18) at seed time and recorded in the seed marker for
 *   manual QA confirmation, not equality-pinned.
 *
 * Testnet note (2026-07-21): cUSD is NOT currently deployed on the live V5
 * testnet (chainId 1816023401) — the 2026-07 reset wiped it. Add the testnet
 * entry (same deterministic address, re-run the preflight for its pins) once
 * it is redeployed. The price map already carries the testnet mapping.
 */

import { CHAIN_IDS } from "@/utils/chain-ids"

export type DefaultTokenSeed = {
	chainId: number
	contract: string
	/** TOFU pin: `currentContractClassId` the instance must present. */
	expectedClassId: string
	/** Product-intent pin: chain symbol must match exactly. */
	expectedSymbol: string
}

export const DEFAULT_TOKEN_SEEDS: readonly DefaultTokenSeed[] = [
	{
		chainId: CHAIN_IDS.MAINNET,
		contract: "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6",
		// Live-captured 2026-07-21 (node + aztecscan agree); original == current.
		expectedClassId: "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf",
		// Live-captured 2026-08-11 via seed-preflight-metadata.ts (standards
		// layout): symbol "cUSDC", name "Clean USDC", decimals 6. The original
		// "cUSD" pin was product intent captured with the WRONG storage layout
		// (upstream sample Token, not aztec-standards), so the seeder correctly
		// hard-skipped this token on every unlock since the pin landed.
		expectedSymbol: "cUSDC",
	},
	{
		chainId: CHAIN_IDS.MAINNET,
		// Nulo's bridged Circle USDC — the L2 side of the tools.nulo.sh bridge (1:1 vs L1 USDC).
		contract: "0x03bd1289e403c74cc919b2ead9f39e38e5f9ae044e56348bfc218c0a160232b4",
		// Live-captured 2026-07-27 from the Alpha node; original == current; same
		// aztec-standards Token class as cUSD.
		expectedClassId: "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf",
		expectedSymbol: "USDC",
	},
	{
		chainId: CHAIN_IDS.TESTNET,
		// Testnet "Test USDC" — the L2 side of the tools bridge on Testnet (faucet-minted,
		// permissionless; same address as apps/faucet/public/testnet-bridge.json).
		contract: "0x1c81a6d581e065e82d4d3b969020e9d0f899b975ae844f6e4305031ff62be9ae",
		// Live-captured 2026-07-28 from the Testnet node; original == current; same
		// aztec-standards Token class as the mainnet tokens.
		expectedClassId: "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf",
		expectedSymbol: "USDC",
	},
]

export function seedsForChain(chainId: number): DefaultTokenSeed[] {
	return DEFAULT_TOKEN_SEEDS.filter((s) => s.chainId === chainId)
}

export function findSeed(chainId: number, contract: string): DefaultTokenSeed | undefined {
	return DEFAULT_TOKEN_SEEDS.find((s) => s.chainId === chainId && s.contract.toLowerCase() === contract.toLowerCase())
}
