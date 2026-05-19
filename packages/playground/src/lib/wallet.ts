/**
 * Wallet-sdk discovery + secure-channel wiring.
 *
 * Canonical refactor (Phase 2B): account state is sourced from
 * `requestCapabilities().granted.accounts`, not from a post-connect
 * `wallet.getAccounts()` call. Per wallet-sdk skill, the canonical post-confirm
 * flow is:
 *   1) connect → status=connected, accounts=[]
 *   2) requestCapabilities(manifest) → granted accounts populate state
 * `wallet.getAccounts()` is kept available as a fallback path for tests that
 * explicitly exercise it.
 */
import { WalletManager, type WalletProvider } from "@aztec/wallet-sdk/manager"
import type { Wallet } from "@aztec/aztec.js/wallet"
import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/foundation/curves/bn254"
import { setState, getState } from "../state"
import type { AppCapabilitiesManifest } from "./bundles"

const APP_ID = "nulo-playground"

/**
 * Permissive ChainInfo filter — Fr.ZERO/Fr.ZERO matches any wallet that
 * responds to discovery. The Nulo extension doesn't reject discovery on
 * chainInfo mismatch, so this works for the local sandbox.
 *
 * For non-local testing the test driver can override via `?chainId=N&version=M`
 * query params (parsed below).
 */
function readChainInfo(): ChainInfo {
	const url = new URL(window.location.href)
	const chainIdParam = url.searchParams.get("chainId")
	const versionParam = url.searchParams.get("version")
	return {
		chainId: chainIdParam ? Fr.fromString(chainIdParam) : Fr.ZERO,
		version: versionParam ? Fr.fromString(versionParam) : Fr.ZERO,
	}
}

let wallet: Wallet | null = null
let provider: WalletProvider | null = null
let cancelDiscovery: (() => void) | null = null

export function getWallet(): Wallet | null {
	return wallet
}

export function getProvider(): WalletProvider | null {
	return provider
}

/**
 * Drive the full handshake from the dApp side:
 *   1) WalletManager.configure → getAvailableWallets (yields the Nulo extension)
 *   2) provider.establishSecureChannel(APP_ID) → PendingConnection (after user Allow)
 *   3) pendingConnection.confirm() → Wallet (after user verify-confirm)
 *
 * Status transitions are reflected in `state.status` so the test driver can
 * deterministically wait for "connected". Accounts arrive later via
 * `requestCapabilities()` — connect leaves `state.accounts` empty by design.
 */
export async function connect(): Promise<void> {
	if (getState().status === "connected") return

	setState({ status: "discovering", lastError: null })

	const manager = WalletManager.configure({ extensions: { enabled: true } })
	const discovery = manager.getAvailableWallets({
		chainInfo: readChainInfo(),
		appId: APP_ID,
		timeout: 60_000,
	})
	cancelDiscovery = discovery.cancel

	let firstProvider: WalletProvider | undefined
	for await (const p of discovery.wallets) {
		firstProvider = p
		break
	}
	cancelDiscovery = null

	if (!firstProvider) {
		throw new Error("No wallet discovered")
	}
	provider = firstProvider

	setState({ status: "verifying" })

	const pending = await provider.establishSecureChannel(APP_ID)
	wallet = await pending.confirm()

	setState({ status: "connected", accounts: [], selectedAccount: null })
}

type GrantedAccountsCap = {
	type: "accounts"
	accounts?: Array<{ alias?: string; item?: { toString(): string } | string }>
}

/**
 * Extract accounts from the granted side of a `requestCapabilities()` response.
 * Handles both the canonical `{ alias, item }` shape and looser raw-address
 * arrays the dispatcher might emit.
 */
function extractGrantedAccounts(result: unknown): { address: string; name: string }[] {
	if (!result || typeof result !== "object") return []
	const granted = (result as { granted?: unknown[] }).granted
	if (!Array.isArray(granted)) return []
	const cap = granted.find((c): c is GrantedAccountsCap => {
		return typeof c === "object" && c !== null && (c as { type?: unknown }).type === "accounts"
	})
	if (!cap?.accounts) return []
	return cap.accounts.map((a) => {
		const address = typeof a.item === "string" ? a.item : (a.item?.toString() ?? "")
		return { address, name: a.alias ?? "" }
	})
}

/**
 * Call `wallet.requestCapabilities(manifest)` after a successful connect. The
 * extension shows /windows/capabilities; user approves; the granted side
 * carries the actual list of approved accounts which we use as source-of-truth
 * for `state.accounts` / `state.selectedAccount`.
 */
export async function requestCapabilities(manifest: AppCapabilitiesManifest): Promise<unknown> {
	if (!wallet) throw new Error("Not connected — call connect() first")
	// biome-ignore lint/suspicious/noExplicitAny: SDK's AppCapabilities type uses zod-inferred shape; structural compatibility checked at runtime
	const result = await wallet.requestCapabilities(manifest as any)

	const granted = extractGrantedAccounts(result)
	if (granted.length > 0) {
		setState({ accounts: granted, selectedAccount: granted[0]?.address ?? null })
	}

	return result
}

export async function disconnect(): Promise<void> {
	cancelDiscovery?.()
	cancelDiscovery = null
	if (provider) {
		try {
			await provider.disconnect()
		} catch {
			// best-effort
		}
	}
	provider = null
	wallet = null
	setState({ status: "disconnected", accounts: [], selectedAccount: null, chainId: null })
}

export function getAppId(): string {
	return APP_ID
}
