import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"

/**
 * Resolve the chain info passed to wallet-sdk discovery.
 *
 * Precedence:
 *   1. URL ?chainId=…&version=… (test-driver override)
 *   2. VITE_CHAIN_ID / VITE_CHAIN_VERSION env (build-time pin)
 *   3. Testnet defaults (the faucet's only deployed target - see README)
 *
 * The faucet is testnet-only by design. The `Fr.ZERO / Fr.ZERO` wildcard
 * fallback was previously thought "fine for dev" but it triggers a UX hole:
 * the wallet has a "Local Network" seed pinned at `chainId === 0`, so
 * sending zero resolves to that seed instead of the user's actual testnet
 * accounts. The capabilities popup then loads with `availableAccounts: []`,
 * the user clicks Approve, and every subsequent op fails with
 * "No accounts authorized." Defaulting to the testnet's encoded chain
 * pair makes the matcher resolve to the right network in dev too.
 *
 * Values mirror the wallet's `DEFAULT_SEEDS` testnet entry:
 *   L1 chain ID: 11155111 (Sepolia)
 *   Rollup version: 4127419662 (alpha-testnet)
 */
const TESTNET_CHAIN_ID = "11155111"
const TESTNET_ROLLUP_VERSION = "4127419662"

export function readChainInfo(url: URL = new URL(window.location.href)): ChainInfo {
	const queryChainId = url.searchParams.get("chainId")
	const queryVersion = url.searchParams.get("version")
	return {
		chainId: parseField(queryChainId ?? import.meta.env.VITE_CHAIN_ID ?? TESTNET_CHAIN_ID),
		version: parseField(queryVersion ?? import.meta.env.VITE_CHAIN_VERSION ?? TESTNET_ROLLUP_VERSION),
	}
}

function parseField(raw: string | undefined): Fr {
	if (!raw) return Fr.ZERO
	return Fr.fromString(raw)
}
