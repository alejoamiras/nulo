import { FeeAssetHandlerAbi } from "@aztec/l1-artifacts"
import { awaitL1Receipt, FeeJuicePortalAbi } from "@nulo/bridge-core"
import { NETWORK } from "@/lib/network"
import { ref, watch } from "vue"
import { FUEL_ASSET, FUEL_ASSET_HANDLER, FUEL_PORTAL } from "@/contracts/bridge-deployments"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** The L1 fee asset (Fee Juice token / $AZTEC) is an 18-decimal ERC20 — the protocol standard. */
export const FUEL_ASSET_DECIMALS = 18

const POLL_INTERVAL_MS = 15_000

const balance = ref<bigint | null>(null)
const approving = ref(false)
const error = ref<string | null>(null)
// Mint state is DEDICATED, not the shared `error`/busy: the deposit flow + balance poll also write
// `error`, so a failed approve/poll must never surface on the mint card as a mint failure (codex).
const minting = ref(false)
const mintError = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
// Session cache: only the VERIFIED-good verdicts are memoised (a mismatch throws every call). The bundled
// portal/asset (and handler/asset) pairs can't change mid-session, so one on-chain read each suffices.
let portalAssetVerified = false
let handlerAssetVerified = false

/**
 * Module-singleton L1 fee-asset state for the Fuel flow (the useL1Usdc pattern): one Sepolia balance
 * poll, the approve the canonical FeeJuicePortal deposit needs, and a `mint()` (the testnet
 * FeeAssetHandler) so a zero-balance user can get $AZTEC to fuel. The fee asset + portal + handler come
 * from the `l1.feeJuice` config; when it is absent every method is inert (the Fuel tab never renders).
 * Canonical viem only.
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
			error.value = errorMessage(err, "Failed to read the L1 fee-asset balance")
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
				"Fuel portal/asset mismatch. Refusing to deposit: the FeeJuicePortal's UNDERLYING() doesn't match the configured fee asset.",
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
				chain: NETWORK.viemChain,
				account: owner,
			})
			// viem RESOLVES the receipt even on an on-chain revert — check status so a mined revert surfaces as
			// an error, never a false "approved" the deposit's transferFrom then fails behind (mirrors mint()).
			const receipt = await awaitL1Receipt(l1.publicClient, hash)
			if (receipt.status !== "success") throw new Error("Approve transaction reverted on-chain.")
		} catch (err) {
			error.value = errorMessage(err, "Approve failed")
		} finally {
			approving.value = false
		}
	}

	/** Fail-closed cross-check before minting: the pinned FeeAssetHandler must hand out the configured fee
	 *  asset (read its `FEE_ASSET()`, compare to `FUEL_ASSET`). Proves config COHERENCE, not handler
	 *  authenticity — the pinned address is the trust boundary (reviewed against the node) — but it stops a
	 *  stale/typo'd handler from minting the wrong token. */
	async function verifyHandlerAsset(): Promise<void> {
		if (handlerAssetVerified) return
		if (!FUEL_ASSET || !FUEL_ASSET_HANDLER) throw new Error("Fuel mint is not configured for this deployment.")
		const feeAsset = (await l1.publicClient.readContract({
			address: FUEL_ASSET_HANDLER,
			abi: FeeAssetHandlerAbi,
			functionName: "FEE_ASSET",
		})) as string
		if (feeAsset.toLowerCase() !== FUEL_ASSET.toLowerCase()) {
			throw new Error(
				"Fuel mint handler mismatch. Refusing to mint: the FeeAssetHandler's FEE_ASSET() doesn't match the configured fee asset.",
			)
		}
		handlerAssetVerified = true
	}

	/** Mint test $AZTEC to the connected account via the permissionless testnet FeeAssetHandler (fixed
	 *  amount, set by the contract), then refresh the balance. Errors set the DEDICATED `mintError`; a
	 *  handler revert (e.g. rate-limit) surfaces its message, never throws uncaught. */
	async function mint(): Promise<void> {
		const wallet = l1.ensureWalletClient()
		const owner = l1.address.value
		if (!wallet || !owner) {
			mintError.value = "Connect your Ethereum wallet first."
			return
		}
		if (!FUEL_ASSET_HANDLER) {
			mintError.value = "Fuel mint is not configured for this deployment."
			return
		}
		minting.value = true
		mintError.value = null
		try {
			await verifyHandlerAsset()
			const hash = await wallet.writeContract({
				address: FUEL_ASSET_HANDLER,
				abi: FeeAssetHandlerAbi,
				functionName: "mint",
				args: [owner],
				chain: NETWORK.viemChain,
				account: owner,
			})
			// viem RESOLVES the receipt even on an on-chain revert — check status so a mined revert surfaces
			// as mintError, never a false "minted" + refresh (codex post-impl MED).
			const receipt = await awaitL1Receipt(l1.publicClient, hash)
			if (receipt.status !== "success") throw new Error("Mint transaction reverted on-chain.")
			await refresh()
		} catch (err) {
			mintError.value = errorMessage(err, "Mint failed")
		} finally {
			minting.value = false
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

	return { balance, approving, error, minting, mintError, refresh, allowance, approve, mint, verifyPortalAsset }
}
