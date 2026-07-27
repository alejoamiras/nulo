import { NETWORK } from "@/lib/network"
import { awaitL1Receipt } from "@nulo/bridge-core"
import { ref, watch } from "vue"
import { BRIDGE_TOKEN_DECIMALS, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { useL1Wallet } from "./useL1Wallet"

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** Minimal test-USDC surface: faucet mint + portal approve + the reads the bridge form needs. */
export const ERC20_ABI = [
	{
		type: "function",
		name: "mint",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [],
	},
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ type: "bool" }],
	},
	{
		type: "function",
		name: "balanceOf",
		stateMutability: "view",
		inputs: [{ name: "owner", type: "address" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "allowance",
		stateMutability: "view",
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
		],
		outputs: [{ type: "uint256" }],
	},
] as const

const POLL_INTERVAL_MS = 15_000

/** Fixed faucet-style mint - the bridge moves what you mint here; amount entry adds nothing on testnet. */
// 100 whole tokens in base units - derived from the bridged pair's decimals so a redeploy at a
// different precision can never mint dust (the 6-dec literal would be 1e-10 of an 18-dec token).
export const MINT_AMOUNT = 100n * 10n ** BigInt(BRIDGE_TOKEN_DECIMALS)

const balance = ref<bigint | null>(null)
const minting = ref(false)
const error = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Module-singleton L1 test-USDC state (the useL1Wallet pattern): one Sepolia balance poll shared
 * by the form, plus the explicit mint that replaced the deposit-embedded one. Canonical viem only.
 */
export function useL1Usdc() {
	const l1 = useL1Wallet()

	async function refresh(): Promise<void> {
		const owner = l1.address.value
		if (!owner) {
			balance.value = null
			return
		}
		// The read client delegates to the wallet's provider, which executes eth_call on whatever
		// chain the wallet is CURRENTLY on. Connect does not auto-switch (L1WalletPanel offers it),
		// so a first-open read on the wrong chain hits an address with no code there and viem
		// throws its raw `returned no data ("0x")` dump. Hold the read until the switch lands —
		// the chainId watch below re-runs it immediately when it does.
		if (l1.wrongChain.value) {
			balance.value = null
			return
		}
		try {
			balance.value = (await l1.publicClient.readContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "balanceOf",
				args: [owner],
			})) as bigint
		} catch {
			// Set-only: a background poll succeeding must not clear an error a user ACTION just
			// surfaced. Fixed copy — the raw viem message is a wall of text in the mint card.
			error.value = "Failed to read the L1 token balance - retrying in the background."
		}
	}

	async function allowance(): Promise<bigint> {
		const owner = l1.address.value
		if (!owner) return 0n
		return (await l1.publicClient.readContract({
			address: L1_USDC,
			abi: ERC20_ABI,
			functionName: "allowance",
			args: [owner, L1_PORTAL],
		})) as bigint
	}

	/** Mint MINT_AMOUNT test USDC to the connected L1 account (one wallet prompt). */
	async function mint(): Promise<void> {
		const wallet = l1.ensureWalletClient()
		const owner = l1.address.value
		if (!wallet || !owner) {
			error.value = "Connect your Ethereum wallet first."
			return
		}
		minting.value = true
		error.value = null
		try {
			const hash = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "mint",
				args: [owner, MINT_AMOUNT],
				chain: NETWORK.viemChain,
				account: owner,
			})
			await awaitL1Receipt(l1.publicClient, hash)
			await refresh()
		} catch (err) {
			error.value = errorMessage(err, "Mint failed")
		} finally {
			minting.value = false
		}
	}

	function ensurePolling(): void {
		if (timer !== null) return
		timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
	}

	// chainId is a dependency so the balance appears the moment a wrong-chain wallet switches to
	// the target network, rather than waiting out the poll interval.
	watch(
		() => [l1.address.value, l1.chainId.value] as const,
		([addr]) => {
			void refresh()
			if (addr) ensurePolling()
		},
		{ immediate: true },
	)

	return { balance, minting, error, refresh, allowance, mint }
}
