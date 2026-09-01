/**
 * The two build targets, selected at BUILD TIME by which vite config is used — never at runtime and
 * never from a Cloudflare dashboard var (the `chain-constants` incident). This is the "config factory"
 * spine: each `vite.<target>.config.mts` imports one `FaucetTarget` and threads it into (a) a `define`
 * that the app reads via `resolveFaucetTarget()` and (b) `buildMetaPlugin(target)` for `build.json`.
 *
 * Node-safe (imports only the plain-number `chain-constants`, no `viem`/`@aztec`), so `vite.config.ts`
 * can import it in Node scope — the same reason a vite `resolve.alias` can't carry chain identity into
 * `build.json` (codex round-1 Critical). The app ALSO imports it (for the type + the testnet fallback);
 * that's fine because it pulls in no browser-hostile deps.
 */
import {
	MAINNET_L1_CHAIN_ID,
	MAINNET_ROLLUP_VERSION,
	MAINNET_WALLET_CHAIN_ID,
	TESTNET_L1_CHAIN_ID,
	TESTNET_ROLLUP_VERSION,
	TESTNET_WALLET_CHAIN_ID,
} from "./chain-constants"

export type FaucetTargetKey = "testnet" | "mainnet"

export interface FaucetTarget {
	key: FaucetTargetKey
	/** L1 (Ethereum) chain id — viem clients + the Permit2 EIP-712 domain bind to this. */
	l1ChainId: number
	/** Aztec rollup version (the wallet-handshake `version`). */
	rollupVersion: number
	/** `(l1 ^ rollupVersion) >>> 0` — the wallet-handshake chain id + `build.json` chainId. */
	walletChainId: number
	/** Bridge manifest bundled for this target (relative to `public/`). */
	manifestFile: string
	/** The hostname this build belongs at — integrity layer 5 asserts `location.hostname` matches. */
	host: string
	/** Aztec node RPC endpoint (overridable in dev/e2e via VITE_AZTEC_NODE_URL). */
	nodeUrl: string
	/** L1 block-explorer base (Etherscan-style), no trailing slash. */
	l1ExplorerBaseUrl: string
	/** CSP `connect-src` for this target — the node host MUST be listed or the app can't reach it. */
	cspConnectSrc: string
}

export const TESTNET_TARGET: FaucetTarget = {
	key: "testnet",
	l1ChainId: TESTNET_L1_CHAIN_ID,
	rollupVersion: TESTNET_ROLLUP_VERSION,
	walletChainId: TESTNET_WALLET_CHAIN_ID,
	manifestFile: "testnet-bridge.json",
	host: "testnet.tools.nulo.sh",
	nodeUrl: "https://v5.testnet.rpc.aztec-labs.com",
	l1ExplorerBaseUrl: "https://sepolia.etherscan.io",
	// Verbatim the pre-two-network CSP (public/_headers) — the aztec-labs/aztec.network node hosts.
	cspConnectSrc: "'self' data: blob: https://*.aztec.network wss://*.aztec.network https://*.aztec-labs.com wss://*.aztec-labs.com",
}

export const MAINNET_TARGET: FaucetTarget = {
	key: "mainnet",
	l1ChainId: MAINNET_L1_CHAIN_ID,
	rollupVersion: MAINNET_ROLLUP_VERSION,
	walletChainId: MAINNET_WALLET_CHAIN_ID,
	manifestFile: "mainnet-bridge.json",
	host: "tools.nulo.sh",
	// The Alpha node — the same dRPC host the extension pins (apps/extension .../network/service.ts).
	nodeUrl: "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k",
	l1ExplorerBaseUrl: "https://etherscan.io",
	// The Alpha node lives at lb.drpc.live — it MUST be in connect-src or the mainnet build can't
	// reach its own node (the testnet CSP's *.aztec-labs.com does NOT cover it).
	cspConnectSrc: "'self' data: blob: https://lb.drpc.live wss://lb.drpc.live",
}

export const TARGETS: Record<FaucetTargetKey, FaucetTarget> = {
	testnet: TESTNET_TARGET,
	mainnet: MAINNET_TARGET,
}

/**
 * Resolve the active build target from the value `define`d by the vite config (`VITE_FAUCET_TARGET`).
 * Falls back to testnet when unset — i.e. under vitest (no define) and the default `vite build`, so
 * unit tests and the legacy testnet build keep working unchanged.
 */
export function resolveFaucetTarget(): FaucetTarget {
	const key = import.meta.env.VITE_FAUCET_TARGET as FaucetTargetKey | undefined
	return (key && TARGETS[key]) || TESTNET_TARGET
}
