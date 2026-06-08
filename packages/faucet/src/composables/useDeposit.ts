import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { InboxAbi, TokenPortalAbi } from "@aztec/l1-artifacts"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { parseEventLogs } from "viem"
import { sepolia } from "viem/chains"
import { ref } from "vue"
import { BRIDGE, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"

/** Minimal MintableERC20 surface (standard signatures) — mint test USDC + approve the portal. */
const ERC20_ABI = [
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
] as const

export type DepositStage = "idle" | "minting" | "approving" | "depositing" | "claiming" | "done" | "error"

const PENDING_KEY = "nulo-bridge-pending-deposit"

interface PendingDeposit {
	readonly secret: string
	readonly recipient: string
	readonly amount: string
	readonly leafIndex?: string
}

function persistPending(p: PendingDeposit): void {
	try {
		localStorage.setItem(PENDING_KEY, JSON.stringify(p))
	} catch {}
}
function clearPending(): void {
	try {
		localStorage.removeItem(PENDING_KEY)
	} catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Drive an L1→L2 deposit through the app, faucet-side: mint test USDC + approve + depositToAztecPublic
 * on L1 (useL1Wallet, canonical viem), then poll claim_public on L2 (useBridgeWallet, the Aztec wallet).
 * The two wallets meet only at primitives (addresses / amounts / the secret + leaf index) — never by
 * sharing viem types across the canonical↔@aztec/viem line (codex). The secret is persisted BEFORE the
 * irreversible L1 deposit so a closed tab can resume the claim.
 */
export function useDeposit() {
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()

	const stage = ref<DepositStage>("idle")
	const error = ref<string | null>(null)
	const l1TxHash = ref<string | null>(null)

	async function deposit(amount: bigint): Promise<void> {
		error.value = null
		const wallet = l1.walletClient.value
		const from = l1.address.value
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		if (!wallet || !from) {
			error.value = "Connect your Ethereum wallet first."
			return
		}
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return
		}

		try {
			const secret = Fr.random()
			const secretHash = await computeSecretHash(secret)
			// Recovery: persist the claim secret BEFORE the irreversible L1 deposit.
			persistPending({ secret: secret.toString(), recipient, amount: amount.toString() })

			stage.value = "minting"
			l1TxHash.value = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "mint",
				args: [from, amount],
				chain: sepolia,
				account: from,
			})
			await l1.publicClient.waitForTransactionReceipt({ hash: l1TxHash.value as `0x${string}` })

			stage.value = "approving"
			const approveHash = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "approve",
				args: [L1_PORTAL, amount],
				chain: sepolia,
				account: from,
			})
			await l1.publicClient.waitForTransactionReceipt({ hash: approveHash })

			stage.value = "depositing"
			const depositArgs = [recipient as `0x${string}`, amount, secretHash.toString() as `0x${string}`] as const
			const depositReceipt = await l1.publicClient.waitForTransactionReceipt({
				hash: await wallet.writeContract({
					address: L1_PORTAL,
					abi: TokenPortalAbi,
					functionName: "depositToAztecPublic",
					args: depositArgs,
					chain: sepolia,
					account: from,
				}),
			})
			// The real leaf index comes from the mined Inbox MessageSent event — a preflight simulate
			// races with any concurrent deposit and yields an index the L2 message won't match (the
			// claim then retries forever against the wrong leaf). Mirrors bridge-core/flows.ts.
			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) throw new Error("deposit emitted no Inbox MessageSent event")
			const leafIndex = event.args.index
			persistPending({ secret: secret.toString(), recipient, amount: amount.toString(), leafIndex: leafIndex.toString() })

			stage.value = "claiming"
			const fpc = await getSponsoredFpcInstance()
			const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const recipientAddr = AztecAddress.fromString(recipient)
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec)
			const sendOpts = { from: recipientAddr, fee, wait: { waitForStatus: TxStatus.PROPOSED } }

			let claimed = false
			for (let i = 0; i < 300 && !claimed; i++) {
				try {
					await bridge.methods.claim_public(recipientAddr, amount, secret, new Fr(leafIndex)).send(sendOpts as never)
					claimed = true
				} catch {
					await sleep(6000)
				}
			}
			if (!claimed) throw new Error("claim never synced — the L1→L2 message has not arrived yet")

			clearPending()
			stage.value = "done"
		} catch (e) {
			error.value = e instanceof Error ? e.message : "Deposit failed"
			stage.value = "error"
		}
	}

	return { stage, error, l1TxHash, deposit }
}
