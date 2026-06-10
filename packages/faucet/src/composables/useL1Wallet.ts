import { type Address, createPublicClient, createWalletClient, custom, type EIP1193Provider, http, type WalletClient } from "viem"
import { sepolia } from "viem/chains"
import { computed, ref, shallowRef } from "vue"

/**
 * Thin canonical-viem L1 (Sepolia) wallet — connect an injected wallet (Rabby / MetaMask),
 * track account + chain, switch to Sepolia. Canonical viem ON PURPOSE: the Aztec stack's
 * `@aztec/viem` fork lacks exports wagmi needs, so the L1 side stays on stock viem. It meets
 * `@nulo/bridge-core` only at the PRIMITIVE boundary (addresses / amounts), never by sharing
 * viem `WalletClient` / `Chain` types across the canonical↔fork line.
 *
 * Module-level singleton — one L1 connection shared across the Bridge tab's components
 * (L1WalletPanel connects; useDeposit + DepositCard read the same state).
 */
function getProvider(): EIP1193Provider | undefined {
	if (typeof window === "undefined") return undefined
	return (window as Window & { ethereum?: EIP1193Provider }).ethereum
}

const publicClient = createPublicClient({ chain: sepolia, transport: http() })

const address = ref<Address | null>(null)
const chainId = ref<number | null>(null)
const isConnecting = ref(false)
const error = ref<string | null>(null)
const walletClient = shallowRef<WalletClient | null>(null)

const isConnected = computed(() => address.value !== null)
const wrongChain = computed(() => isConnected.value && chainId.value !== sepolia.id)

function onAccountsChanged(accounts: readonly string[]) {
	address.value = (accounts[0] as Address | undefined) ?? null
	const provider = getProvider()
	// Rebuild the walletClient on account change — otherwise it keeps signing as the old account.
	walletClient.value =
		address.value && provider ? createWalletClient({ account: address.value, chain: sepolia, transport: custom(provider) }) : null
}
function onChainChanged(hexChainId: string) {
	chainId.value = Number.parseInt(hexChainId, 16)
}

async function connect() {
	const provider = getProvider()
	if (!provider) {
		error.value = "No Ethereum wallet detected. Install Rabby or MetaMask."
		return
	}
	isConnecting.value = true
	error.value = null
	try {
		const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[]
		address.value = (accounts[0] as Address | undefined) ?? null
		chainId.value = Number.parseInt((await provider.request({ method: "eth_chainId" })) as string, 16)
		if (address.value) {
			walletClient.value = createWalletClient({ account: address.value, chain: sepolia, transport: custom(provider) })
		}
		provider.on("accountsChanged", onAccountsChanged)
		provider.on("chainChanged", onChainChanged)
	} catch (e) {
		error.value = e instanceof Error ? e.message : "Failed to connect"
	} finally {
		isConnecting.value = false
	}
}

function disconnect() {
	const provider = getProvider()
	provider?.removeListener("accountsChanged", onAccountsChanged)
	provider?.removeListener("chainChanged", onChainChanged)
	address.value = null
	chainId.value = null
	walletClient.value = null
}

async function switchToSepolia() {
	const provider = getProvider()
	if (!provider) return
	try {
		await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${sepolia.id.toString(16)}` }] })
	} catch (e) {
		error.value = e instanceof Error ? e.message : "Failed to switch network"
	}
}

/** Return the L1 wallet client, rebuilding it from the live provider if a transient `accountsChanged`
 *  nulled it while the account stayed connected (multi-wallet provider shuffling). The consume path needs
 *  a live client, so it calls this rather than reading the (possibly transiently-null) ref directly. */
function ensureWalletClient(): WalletClient | null {
	if (walletClient.value) return walletClient.value
	const provider = getProvider()
	if (address.value && provider) {
		walletClient.value = createWalletClient({ account: address.value, chain: sepolia, transport: custom(provider) })
	}
	return walletClient.value
}

export function useL1Wallet() {
	return {
		address,
		chainId,
		isConnected,
		wrongChain,
		isConnecting,
		error,
		walletClient,
		ensureWalletClient,
		publicClient,
		connect,
		disconnect,
		switchToSepolia,
	}
}
