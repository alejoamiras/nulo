// Patch WalletSchema before wallet-sdk reads it (Nulo-custom `registerToken`).
// Must be the first import in this module — see nulo-schema-patch.ts header.
import "@/lib/nulo-schema-patch"

import type { Wallet } from "@aztec/aztec.js/wallet"
import { WalletManager } from "@aztec/wallet-sdk/manager"
import type { PendingConnection, WalletProvider } from "@aztec/wallet-sdk/manager"
import { ref } from "vue"
import { readChainInfo } from "@/lib/chain-info"
import { hashToEmoji } from "@/lib/emoji"
import { type NormalizedError, normalizeError } from "@/lib/errors"

export type ConnectStatus = "idle" | "discovering" | "verifying" | "capability-approval" | "setting-up" | "connected" | "error"

export interface GrantedAccount {
	readonly address: string
	readonly alias: string
}

/**
 * Per-feature config for an Aztec wallet session. The faucet and the bridge each create ONE
 * session (a module-level singleton) with their own appId, capability manifest, and contract
 * registration — the codex finding: two independent sessions, not one shared connection.
 */
export interface AztecWalletSessionConfig {
	readonly appId: string
	/** Build the wallet-sdk capability manifest at connect time (async — needs the SponsoredFPC). */
	// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred, not exported usably.
	readonly buildManifest: () => Promise<any>
	/** Register the feature's contracts with the wallet's PXE after capabilities are granted. */
	readonly registerContracts: (wallet: Wallet) => Promise<void>
}

/**
 * Create an Aztec wallet session: discover → verify (emoji match) → request capabilities →
 * register contracts → connected. Returns reactive state + the connection methods. Call ONCE
 * per feature at module scope (singleton) — `useWalletConnection` / `useBridgeWallet` wrap it.
 */
export function createAztecWalletSession(config: AztecWalletSessionConfig) {
	const status = ref<ConnectStatus>("idle")
	const verificationEmojis = ref<string | null>(null)
	const accounts = ref<GrantedAccount[]>([])
	const selectedAccount = ref<string | null>(null)
	const error = ref<NormalizedError | null>(null)
	const wallet = ref<Wallet | null>(null)

	let provider: WalletProvider | null = null
	let pending: PendingConnection | null = null
	let cancelDiscovery: (() => void) | null = null
	let unsubscribeDisconnect: (() => void) | null = null

	async function connect(): Promise<void> {
		if (status.value === "connected" || status.value === "discovering" || status.value === "verifying") {
			return
		}
		error.value = null
		status.value = "discovering"

		try {
			const manager = WalletManager.configure({ extensions: { enabled: true } })
			const discovery = manager.getAvailableWallets({
				chainInfo: readChainInfo(),
				appId: config.appId,
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
			// Wallet-side disconnect (extension reload, user revokes session) must reset the dApp
			// state too — otherwise we hold a stale Wallet handle and the next call silently does nothing.
			unsubscribeDisconnect = firstProvider.onDisconnect(() => {
				cleanupSession()
				status.value = "idle"
			})

			status.value = "verifying"
			const p = await firstProvider.establishSecureChannel(config.appId)
			pending = p
			verificationEmojis.value = hashToEmoji(p.verificationHash)
		} catch (err) {
			error.value = normalizeError(err)
			status.value = "error"
			cleanupSession()
		}
	}

	async function confirmVerification(): Promise<void> {
		if (!pending) return
		try {
			const w = await pending.confirm()
			wallet.value = w
			pending = null
			verificationEmojis.value = null
			status.value = "capability-approval"
			await requestCapabilities()
		} catch (err) {
			console.error(`[${config.appId}] confirmVerification failed`, err)
			error.value = normalizeError(err)
			status.value = "error"
			cleanupSession()
		}
	}

	async function cancelVerification(): Promise<void> {
		if (pending) {
			try {
				await pending.cancel()
			} catch {
				// best-effort
			}
			pending = null
		}
		verificationEmojis.value = null
		cleanupSession()
		status.value = "idle"
		error.value = null
	}

	async function retryCapabilities(): Promise<void> {
		if (!wallet.value) return
		error.value = null
		status.value = "capability-approval"
		await requestCapabilities()
	}

	async function disconnect(): Promise<void> {
		cancelDiscovery?.()
		cancelDiscovery = null
		if (provider) {
			try {
				await provider.disconnect()
			} catch {
				// best-effort
			}
		}
		cleanupSession()
		status.value = "idle"
		error.value = null
	}

	async function requestCapabilities(): Promise<void> {
		if (!wallet.value) return
		try {
			const manifest = await config.buildManifest()
			// SDK uses zod-inferred AppCapabilities; the manifest shape is structurally compatible
			// but the public type is not exported in a usable form. Single typed-boundary cast.
			// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred
			const result = await wallet.value.requestCapabilities(manifest as any)
			const granted = extractGrantedAccounts(result)
			accounts.value = granted
			selectedAccount.value = granted[0]?.address ?? null

			if (granted.length === 0) {
				throw new Error("No accounts granted by wallet")
			}

			// The user already clicked Approve — we're now doing post-approval setup (registering
			// contracts with the wallet's PXE). This can take 2-4s, so a dedicated state keeps the
			// UI from saying "Awaiting permissions".
			status.value = "setting-up"
			await config.registerContracts(wallet.value)

			status.value = "connected"
		} catch (err) {
			console.error(`[${config.appId}] requestCapabilities failed`, err)
			error.value = normalizeError(err)
			status.value = "error"
		}
	}

	function cleanupSession(): void {
		if (unsubscribeDisconnect) {
			try {
				unsubscribeDisconnect()
			} catch {
				// best-effort
			}
			unsubscribeDisconnect = null
		}
		provider = null
		pending = null
		cancelDiscovery = null
		wallet.value = null
		accounts.value = []
		selectedAccount.value = null
		verificationEmojis.value = null
	}

	/** Reset all state (test helper + hard reset). */
	function reset(): void {
		cleanupSession()
		status.value = "idle"
		error.value = null
	}

	return {
		status,
		verificationEmojis,
		accounts,
		selectedAccount,
		error,
		wallet,
		connect,
		confirmVerification,
		cancelVerification,
		retryCapabilities,
		disconnect,
		reset,
	}
}

interface GrantedAccountsCap {
	type: "accounts"
	accounts?: Array<{ alias?: string; item?: { toString(): string } | string }>
}

export function extractGrantedAccounts(result: unknown): GrantedAccount[] {
	if (!result || typeof result !== "object") return []
	const granted = (result as { granted?: unknown[] }).granted
	if (!Array.isArray(granted)) return []
	const cap = granted.find((c): c is GrantedAccountsCap => {
		return typeof c === "object" && c !== null && (c as { type?: unknown }).type === "accounts"
	})
	if (!cap?.accounts) return []
	return cap.accounts.map((a) => ({
		address: typeof a.item === "string" ? a.item : (a.item?.toString() ?? ""),
		alias: a.alias ?? "",
	}))
}
