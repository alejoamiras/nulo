import { FeeJuicePortalAbi } from "@nulo/bridge-core"
import { sepolia } from "viem/chains"
import { ref, watch } from "vue"
import { FUEL_ASSET, FUEL_PORTAL } from "@/contracts/bridge-deployments"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** The L1 fee asset (Fee Juice token / $AZTEC) is an 18-decimal ERC20 — the protocol standard. */
export const FUEL_ASSET_DECIMALS = 18

const POLL_INTERVAL_MS = 15_000

const balance = ref<bigint | null>(null)
const approving = ref(false)
const error = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
// Session cache: only the VERIFIED-good verdict is memoised (a mismatch throws every call). The bundled
// portal/asset pair can't change mid-session, so one on-chain read suffices.
let portalAssetVerified = false

/**
 * Module-singleton L1 fee-asset state for the Fuel flow (the useL1Usdc pattern): one Sepolia balance
 * poll + the approve the canonical FeeJuicePortal deposit needs. NO mint — Fuel assumes the asset is
 * already held (locked decision 3). The fee asset + portal come from the `l1.feeJuice` config; when it
 * is absent every method is inert (the Fuel tab never renders). Canonical viem only.
 */
export function useL1FeeAsset() {
	const l1 = useL1Wallet()

	async function refresh(): Promise<void> {
		const owner = l1.address.value
		if (!owner || !FUEL_ASSET) {
			balance.value = null
			return
		}
		try {
			balance.value = (await l1.publicClient.readContract({
				address: FUEL_ASSET,
				abi: ERC20_ABI,
				functionName: "balanceOf",
				args: [owner],
			})) as bigint
		} catch (err) {
			// Set-only: a background poll succeeding must not clear an error a user ACTION just surfaced.
			error.value = errorMessage(err, "Failed to read the Sepolia fee-asset balance")
		}
	}

	async function allowance(): Promise<bigint> {
		const owner = l1.address.value
		if (!owner || !FUEL_ASSET || !FUEL_PORTAL) return 0n
		return (await l1.publicClient.readContract({
			address: FUEL_ASSET,
			abi: ERC20_ABI,
			functionName: "allowance",
			args: [owner, FUEL_PORTAL],
		})) as bigint
	}

	/** Hard-block before approve/deposit: confirm the bundled FeeJuicePortal actually accepts the configured
	 *  fee asset by reading its on-chain `UNDERLYING()`. A tampered or stale `FUEL_ASSET`/`FUEL_PORTAL` pair
	 *  would otherwise route an approve + deposit at the wrong contract; refuse (fail-closed) on mismatch.
	 *  L1 view call only — no L2 network, so it runs under the local-gates-only constraint. */
	async function verifyPortalAsset(): Promise<void> {
		if (portalAssetVerified) return
		if (!FUEL_ASSET || !FUEL_PORTAL) throw new Error("Fuel is not configured for this deployment.")
		const underlying = (await l1.publicClient.readContract({
			address: FUEL_PORTAL,
			abi: FeeJuicePortalAbi,
			functionName: "UNDERLYING",
		})) as string
		if (underlying.toLowerCase() !== FUEL_ASSET.toLowerCase()) {
			throw new Error(
				"Fuel portal/asset mismatch — refusing to deposit. The FeeJuicePortal's UNDERLYING() doesn't match the configured fee asset.",
			)
		}
		portalAssetVerified = true
	}

	/** Approve the FeeJuicePortal to pull `amount` of the fee asset (one wallet prompt). */
	async function approve(amount: bigint): Promise<void> {
		const wallet = l1.ensureWalletClient()
		const owner = l1.address.value
		if (!wallet || !owner) {
			error.value = "Connect your Ethereum wallet first."
			return
		}
		if (!FUEL_ASSET || !FUEL_PORTAL) {
			error.value = "Fuel is not configured for this deployment."
			return
		}
		approving.value = true
		error.value = null
		try {
			const hash = await wallet.writeContract({
				address: FUEL_ASSET,
				abi: ERC20_ABI,
				functionName: "approve",
				args: [FUEL_PORTAL, amount],
				chain: sepolia,
				account: owner,
			})
			await l1.publicClient.waitForTransactionReceipt({ hash })
		} catch (err) {
			error.value = errorMessage(err, "Approve failed")
		} finally {
			approving.value = false
		}
	}

	function ensurePolling(): void {
		if (timer !== null) return
		timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
	}

	watch(
		() => l1.address.value,
		(addr) => {
			void refresh()
			if (addr) ensurePolling()
		},
		{ immediate: true },
	)

	return { balance, approving, error, refresh, allowance, approve, verifyPortalAsset }
}
