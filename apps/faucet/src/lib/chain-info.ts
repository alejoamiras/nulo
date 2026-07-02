import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"
import { TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION } from "./chain-constants"

/**
 * Resolve the chain info passed to wallet-sdk discovery.
 *
 * Precedence:
 *   1. URL ?chainId=…&version=… (e2e test-driver override ONLY)
 *   2. The testnet constants (`chain-constants.ts` — the faucet's only target)
 *
 * There is deliberately NO `VITE_CHAIN_*` env override anymore: a stale
 * Cloudflare `VITE_CHAIN_VERSION=4127419662` once shadowed the correct value and
 * broke the wallet handshake in prod ("No network configured for chainId
 * 4138294185"). The faucet is testnet-only; the identity is a compile-time
 * constant single-sourced from `chain-constants.ts` so it cannot drift.
 *
 * (The `Fr.ZERO` wildcard was a prior UX hole — zero resolves to the wallet's
 * "Local Network" seed at `chainId === 0`, loading the capabilities popup with
 * no accounts. Defaulting to the testnet pair avoids that in dev too.)
 */
export function readChainInfo(url: URL = new URL(window.location.href)): ChainInfo {
	const queryChainId = url.searchParams.get("chainId")
	const queryVersion = url.searchParams.get("version")
	return {
		chainId: parseField(queryChainId ?? String(TESTNET_L1_CHAIN_ID)),
		version: parseField(queryVersion ?? String(TESTNET_ROLLUP_VERSION)),
	}
}

function parseField(raw: string | undefined): Fr {
	if (!raw) return Fr.ZERO
	return Fr.fromString(raw)
}
