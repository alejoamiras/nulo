import { AztecAddress } from "@aztec/aztec.js/addresses"
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import { Contract, waitForProven } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenPortalAbi } from "@aztec/l1-artifacts"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { sepolia } from "viem/chains"
import { ref, watch } from "vue"
import { BRIDGE, BRIDGE_PROXY, BRIDGE_TOKEN, L1_PORTAL } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"

const NODE_URL = import.meta.env.VITE_AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com"
// The testnet's epoch-proving can lag well past waitForProven's 600s default (a script withdraw
// once timed out at 30 min). Give the proven-epoch wait a generous budget.
const PROVEN_TIMEOUT_SEC = 1800

// Verbose tracing while the bridge flows are being hardened — every step + value to the console.
const log = (...args: unknown[]) => console.log("[bridge:withdraw]", ...args)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type WithdrawStage = "idle" | "burning" | "exiting" | "proving" | "consuming" | "done" | "error"

const PENDING_KEY = "nulo-bridge-pending-withdraw"

interface PendingWithdraw {
	readonly exitTxHash: string
	readonly recipientL1: string
	readonly amount: string
	readonly exitBlock?: number
	/** The L1 consume tx, persisted once submitted — a re-run waits for it instead of re-prompting. */
	readonly consumeTxHash?: string
	/** Private withdraw — only the L2 burn+exit differs; the L1 consume tail is identical to public. */
	readonly isPrivate?: boolean
}

function persistPending(p: PendingWithdraw): void {
	try {
		localStorage.setItem(PENDING_KEY, JSON.stringify(p))
	} catch {}
}
function loadPending(): PendingWithdraw | null {
	try {
		const raw = localStorage.getItem(PENDING_KEY)
		return raw ? (JSON.parse(raw) as PendingWithdraw) : null
	} catch {
		return null
	}
}
function clearPending(): void {
	try {
		localStorage.removeItem(PENDING_KEY)
	} catch {}
}

/**
 * Drive an L2→L1 withdraw faucet-side: burn auth-wit + exit_to_l1_public on L2 (useBridgeWallet),
 * wait for the burn's epoch to prove (the block-countdown lives here), build the L2→L1 membership
 * witness, then consume on the L1 Outbox via portal.withdraw (useL1Wallet, canonical viem). Mirrors
 * the sandbox-proven bridge-core consumeWithdrawal, but faucet-side so no viem types cross the
 * canonical↔@aztec/viem line.
 *
 * Recovery (codex 019ea4fc MEDIUM): the exit tx hash is persisted once the exit lands, BEFORE the long
 * proven-epoch wait. A tab closed during proving resumes the proving→witness→consume on reopen (driven
 * by the L1 wallet — the L2 exit is already on-chain, so no secret and no Aztec wallet are needed to
 * finish). No funds are at risk if recovery never runs: the consume is always re-derivable from the
 * on-chain message given the exit tx hash.
 */
