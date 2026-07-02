/**
 * Single source of truth for the faucet's alpha-testnet chain identity.
 *
 * The faucet is testnet-only, so these are CONSTANTS with deliberately NO
 * `VITE_CHAIN_*` env override: a stale Cloudflare `VITE_CHAIN_VERSION=4127419662`
 * once shadowed the correct value, yielding wallet chainId `4138294185` — which
 * the V5 wallet (`2793892258`) has no network for ("No network configured for
 * chainId 4138294185"). `chain-info.ts` (runtime wallet-sdk discovery) and the
 * build-metadata plugin both read from here, so they cannot drift. URL query
 * params remain the only override, for the e2e test driver.
 *
 * Mirrors the wallet's `DEFAULT_SEEDS` testnet entry
 * (`apps/extension/src/wallet/services/network/service.ts`).
 *
 * Plain numbers + no imports on purpose: this module is importable from both
 * the app bundle and `vite.config.ts` (Node) without pulling `@aztec/*`.
 */

/** Sepolia — the L1 the alpha-testnet rollup settles to. */
export const TESTNET_L1_CHAIN_ID = 11155111
/** V5 alpha-testnet rollup version. */
export const TESTNET_ROLLUP_VERSION = 2787991301

/** The wallet matches a network by `(l1 ^ rollupVersion) >>> 0` → `2793892258`. */
export const TESTNET_WALLET_CHAIN_ID = (TESTNET_L1_CHAIN_ID ^ TESTNET_ROLLUP_VERSION) >>> 0
