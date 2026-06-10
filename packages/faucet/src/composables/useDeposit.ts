import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { InboxAbi, TokenPortalAbi } from "@aztec/l1-artifacts"
import {
	type DepositJournalRecord,
	type EncryptionKey,
	isSealTrusted,
	markSealTrusted,
	sealDepositEnvelope,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { parseEventLogs } from "viem"
import { sepolia } from "viem/chains"
import { computed, ref, watch } from "vue"
import { BRIDGE, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import {
	addRecord,
	addRecordVerified,
	cacheSecret,
	connectJournalDeps,
	discard,
	markSessionLive,
	resumeSessionWork,
	runDepositClaim,
	runOnLane,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"
import { useBridgeWallet } from "./useBridgeWallet"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"

// Verbose tracing while the bridge flows are being hardened — ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

const NODE_URL = import.meta.env.VITE_AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com"

/** Best-effort signer fingerprint for the seal-trust cache (EIP-6963 rdns isn't plumbed for
 *  window.ethereum; injected flags are the practical discriminator). */
export function providerFingerprint(): string {
	if (typeof window === "undefined") return "unknown"
	const eth = (window as Window & { ethereum?: Record<string, unknown> }).ethereum
	if (!eth) return "unknown"
	if (eth.isRabby) return "rabby"
	if (eth.isMetaMask) return "metamask"
	return "injected"
}

// The finalized-envelope re-seal key, held in memory only for records this session sealed.
const sealKeys = new Map<string, EncryptionKey>()

let depsWired = false

/** Wire the journal engine's deposit-side chain deps (idempotent; real clients only). */
function wireDepositDeps(): void {
	if (depsWired) return
	depsWired = true
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	connectJournalDeps({
		kv: localStorage,
		connectedL1: () => l1.address.value,
		connectedAztec: () => bridgeWallet.selectedAccount.value,
		signL1: (message) => {
			const wallet = l1.ensureWalletClient()
			const account = l1.address.value
			if (!wallet || !account) throw new Error("Connect your Ethereum wallet first.")
			return wallet.signMessage({ account, message } as never) as Promise<string>
		},
		claim: async (rec, secretHex) => {
			const aztec = bridgeWallet.wallet.value
			if (!aztec) throw new Error("Connect your Aztec wallet first.")
			const recipientAddr = AztecAddress.fromString(rec.recipient)
			const amount = BigInt(rec.amount)
			const secret = Fr.fromString(secretHex)
			const leaf = new Fr(BigInt(rec.leafIndex ?? "0"))
			const fpc = await getSponsoredFpcInstance()
			const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec as never)
			const interaction = () =>
				rec.isPrivate
					? bridge.methods.claim_private(recipientAddr, amount, secret, leaf)
					: bridge.methods.claim_public(recipientAddr, amount, secret, leaf)
			return {
				simulate: () => interaction().simulate({ from: recipientAddr, fee } as never),
				send: async () => {
					const { receipt } = (await interaction().send({
						from: recipientAddr,
						fee,
						wait: { waitForStatus: TxStatus.PROPOSED },
					} as never)) as { receipt: { txHash: unknown } }
					return { txHash: String(receipt.txHash) }
				},
			}
		},
		claimReceiptStatus: async (txHash) => {
			const node = createAztecNodeClient(NODE_URL)
			try {
				const receipt = await node.getTxReceipt(TxHash.fromString(txHash))
				const status = String(receipt?.status ?? "pending").toLowerCase()
				if (status.includes("success") || status.includes("finalized")) return "success"
				if (status.includes("dropped")) return "dropped"
				if (status.includes("reverted")) return "reverted"
				return "pending"
			} catch {
				return "pending"
			}
		},
	})
}

/**
 * The deposit flow: approve (allowance-skipped) + deposit on L1, journal-backed from the first
 * irreversible step, then the engine's claim tail. Private deposits seal the bearer secret + its
 * metadata BEFORE the first L1 tx (trust-aware: 1 signature steady-state, 2 on a wallet's first
 * private bridge), and re-seal the finalized envelope (leafIndex) with the retained in-memory
 * key — zero extra signatures.
 */
export function useDepositFlow() {
	wireDepositDeps()
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	async function deposit(amount: bigint, isPrivate = false): Promise<void> {
		error.value = null
		const wallet = l1.ensureWalletClient()
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
		busy.value = true
		try {
			const secret = Fr.random()
			const secretHash = await computeSecretHash(secret)
			const id = secretHash.toString()
			const now = Date.now()
			log("start", { id, amount: amount.toString(), isPrivate })

			const base: DepositJournalRecord = {
				schema: 1,
				id,
				direction: "deposit",
				isPrivate,
				amount: amount.toString(),
				createdAt: now,
				updatedAt: now,
				chainId: sepolia.id,
				portal: L1_PORTAL,
				bridge: BRIDGE.toString(),
				recipient,
				secretHashHex: id,
				secret: isPrivate ? undefined : secret.toString(),
			}

			if (isPrivate) {
				const provider = providerFingerprint()
				const trusted = isSealTrusted(localStorage, sepolia.id, from, provider)
				log(trusted ? "seal: trusted wallet — one signature" : "seal: first private bridge for this wallet — two signatures")
				const sign = (m: string) =>
					runOnLane("l1", () => wallet.signMessage({ account: from, message: m } as never) as Promise<string>)
				const envelope = { secret: secret.toString(), recipient, amount: amount.toString(), sealerL1: from }
				const { blob, key } = await sealDepositRecord({
					sign,
					binding: { chainId: sepolia.id, portal: L1_PORTAL, bridge: BRIDGE.toString(), secretHashHex: id },
					envelope,
					trusted,
				})
				if (!trusted) markSealTrusted(localStorage, sepolia.id, from, provider)
				sealKeys.set(id, key)
				cacheSecret(id, secret.toString(), { v: 2, ...envelope })
				base.sealedEnvelope = blob
				base.sealerL1 = from
				// Write-and-verify BEFORE the irreversible L1 tx — a storage failure aborts here.
				addRecordVerified(base)
			} else {
				addRecord(base)
			}
			markSessionLive(id)

			// Allowance-skip: approve only when the portal's allowance is short.
			const allowance = (await l1.publicClient.readContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [from, L1_PORTAL],
			})) as bigint
			if (allowance < amount) {
				log("approving the portal (confirm in your Ethereum wallet)")
				const approveHash = await runOnLane("l1", () =>
					wallet.writeContract({
						address: L1_USDC,
						abi: ERC20_ABI,
						functionName: "approve",
						args: [L1_PORTAL, amount],
						chain: sepolia,
						account: from,
					}),
				)
				await l1.publicClient.waitForTransactionReceipt({ hash: approveHash })
			} else {
				log("allowance sufficient — skipping approve")
			}

			const depositFn = isPrivate ? "depositToAztecPrivate" : "depositToAztecPublic"
			const depositArgs = isPrivate ? [amount, id] : [recipient as `0x${string}`, amount, id as `0x${string}`]
			log(`${depositFn} (confirm in your Ethereum wallet)`)
			const depositTxHash = await runOnLane("l1", () =>
				wallet.writeContract({
					address: L1_PORTAL,
					abi: TokenPortalAbi,
					functionName: depositFn,
					args: depositArgs,
					chain: sepolia,
					account: from,
				} as never),
			)
			// Persisted the moment the hash exists — leafIndex stays chain-recoverable from here on.
			updateRecord(id, { depositTxHash: depositTxHash as string })
			const receipt = await l1.publicClient.waitForTransactionReceipt({ hash: depositTxHash as `0x${string}` })

			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: receipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) throw new Error("deposit emitted no Inbox MessageSent event")
			const leafIndex = event.args.index.toString()
			updateRecord(id, { leafIndex })
			log("L1→L2 message leaf index", leafIndex)

			// Finalized envelope: same key retained in memory ⇒ zero additional signatures.
			const key = sealKeys.get(id)
			if (isPrivate && key) {
				const finalized = await sealDepositEnvelope(key, {
					secret: secret.toString(),
					recipient,
					amount: amount.toString(),
					sealerL1: from,
					leafIndex,
				})
				updateRecord(id, { sealedEnvelope: finalized })
				sealKeys.delete(id)
			}

			await runDepositClaim(id)
			log("deposit flow finished", id)
		} catch (e) {
			log("FAILED:", e instanceof Error ? e.message : String(e))
			error.value = e instanceof Error ? e.message : "Deposit failed"
		} finally {
			busy.value = false
		}
	}

	// Receipt-waits resume prompt-free on reconnect; sessionLive records continue. Nothing else moves.
	watch(
		() => bridgeWallet.status.value === "connected",
		(connected) => {
			if (connected) resumeSessionWork()
		},
		{ immediate: true },
	)

	return { busy, error, deposit, journal }
}
