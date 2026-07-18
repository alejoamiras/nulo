import { AztecAddress } from "@aztec/aztec.js/addresses"
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import { Contract, waitForProven } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenPortalAbi } from "@aztec/l1-artifacts"
import { type WithdrawJournalRecord, makeProvisionalWithdrawId } from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import { OutboxContract } from "@aztec/ethereum/contracts"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { decodeFunctionData } from "viem"
import { sepolia } from "viem/chains"
import { computed, ref, watch } from "vue"
import { BRIDGE, BRIDGE_PROXY, BRIDGE_TOKEN, L1_PORTAL } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import {
	addRecord,
	connectJournalDeps,
	discard,
	flagRecordError,
	markSessionLive,
	rekeyJournalRecord,
	resumeSessionWork,
	runOnLane,
	runWithdrawConsume,
	setRecordStep,
	useBridgeJournal,
} from "./useBridgeJournal"
import { humanizeWalletError, isUserRejection } from "@/lib/wallet-errors"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1Wallet } from "./useL1Wallet"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:withdraw]", ...args)

const NODE_URL = import.meta.env.VITE_AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PROVEN_TIMEOUT_SEC = 1800

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let depsWired = false

/** Wire the journal engine's withdraw-side chain deps (idempotent; real clients only). */
function wireWithdrawDeps(): void {
	if (depsWired) return
	depsWired = true
	const l1 = useL1Wallet()

	/** Recompute THIS exit's witness - the identity anchor a consume tx must match. */
	async function expectedWitness(rec: WithdrawJournalRecord) {
		const node = createAztecNodeClient(NODE_URL)
		const txHash = TxHash.fromString(rec.exitTxHash as string)
		const eff = await node.getTxEffect(txHash as never)
		if (!eff) throw new Error("no tx effect for the exit")
		const messageHash = eff.data.l2ToL1Msgs[0]
		if (!messageHash) throw new Error("no L2→L1 message in the exit tx")
		// 5.0: pass the L1 Outbox roots reader (OutboxContract) as the new 2nd arg.
		const { l1ContractAddresses } = await node.getNodeInfo()
		const outbox = new OutboxContract(l1.publicClient as never, l1ContractAddresses.outboxAddress)
		const wit = await computeL2ToL1MembershipWitness(node as never, outbox, messageHash, txHash as never, 0)
		if (!wit) throw new Error("L2→L1 witness not available")
		return wit
	}

	connectJournalDeps({
		consume: async (rec, onProgress) => {
			const l1wallet = l1.ensureWalletClient()
			const l1addr = l1.address.value
			if (!l1wallet || !l1addr) throw new Error("Connect your Ethereum wallet to finish the withdraw.")
			const node = createAztecNodeClient(NODE_URL)
			const txHash = TxHash.fromString(rec.exitTxHash as string)

			// The exit's PROPOSED receipt has no blockNumber; poll the node until it is mined.
			let receipt = await node.getTxReceipt(txHash).catch(() => undefined)
			for (let i = 0; i < 120 && !receipt?.blockNumber; i++) {
				log(`exit not yet in an L2 block (poll ${i + 1}) - waiting 5s`, rec.id)
				await sleep(5000)
				receipt = await node.getTxReceipt(txHash).catch(() => undefined)
			}
			if (!receipt?.blockNumber) throw new Error("the exit tx never landed in an L2 block - finish it from the journal later")
			onProgress({ targetBlock: Number(receipt.blockNumber) })

			const pollTimer = setInterval(() => {
				node.getBlockNumber("proven")
					.then((n) => onProgress({ provenBlock: Number(n) }))
					.catch(() => {})
			}, 5000)
			try {
				await waitForProven(node as never, receipt as never, { provenTimeout: PROVEN_TIMEOUT_SEC } as never)
			} finally {
				clearInterval(pollTimer)
			}

			const wit = await expectedWitness(rec)
			const path = wit.siblingPath.toBufferArray().map((b: Buffer) => `0x${b.toString("hex")}` as `0x${string}`)
			log("witness", { id: rec.id, epochNumber: wit.epochNumber, leafIndex: wit.leafIndex })

			const sim = await l1.publicClient.simulateContract({
				address: L1_PORTAL,
				abi: TokenPortalAbi,
				functionName: "withdraw",
				// 5.0 portal `withdraw` is 7-arg: (recipient, amount, withCaller, epoch,
				// numCheckpointsInEpoch, leafIndex, path). The decode path at L131 was updated but this
				// encode was missed — omitting numCheckpointsInEpoch mis-encodes + reverts on finalize.
				args: [
					rec.recipientL1 as `0x${string}`,
					BigInt(rec.amount),
					false,
					BigInt(wit.epochNumber),
					BigInt(wit.numCheckpointsInEpoch),
					wit.leafIndex,
					path,
				] as never,
				account: l1addr,
			})
			const hash = await runOnLane("l1", () =>
				l1wallet.writeContract({ ...(sim.request as object), chain: sepolia, account: l1addr } as never),
			)
			log("consume tx", { id: rec.id, hash })
			return { consumeTxHash: hash as string }
		},
		waitConsumeReceipt: async (txHash) => {
			try {
				const receipt = await l1.publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
				return receipt.status === "success"
			} catch {
				return false
			}
		},
		verifyConsumeIdentity: async (rec, txHash) => {
			try {
				const tx = await l1.publicClient.getTransaction({ hash: txHash as `0x${string}` })
				if (!tx || tx.to?.toLowerCase() !== L1_PORTAL.toLowerCase()) return false
				const decoded = decodeFunctionData({ abi: TokenPortalAbi, data: tx.input })
				if (decoded.functionName !== "withdraw") return false
				// 5.0 withdraw args: (recipient, amount, withCaller, epoch, numCheckpointsInEpoch, leafIndex, path).
				// leafIndex moved to position 5 (numCheckpointsInEpoch was inserted at 4).
				const [recipient, amount, , epoch, , leafIndex] = decoded.args as readonly [
					string,
					bigint,
					boolean,
					bigint,
					bigint,
					bigint,
					unknown,
				]
				if (recipient.toLowerCase() !== rec.recipientL1.toLowerCase() || amount !== BigInt(rec.amount)) return false
				// Bind to THIS exit, not just same-recipient-same-amount: the witness recomputed from the
				// record's exitTxHash must match the tx's epoch + leafIndex.
				const wit = await expectedWitness(rec)
				return BigInt(wit.epochNumber) === epoch && BigInt(wit.leafIndex) === leafIndex
			} catch {
				// Conservative: an unverifiable consume never marks the record done.
				return false
			}
		},
	})
}

