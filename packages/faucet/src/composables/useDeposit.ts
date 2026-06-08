import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
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

const NODE_URL = import.meta.env.VITE_AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com"

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

export type DepositStage = "idle" | "minting" | "approving" | "depositing" | "syncing" | "claiming" | "done" | "error"

const PENDING_KEY = "nulo-bridge-pending-deposit"

interface PendingDeposit {
	readonly secret: string
	readonly recipient: string
	readonly amount: string
	/** Recipient's public balance before the deposit — claim is confirmed by the balance crossing this + amount. */
	readonly preBalance: string
	readonly leafIndex?: string
	/** The L1→L2 message hash (Inbox MessageSent) — polled for readiness before the claim is even attempted. */
	readonly messageHash?: string
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
 * on L1 (useL1Wallet, canonical viem), then — once the L1→L2 message is consumable — claim_public on L2
 * (useBridgeWallet, the Aztec wallet). The two wallets meet only at primitives (addresses / amounts /
 * the secret + leaf index) — never by sharing viem types across the canonical↔@aztec/viem line (codex).
 *
 * Message-sync gate: depositToAztecPublic only QUEUES the L1→L2 message; it isn't consumable until the
 * sequencer folds it into a checkpointed L2 block. We poll `getL1ToL2MessageCheckpoint(messageHash)` —
 * which returns a checkpoint ONLY when the message is ready (the older `isL1ToL2MessageSynced` is
 * deprecated: it can read true before the message is usable) — and only THEN prompt the claim. Without
 * this gate the claim fires immediately, the wallet prompts, and the tx reverts because the message
 * isn't there yet.
 *
 * Recovery (codex 019ea4fc HIGH): the secret + leaf index + message hash persist BEFORE the irreversible
 * L1 deposit and only clear once the L2 balance crosses preBalance + amount (PROPOSED can reorg, so it's
 * not a safe clear signal). A pending claim auto-resumes when the Aztec wallet reconnects. The secret is
 * plaintext — acceptable for PUBLIC claims (claim_public binds the recipient); sealing via bridge-core
 * recovery-crypto is the follow-up for private claims (their secret is a bearer credential).
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

	/** Wait for the L1→L2 message to sync, claim once, then confirm the credit (the reorg-safe clear). */
	async function claimAndConfirm(wallet: unknown, pending: PendingDeposit & { leafIndex: string; messageHash: string }): Promise<void> {
		const recipientAddr = AztecAddress.fromString(pending.recipient)
		const amount = BigInt(pending.amount)
		const secret = Fr.fromString(pending.secret)
		const target = BigInt(pending.preBalance) + amount

		// Resume short-circuit: a prior attempt's claim may already have credited.
		if ((await readPublicBalance(wallet, recipientAddr)) >= target) {
			log("already credited — nothing to claim")
			clearPending()
			hasPending.value = false
			stage.value = "done"
			return
		}

		// 1. Wait until the L1→L2 message is consumable — NO wallet prompt during this poll.
		stage.value = "syncing"
		const node = createAztecNodeClient(NODE_URL)
		const msgHash = Fr.fromString(pending.messageHash)
		let ready = false
		for (let i = 0; i < 300; i++) {
			const checkpoint = await node.getL1ToL2MessageCheckpoint(msgHash)
			if (checkpoint !== undefined) {
				log("L1→L2 message ready at checkpoint", String(checkpoint))
				ready = true
				break
			}
			log(`L1→L2 message not synced yet (poll ${i + 1}) — waiting 6s`)
			await sleep(6000)
		}
		if (!ready) throw new Error("the L1→L2 message never synced — it will resume when you reopen this tab")

		// 2. Claim ONCE — the message is ready, so a single wallet prompt should land.
		stage.value = "claiming"
		const fpc = await getSponsoredFpcInstance()
		const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
		const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, wallet as never)
		const sendOpts = { from: recipientAddr, fee, wait: { waitForStatus: TxStatus.PROPOSED } }
		log("claiming (confirm in your Aztec wallet)", { leafIndex: pending.leafIndex })
		await bridge.methods.claim_public(recipientAddr, amount, secret, new Fr(BigInt(pending.leafIndex))).send(sendOpts as never)
		log("claim sent — confirming the L2 credit")

		// 3. Confirm the credit (NO prompt) — the reorg-safe clear signal.
		for (let i = 0; i < 30; i++) {
			if ((await readPublicBalance(wallet, recipientAddr)) >= target) {
				log("credited — deposit complete ✓")
				clearPending()
				hasPending.value = false
				stage.value = "done"
				return
			}
			await sleep(4000)
		}
		// Claim landed but the public credit hasn't reflected yet — keep the pending so a reload reconciles.
		log("claim sent; L2 credit not yet observed — will reconcile on reload")
		stage.value = "done"
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
			// The real leaf index + message hash come from the mined Inbox MessageSent event — a preflight
			// simulate races with any concurrent deposit and yields an index the L2 message won't match.
			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })
			const event = sent[0] as { args?: { index?: bigint; hash?: string } } | undefined
			if (event?.args?.index === undefined || event.args.hash === undefined) {
				throw new Error("deposit emitted no Inbox MessageSent event")
			}
			const leafIndex = event.args.index.toString()
			const messageHash = event.args.hash
			log("L1→L2 message", { leafIndex, messageHash })
			persistPending({
				secret: secret.toString(),
				recipient,
				amount: amount.toString(),
				preBalance: preBalance.toString(),
				leafIndex,
				messageHash,
			})

			log("waiting for the L1→L2 message to sync, then claiming")
			await claimAndConfirm(aztec, {
				secret: secret.toString(),
				recipient,
				amount: amount.toString(),
				preBalance: preBalance.toString(),
				leafIndex,
				messageHash,
			})
			log("deposit complete ✓")
		} catch (e) {
			log("FAILED:", e)
			error.value = e instanceof Error ? e.message : "Deposit failed"
			stage.value = "error"
		}
	}

	/** Resume a deposit whose claim never confirmed (tab closed mid-flow). Safe to call repeatedly. */
	async function resumePending(): Promise<void> {
		const pending = loadPending()
		const aztec = bridgeWallet.wallet.value
		if (!pending?.leafIndex || !pending?.messageHash || !aztec || stage.value !== "idle") return
		log("resuming pending claim", pending)
		try {
			await claimAndConfirm(aztec, pending as PendingDeposit & { leafIndex: string; messageHash: string })
		} catch (e) {
			log("resume FAILED:", e)
			error.value = e instanceof Error ? e.message : "Resume failed"
			stage.value = "error"
		}
	}

	// Auto-resume a pending claim once the Aztec wallet is connected (handles a mid-flow tab close).
	watch(
		() => bridgeWallet.wallet.value,
		(w) => w && hasPending.value && void resumePending(),
		{ immediate: true },
	)

	return { stage, error, l1TxHash, hasPending, deposit, resumePending }
}
