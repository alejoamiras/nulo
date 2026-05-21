import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"

/**
 * Resolve the chain info passed to wallet-sdk discovery.
 *
 * Precedence (per plan-v2 §5):
 *   1. URL ?chainId=…&version=… (test-driver override)
 *   2. VITE_CHAIN_ID / VITE_CHAIN_VERSION env (build-time pin)
 *   3. Fr.ZERO / Fr.ZERO (permissive — matches any wallet)
 *
 * The wildcard fallback mirrors the playground's behavior. Production
 * should pin via env before public launch (open question §13).
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
