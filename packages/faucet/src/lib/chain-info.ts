import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"

/**
 * Resolve the chain info passed to wallet-sdk discovery.
 *
 * Precedence:
 *   1. URL ?chainId=…&version=… (test-driver override)
 *   2. VITE_CHAIN_ID / VITE_CHAIN_VERSION env (build-time pin)
 *   3. Fr.ZERO / Fr.ZERO (permissive — matches any wallet)
 *
 * The wildcard fallback is fine for dev; production should pin via env
 * so the wallet's chainInfo matcher rejects accidental cross-network use.
 */
export function readChainInfo(url: URL = new URL(window.location.href)): ChainInfo {
	const queryChainId = url.searchParams.get("chainId")
	const queryVersion = url.searchParams.get("version")
	return {
		chainId: parseField(queryChainId ?? import.meta.env.VITE_CHAIN_ID),
		version: parseField(queryVersion ?? import.meta.env.VITE_CHAIN_VERSION),
	}
}

function parseField(raw: string | undefined): Fr {
	if (!raw) return Fr.ZERO
	return Fr.fromString(raw)
}
