/**
 * Static price mapping: which CoinGecko id prices which asset, per chain.
 *
 * Aztec-native tokens are too new to be indexed anywhere, so each entry
 * maps to an Ethereum-side proxy ticker (cUSD → USDC, Fee Juice → AZTEC).
 * The wallet always fetches the FULL id set in one batched request — the
 * query never varies with holdings, so the request reveals nothing about
 * what the user owns.
 *
 * `sanity` is a hard accept-band in USD. Quotes outside it are rejected at
 * write AND read time — a poisoned or garbage response can never enter (or
 * survive in) the cache. Bands are per-id because "absurd" differs by four
 * orders of magnitude between a stablecoin and AZTEC.
 */

import { CHAIN_IDS } from "@/utils/chain-ids"

export type PriceMapEntry = {
	coingeckoId: string
	/** Hard accept-band (USD). Outside → the quote is dropped for this id. */
	sanity: { min: number; max: number }
}

const USDC: PriceMapEntry = {
	coingeckoId: "usd-coin",
	// A stablecoin quote outside [0.20, 5] is provider garbage, not a depeg.
	sanity: { min: 0.2, max: 5 },
}

/** Fee Juice is priced as AZTEC on every chain (1 FJ = 1 AZTEC, per plan Ask 3). */
export const FEE_JUICE_ENTRY: PriceMapEntry = {
	coingeckoId: "aztec",
	sanity: { min: 0.000_1, max: 100 },
}

const CUSD_CONTRACT = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
/** Nulo's bridged Circle USDC on Alpha — the L2 side of the tools.nulo.sh bridge
 *  (apps/faucet/public/mainnet-bridge.json `l2.token`; 1:1 against L1 USDC 0xA0b8…eB48). */
const NULO_BRIDGED_USDC_MAINNET = "0x03bd1289e403c74cc919b2ead9f39e38e5f9ae044e56348bfc218c0a160232b4"
/** Testnet "Test USDC" — the L2 side of the tools bridge on Testnet
 *  (apps/faucet/public/testnet-bridge.json `l2.token`; faucet-minted, priced as USDC). */
const NULO_BRIDGED_USDC_TESTNET = "0x1c81a6d581e065e82d4d3b969020e9d0f899b975ae844f6e4305031ff62be9ae"

/**
 * E2E-ONLY sandbox rule: with `VITE_NULO_E2E_PRICE_MAP=1` (set exclusively by
 * the network-e2e agent build), EVERY contract on the sandbox chain (id 0)
 * prices as USDC — sandbox token addresses are minted per run, so a
 * build-time address map can't cover them. Statically false in prod builds →
 * the branch and its build stamp are DCE-stripped (same discipline as
 * E2E_PROVERLESS; `_build-extension.yml` greps release bundles for the stamp).
 */
const E2E_SANDBOX_PRICE_MAP = (import.meta.env.VITE_NULO_E2E_PRICE_MAP ?? "") === "1"

/** (chainId, lowercase contract address) → price-map entry. */
const TOKEN_ENTRIES: ReadonlyMap<string, PriceMapEntry> = new Map([
	[`${CHAIN_IDS.MAINNET}:${CUSD_CONTRACT}`, USDC],
	[`${CHAIN_IDS.TESTNET}:${CUSD_CONTRACT}`, USDC],
	[`${CHAIN_IDS.MAINNET}:${NULO_BRIDGED_USDC_MAINNET}`, USDC],
	[`${CHAIN_IDS.TESTNET}:${NULO_BRIDGED_USDC_TESTNET}`, USDC],
])

export function getPriceMapEntry(chainId: number, contract: string): PriceMapEntry | undefined {
	if (E2E_SANDBOX_PRICE_MAP && chainId === 0) {
		// The stamp is LIVE DATA on the returned entry — an unused export gets
		// tree-shaken even in ARMED builds, which made the release grep a
		// false-negative guard. Inside the kept branch, the string survives
		// exactly when the rule does; `_build-extension.yml` greps for it AND
		// fails fast if the env var is set at all.
		return { ...USDC, e2eStamp: "NULO_E2E_PRICE_MAP_BUILD_STAMP" } as PriceMapEntry
	}
	return TOKEN_ENTRIES.get(`${chainId}:${contract.toLowerCase()}`)
}

/** Human ticker for the proxy pricing an id represents — powers the explicit
 *  `via USDC` labeling everywhere a proxy quote drives UI. */
export function proxyTickerFor(coingeckoId: string): string | undefined {
	return { "usd-coin": "USDC", aztec: "AZTEC" }[coingeckoId]
}

export function getSanityBand(coingeckoId: string): { min: number; max: number } | undefined {
	if (coingeckoId === FEE_JUICE_ENTRY.coingeckoId) return FEE_JUICE_ENTRY.sanity
	for (const entry of TOKEN_ENTRIES.values()) {
		if (entry.coingeckoId === coingeckoId) return entry.sanity
	}
	return undefined
}

/**
 * The full batched query set: every mapped id, deduped and sorted so the
 * request string is stable across refreshes and installs.
 */
export function allCoingeckoIds(): string[] {
	const ids = new Set<string>([FEE_JUICE_ENTRY.coingeckoId])
	for (const entry of TOKEN_ENTRIES.values()) {
		ids.add(entry.coingeckoId)
	}
	return [...ids].sort()
}