export function useWithdraw() {
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()

	const stage = ref<WithdrawStage>("idle")
	const error = ref<string | null>(null)
	const provenBlock = ref<number | null>(null)
	const targetBlock = ref<number | null>(null)
	const hasPending = ref(loadPending() !== null)
	// Serialize the consume so a re-armed auto-resume (e.g. an HMR/reload mid-wait) can't fire a second
	// consume prompt for the same exit.
	let consumeInFlight = false

	/** Guard against concurrent/duplicate runs — the resume watcher can fire more than once, and a
	 * second run prompts the L1 withdraw again (the first already consumed the message). */
	async function consumeExit(p: PendingWithdraw): Promise<void> {
		if (consumeInFlight) {
			log("a consume is already in flight — skipping duplicate")
			return
		}
		consumeInFlight = true
		try {
			await doConsumeExit(p)
		} finally {
			consumeInFlight = false
		}
	}

	/** Proven-epoch wait → witness → L1 consume, from a persisted exit. Drives stage + the countdown. */
	async function doConsumeExit(p: PendingWithdraw): Promise<void> {
		const l1wallet = l1.walletClient.value
		const l1addr = l1.address.value
		if (!l1wallet || !l1addr) {
			error.value = "Connect your Ethereum wallet to finish the withdraw."
			return
		}
		// A consume tx already submitted (prior run / reload re-trigger)? Wait for it, don't re-prompt —
		// the L2→L1 message consumes once, so a re-send just reverts (the duplicate prompt the user saw).
		if (p.consumeTxHash) {
			stage.value = "consuming"
			log("consume already submitted — waiting for it instead of re-sending", p.consumeTxHash)
			const prior = await l1.publicClient.waitForTransactionReceipt({ hash: p.consumeTxHash as `0x${string}` }).catch(() => null)
			if (prior?.status === "success") {
				log("prior consume succeeded — withdraw complete ✓")
				clearPending()
				hasPending.value = false
				stage.value = "done"
				return
			}
			log("prior consume not successful — re-deriving + retrying", prior?.status)
		}
		const node = createAztecNodeClient(NODE_URL)
		const txHash = TxHash.fromString(p.exitTxHash)

		stage.value = "proving"
		log("step 3/4 — waiting for the proven epoch (testnet proving is slow)", { exitTxHash: p.exitTxHash })
		// The exit's .send receipt has no blockNumber at PROPOSED, and waitForProven needs it — so fetch
		// the receipt from the node (authoritative) and poll until the tx is mined into an L2 block.
		let receipt = await node.getTxReceipt(txHash).catch(() => undefined)
		for (let i = 0; i < 120 && !receipt?.blockNumber; i++) {
			log(`exit not yet in an L2 block (poll ${i + 1}) — waiting 5s`)
			await sleep(5000)
			receipt = await node.getTxReceipt(txHash).catch(() => undefined)
		}
		if (!receipt?.blockNumber) throw new Error("the exit tx never landed in an L2 block — it will resume when you reopen this tab")
		targetBlock.value = Number(receipt.blockNumber)
		log("exit mined in L2 block", String(receipt.blockNumber), "— now waiting for it to be proven")
		const pollTimer = setInterval(() => {
			node.getProvenBlockNumber()
				.then((n) => {
					provenBlock.value = Number(n)
				})
				.catch(() => {})
		}, 5000)
		try {
			await waitForProven(node as never, receipt as never, { provenTimeout: PROVEN_TIMEOUT_SEC } as never)
		} finally {
			clearInterval(pollTimer)
		}

		const eff = await node.getTxEffect(txHash as never)
		if (!eff) throw new Error("no tx effect for the exit")
		const messageHash = eff.data.l2ToL1Msgs[0]
		if (!messageHash) throw new Error("no L2→L1 message in the exit tx")
		const wit = await computeL2ToL1MembershipWitness(node as never, messageHash, txHash as never, 0)
		if (!wit) throw new Error("L2→L1 witness not available")
		log("witness", { epochNumber: wit.epochNumber, leafIndex: wit.leafIndex })
		const path = wit.siblingPath.toBufferArray().map((b: Buffer) => `0x${b.toString("hex")}` as `0x${string}`)

		stage.value = "consuming"
		log("step 4/4 — consuming on L1 via portal.withdraw (confirm in your Ethereum wallet)", {
			recipientL1: p.recipientL1,
			amount: p.amount,
		})
		const sim = await l1.publicClient.simulateContract({
			address: L1_PORTAL,
			abi: TokenPortalAbi,
			functionName: "withdraw",
			args: [p.recipientL1 as `0x${string}`, BigInt(p.amount), false, BigInt(wit.epochNumber), wit.leafIndex, path] as never,
			account: l1addr,
		})
		const hash = await l1wallet.writeContract({ ...(sim.request as object), chain: sepolia, account: l1addr } as never)
		log("consume tx", hash)
		// Persist BEFORE awaiting, so a reload/HMR mid-wait resumes by waiting for this tx (the guard at
		// the top) instead of re-deriving the witness and prompting a second consume.
		persistPending({ ...p, consumeTxHash: hash as string })
		await l1.publicClient.waitForTransactionReceipt({ hash })

		clearPending()
		hasPending.value = false
		stage.value = "done"
		log("withdraw complete ✓")
	}

	async function withdraw(amount: bigint, isPrivate = false): Promise<void> {
		error.value = null
		provenBlock.value = null
		targetBlock.value = null
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		const l1wallet = l1.walletClient.value
		const l1addr = l1.address.value
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return
		}
		if (!l1wallet || !l1addr) {
			error.value = "Connect your Ethereum wallet first."
			return
		}

		try {
			log("start", { amount: amount.toString(), recipient, l1addr })
			const from = AztecAddress.fromString(recipient)
			const nonce = Fr.random()
			const fpc = await getSponsoredFpcInstance()
			const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const sendOpts = { from, fee, wait: { waitForStatus: TxStatus.PROPOSED } }

			const token = await Contract.at(BRIDGE_TOKEN, TokenContractArtifact, aztec)
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec)

			stage.value = "burning"
			let exitReceipt: { txHash: unknown; blockNumber?: number }
			if (isPrivate) {
				// Private burn auth-wit is OFF-CHAIN (no tx); exit_to_l1_private burns + messages in ONE private
				// tx with the witness attached (codex 019eac9c). No bearer secret — the L2→L1 message binds
				// recipient + amount. caller_on_l1 = ZERO matches public (permissionless consume; no theft).
				log("step 1/3 — private burn auth-wit (off-chain, no signature)")
				const burnAuthwit = await aztec.createAuthWit(from, {
					caller: BRIDGE_PROXY,
					call: await token.methods.burn_private(from, amount, nonce).getFunctionCall(),
				})
				stage.value = "exiting"
				log("step 2/3 — exit_to_l1_private (confirm in your Aztec wallet)")
				exitReceipt = (
					(await bridge.methods
						.exit_to_l1_private(EthAddress.fromString(l1addr), amount, EthAddress.ZERO, nonce)
						.send({ ...sendOpts, authWitnesses: [burnAuthwit] } as never)) as {
						receipt: { txHash: unknown; blockNumber?: number }
					}
				).receipt
			} else {
				log("step 1/4 — burn auth-wit (confirm in your Aztec wallet)")
				const authwit = await SetPublicAuthwitContractInteraction.create(
					aztec as never,
					from,
					{ caller: BRIDGE_PROXY, action: token.methods.burn_public(from, amount, nonce) } as never,
					true,
				)
				await authwit.send(sendOpts as never)
				stage.value = "exiting"
				log("step 2/4 — exit_to_l1_public (confirm in your Aztec wallet)")
				exitReceipt = (
					(await bridge.methods
						.exit_to_l1_public(EthAddress.fromString(l1addr), amount, EthAddress.ZERO, nonce)
						.send(sendOpts as never)) as { receipt: { txHash: unknown; blockNumber?: number } }
				).receipt
			}
			log("exit tx", String(exitReceipt.txHash), "block", exitReceipt.blockNumber)

			const pending: PendingWithdraw = {
				exitTxHash: String(exitReceipt.txHash),
				recipientL1: l1addr,
				amount: amount.toString(),
				exitBlock: exitReceipt.blockNumber,
				isPrivate,
			}
			persistPending(pending)
			hasPending.value = true

			await consumeExit(pending)
		} catch (e) {
			log("FAILED:", e)
			error.value = e instanceof Error ? e.message : "Withdraw failed"
			stage.value = "error"
		}
	}

	/** Resume a withdraw whose consume never completed (tab closed during the proven-epoch wait). */
	async function resumePending(): Promise<void> {
		const pending = loadPending()
		if (!pending || stage.value !== "idle" || consumeInFlight) return
		try {
			await consumeExit(pending)
		} catch (e) {
			error.value = e instanceof Error ? e.message : "Resume failed"
			stage.value = "error"
		}
	}

	// Auto-resume once the L1 wallet is connected (the L2 exit is already on-chain). Watch isConnected
	// (flips true once) rather than walletClient (rebuilt on every accountsChanged → re-fires the resume).
	watch(
		() => l1.isConnected.value,
		(c) => {
			if (c && hasPending.value) void resumePending()
		},
		{ immediate: true },
	)

	return { stage, error, provenBlock, targetBlock, hasPending, withdraw }
}