/**
 * The withdraw flow: provisional journal record → burn authwit + exit on L2 (one Aztec prompt for
 * private, two for public) → record rekeyed to the exit tx → the engine's consume tail (proven
 * wait → witness → ONE L1 prompt).
 */
export function useWithdrawFlow() {
	wireWithdrawDeps()
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	async function withdraw(amount: bigint, isPrivate = false, opts: { onRecord?: (id: string) => void } = {}): Promise<string | null> {
		error.value = null
		const aztec = bridgeWallet.wallet.value
		const from = bridgeWallet.selectedAccount.value
		const l1addr = l1.address.value
		if (!aztec || !from) {
			error.value = "Connect your Aztec wallet first."
			return null
		}
		if (!l1addr) {
			error.value = "Connect your Ethereum wallet first."
			return null
		}
		busy.value = true
		const provisionalId = makeProvisionalWithdrawId()
		const now = Date.now()
		const base: WithdrawJournalRecord = {
			schema: 1,
			id: provisionalId,
			direction: "withdraw",
			isPrivate,
			amount: amount.toString(),
			createdAt: now,
			updatedAt: now,
			chainId: sepolia.id,
			portal: L1_PORTAL,
			bridge: BRIDGE.toString(),
			recipientL1: l1addr,
		}
		let finalId: string = provisionalId
		try {
			log("start", { provisionalId, amount: amount.toString(), isPrivate })
			addRecord(base)
			markSessionLive(provisionalId)
			opts.onRecord?.(provisionalId)
			setRecordStep(
				provisionalId,
				"exiting",
				isPrivate ? "confirm the exit in your Aztec wallet" : "two Aztec signatures: the authorization, then the exit",
			)

			const fromAddr = AztecAddress.fromStringUnsafe(from)
			const nonce = Fr.random()
			const fpc = await getSponsoredFpcInstance()
			const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const sendOpts = { from: fromAddr, fee, wait: { waitForStatus: TxStatus.PROPOSED } }
			const token = await Contract.at(BRIDGE_TOKEN, TokenContractArtifact, aztec)
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec)

			let exitReceipt: { txHash: unknown; blockNumber?: number }
			if (isPrivate) {
				log("private burn authwit (off-chain, no prompt) + exit_to_l1_private (one Aztec prompt)")
				const burnAuthwit = await aztec.createAuthWit(fromAddr, {
					caller: BRIDGE_PROXY,
					call: await token.methods.burn_private(fromAddr, amount, nonce).getFunctionCall(),
				})
				exitReceipt = (
					(await runOnLane("aztec", () =>
						bridge.methods
							.exit_to_l1_private(EthAddress.fromString(l1addr), amount, EthAddress.ZERO, nonce)
							.send({ ...sendOpts, authWitnesses: [burnAuthwit] } as never),
					)) as { receipt: { txHash: unknown; blockNumber?: number } }
				).receipt
			} else {
				log("public burn authwit (one Aztec prompt) + exit_to_l1_public (second Aztec prompt)")
				const authwit = await SetPublicAuthwitContractInteraction.create(
					aztec as never,
					fromAddr,
					{ caller: BRIDGE_PROXY, action: token.methods.burn_public(fromAddr, amount, nonce) } as never,
					true,
				)
				await runOnLane("aztec", () => authwit.send(sendOpts as never))
				exitReceipt = (
					(await runOnLane("aztec", () =>
						bridge.methods
							.exit_to_l1_public(EthAddress.fromString(l1addr), amount, EthAddress.ZERO, nonce)
							.send(sendOpts as never),
					)) as { receipt: { txHash: unknown; blockNumber?: number } }
				).receipt
			}

			const exitTxHash = String(exitReceipt.txHash)
			log("exit tx", { exitTxHash, block: exitReceipt.blockNumber })
			rekeyJournalRecord(provisionalId, {
				...base,
				id: exitTxHash,
				exitTxHash,
				exitBlock: exitReceipt.blockNumber,
				updatedAt: Date.now(),
			})
			finalId = exitTxHash
			setRecordStep(exitTxHash, undefined, undefined) // the engine narrates from here
			await runWithdrawConsume(exitTxHash)
			log("withdraw flow finished", exitTxHash)
		} catch (e) {
			const msg = humanizeWalletError(e instanceof Error ? e.message : "Withdraw failed")
			log("FAILED:", msg)
			error.value = msg
			// The cleanup matrix (plan S8/S14): only an EXPLICIT user rejection before the exit tx
			// discards the provisional record; ambiguous failures keep it with an error surface.
			const rec = journal.records.value.find((r) => r.id === finalId) as WithdrawJournalRecord | undefined
			if (rec && !rec.exitTxHash && isUserRejection(e)) {
				discard(provisionalId)
				error.value = "Rejected in your wallet - nothing was sent."
			} else if (rec) {
				flagRecordError(finalId, `${msg}. If the exit never reached Aztec, nothing left your balance.`)
			}
		} finally {
			busy.value = false
		}
		return finalId
	}

	watch(
		() => l1.isConnected.value,
		(connected) => {
			if (connected) resumeSessionWork()
		},
		{ immediate: true },
	)

	return { busy, error, withdraw, journal }
}
