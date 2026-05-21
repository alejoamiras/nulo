import type { Wallet } from "@aztec/aztec.js/wallet"
import { WalletManager } from "@aztec/wallet-sdk/manager"
import type { PendingConnection, WalletProvider } from "@aztec/wallet-sdk/manager"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { ref } from "vue"
import { DRIPPER, ETH, rebuildDripperInstance, rebuildEthInstance, rebuildUsdcInstance, USDC } from "@/contracts/deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { buildFaucetManifest } from "@/lib/capabilities"
import { readChainInfo } from "@/lib/chain-info"
import { hashToEmoji } from "@/lib/emoji"
import { type NormalizedError, normalizeError } from "@/lib/errors"

const APP_ID = "nulo-faucet"

export type ConnectStatus = "idle" | "discovering" | "verifying" | "capability-approval" | "setting-up" | "connected" | "error"

export interface GrantedAccount {
	readonly address: string
	readonly alias: string
}

// Module-level singletons — one tab = one connection. Tests call
// __resetWalletConnectionForTests() between cases.
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

export function useWalletConnection() {
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
	}
}

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
		// Wallet-side disconnect (extension reload, user revokes session)
		// must reset the dApp state too — otherwise we hold a stale Wallet
		// handle and the next drip silently does nothing.
		unsubscribeDisconnect = firstProvider.onDisconnect(() => {
			cleanupSession()
			status.value = "idle"
		})

		status.value = "verifying"
		const p = await firstProvider.establishSecureChannel(APP_ID)
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
		console.error("[faucet] confirmVerification failed", err)
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
		const sponsoredFpc = await getSponsoredFpcInstance()
		const manifest = buildFaucetManifest({
			dripperAddress: DRIPPER,
			usdcAddress: USDC,
			ethAddress: ETH,
			sponsoredFpcAddress: sponsoredFpc.address,
		})
		// SDK uses zod-inferred AppCapabilities; the manifest shape is
		// structurally compatible but the public type is not exported in a
		// usable form. Single typed-boundary cast.
		// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred
		const result = await wallet.value.requestCapabilities(manifest as any)
		const granted = extractGrantedAccounts(result)
		accounts.value = granted
		selectedAccount.value = granted[0]?.address ?? null

		if (granted.length === 0) {
			throw new Error("No accounts granted by wallet")
		}

		// The user already clicked Approve — we're now doing post-approval
		// setup (registering contracts with the wallet's PXE). This can
		// take 2-4s, so transition to a dedicated state so the UI doesn't
		// keep saying "Awaiting permissions".
		status.value = "setting-up"
		await registerFaucetContracts(wallet.value)

		status.value = "connected"
	} catch (err) {
		console.error("[faucet] requestCapabilities failed", err)
		error.value = normalizeError(err)
		status.value = "error"
	}
}

async function registerFaucetContracts(w: Wallet): Promise<void> {
	const [dripperInst, usdcInst, ethInst] = await Promise.all([rebuildDripperInstance(), rebuildUsdcInstance(), rebuildEthInstance()])
	await w.registerContract(dripperInst, DripperContractArtifact)
	await w.registerContract(usdcInst, TokenContractArtifact)
	await w.registerContract(ethInst, TokenContractArtifact)
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

/** Test-only: clear state between cases. */
export function __resetWalletConnectionForTests(): void {
	cleanupSession()
	status.value = "idle"
	error.value = null
}
