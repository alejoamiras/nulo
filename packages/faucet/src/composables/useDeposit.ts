import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { InboxAbi, TokenPortalAbi } from "@aztec/l1-artifacts"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { parseEventLogs } from "viem"
import { sepolia } from "viem/chains"
import { ref, watch } from "vue"
import { BRIDGE, BRIDGE_TOKEN, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"
import { readBalance } from "./useTokenBalance"

// Verbose tracing while the bridge flows are being hardened — every step + value to the console.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

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
	/** Recipient's public balance before the deposit — claim is confirmed by the balance crossing this + amount. */
	readonly preBalance: string
	readonly leafIndex?: string
}

function persistPending(p: PendingDeposit): void {
	try {
		localStorage.setItem(PENDING_KEY, JSON.stringify(p))
	} catch {}
}
function loadPending(): PendingDeposit | null {
	try {
		const raw = localStorage.getItem(PENDING_KEY)
		return raw ? (JSON.parse(raw) as PendingDeposit) : null
	} catch {
		return null
	}
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
 * sharing viem types across the canonical↔@aztec/viem line (codex).
 *
 * Recovery (codex 019ea4fc HIGH): the claim secret + leaf index are persisted BEFORE the irreversible
 * L1 deposit and only cleared once the L2 balance crosses preBalance + amount (a PROPOSED claim can be
 * reorged out before checkpoint, so PROPOSED is NOT a safe clear signal). A pending claim auto-resumes
 * when the Aztec wallet reconnects. The secret is plaintext for now — acceptable for PUBLIC claims since
 * claim_public binds the recipient in the message content; sealing via bridge-core recovery-crypto is a
 * follow-up the moment private claims land (their secret is a bearer credential).
 */
export function useDeposit() {
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()

	const stage = ref<DepositStage>("idle")
	const error = ref<string | null>(null)
	const l1TxHash = ref<string | null>(null)
	const hasPending = ref(loadPending() !== null)

	async function readPublicBalance(wallet: unknown, recipient: AztecAddress): Promise<bigint> {
		const token = await Contract.at(BRIDGE_TOKEN, TokenContractArtifact, wallet as never)
		// readBalance unwraps the SimulationResult to a real bigint — a raw cast yields the wrapper
		// object, which then stringifies to "[object Object]" and blows up the later BigInt() coercion.
		const bal = await readBalance(wallet as never, token, "balance_of_public", recipient)
		log("balance_of_public", recipient.toString(), "=", bal.toString())
		return bal
	}

	/** Poll claim_public until it lands, then confirm the credit (the reorg-safe clear signal). */
	async function claimAndConfirm(wallet: unknown, pending: PendingDeposit & { leafIndex: string }): Promise<void> {
		const recipientAddr = AztecAddress.fromString(pending.recipient)
		const amount = BigInt(pending.amount)
		const secret = Fr.fromString(pending.secret)
		const fpc = await getSponsoredFpcInstance()
		const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
		const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, wallet as never)
		const sendOpts = { from: recipientAddr, fee, wait: { waitForStatus: TxStatus.PROPOSED } }

		stage.value = "claiming"
		const target = BigInt(pending.preBalance) + amount
		log("claiming", {
			recipient: pending.recipient,
			amount: amount.toString(),
			leafIndex: pending.leafIndex,
			preBalance: pending.preBalance,
			target: target.toString(),
		})
		for (let i = 0; i < 300; i++) {
			// Already credited (e.g. a prior attempt's claim landed) — done, regardless of this send.
			if ((await readPublicBalance(wallet, recipientAddr)) >= target) {
				log("credited — claim complete")
				clearPending()
				hasPending.value = false
				stage.value = "done"
				return
			}
			try {
				log(`claim_public attempt ${i + 1}`)
				await bridge.methods.claim_public(recipientAddr, amount, secret, new Fr(BigInt(pending.leafIndex))).send(sendOpts as never)
				log(`claim_public attempt ${i + 1} sent OK`)
			} catch (e) {
				log(`claim_public attempt ${i + 1} failed (retrying in 6s):`, e instanceof Error ? e.message : e)
				await sleep(6000)
			}
		}
		// Claim attempts exhausted without an observed credit — keep the pending so a reload retries.
		throw new Error("claim not yet credited on L2 — it will resume automatically when you reopen this tab")
	}

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
			log("start", { amount: amount.toString(), recipient, from, usdc: L1_USDC, portal: L1_PORTAL })
			const secret = Fr.random()
			const secretHash = await computeSecretHash(secret)
			const recipientAddr = AztecAddress.fromString(recipient)
			const preBalance = await readPublicBalance(aztec, recipientAddr)
			persistPending({ secret: secret.toString(), recipient, amount: amount.toString(), preBalance: preBalance.toString() })
			hasPending.value = true

			stage.value = "minting"
			log("step 1/4 — minting", amount.toString(), "USDC to", from, "(confirm in your Ethereum wallet)")
			l1TxHash.value = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "mint",
				args: [from, amount],
				chain: sepolia,
				account: from,
			})
			log("mint tx", l1TxHash.value)
			await l1.publicClient.waitForTransactionReceipt({ hash: l1TxHash.value as `0x${string}` })

			stage.value = "approving"
			log("step 2/4 — approving portal", L1_PORTAL, "for", amount.toString(), "(confirm in your Ethereum wallet)")
			const approveHash = await wallet.writeContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "approve",
				args: [L1_PORTAL, amount],
				chain: sepolia,
				account: from,
			})
			log("approve tx", approveHash)
			await l1.publicClient.waitForTransactionReceipt({ hash: approveHash })

			stage.value = "depositing"
			log("step 3/4 — depositToAztecPublic (confirm in your Ethereum wallet)")
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
			log("deposit tx", depositReceipt.transactionHash)
			// The real leaf index comes from the mined Inbox MessageSent event — a preflight simulate
			// races with any concurrent deposit and yields an index the L2 message won't match (the
			// claim then retries forever against the wrong leaf). Mirrors bridge-core/flows.ts.
			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) throw new Error("deposit emitted no Inbox MessageSent event")
			const leafIndex = event.args.index.toString()
			log("L1→L2 message leaf index", leafIndex)
			persistPending({
				secret: secret.toString(),
				recipient,
				amount: amount.toString(),
				preBalance: preBalance.toString(),
				leafIndex,
			})

			log("step 4/4 — claiming on L2 (confirm in your Aztec wallet)")
			await claimAndConfirm(aztec, {
				secret: secret.toString(),
				recipient,
				amount: amount.toString(),
				preBalance: preBalance.toString(),
				leafIndex,
			})
			log("deposit complete ✓")
		} catch (e) {
			log("FAILED:", e)
			error.value = e instanceof Error ? e.message : "Deposit failed"
			stage.value = "error"
		}
	}

	/** Resume a deposit whose claim never confirmed (tab closed mid-claim). Safe to call repeatedly. */
	async function resumePending(): Promise<void> {
		const pending = loadPending()
		const aztec = bridgeWallet.wallet.value
		if (!pending?.leafIndex || !aztec || stage.value !== "idle") return
		log("resuming pending claim", pending)
		try {
			await claimAndConfirm(aztec, pending as PendingDeposit & { leafIndex: string })
		} catch (e) {
			log("resume FAILED:", e)
			error.value = e instanceof Error ? e.message : "Resume failed"
			stage.value = "error"
		}
	}

	// Auto-resume a pending claim once the Aztec wallet is connected (handles a mid-claim tab close).
	watch(
		() => bridgeWallet.wallet.value,
		(w) => w && hasPending.value && void resumePending(),
		{ immediate: true },
	)

	return { stage, error, l1TxHash, hasPending, deposit, resumePending }
}
