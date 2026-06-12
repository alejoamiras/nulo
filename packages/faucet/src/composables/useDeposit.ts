import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { InboxAbi, TokenPortalAbi } from "@aztec/l1-artifacts"
import {
	type BridgeWitness,
	type DepositJournalRecord,
	type EncryptionKey,
	SWAP_BRIDGE_ROUTER_ABI,
	bridgeWitnessPermitTypedData,
	buildFuelRoute,
	feeJuiceAddress,
	hashRoute,
	isSealTrusted,
	markSealTrusted,
	minOutputForSlippage,
	publicFeeJuicePayment,
	quoteFuelPath,
	sealDepositEnvelope,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { parseEventLogs } from "viem"
import { sepolia } from "viem/chains"
import { computed, ref, watch } from "vue"
import { BRIDGE, BRIDGE_FUEL, L1_PORTAL, L1_USDC } from "@/contracts/bridge-deployments"
import { FUEL_FEE_MARGIN, decideFuelClaim } from "@/lib/fuel-claim-state"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import {
	addRecordVerified,
	cacheSecret,
	connectJournalDeps,
	discard,
	flagRecordError,
	markApproveOutcome,
	markSessionLive,
	resumeSessionWork,
	runDepositClaim,
	runOnLane,
	setRecordStep,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"
import { humanizeWalletError, isUserRejection } from "@/lib/wallet-errors"
import { useBridgeWallet } from "./useBridgeWallet"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
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

/** Same-session retained seal key (pre-finalize window) - lets a backup export skip the signature. */
export function getRetainedSealKey(id: string): EncryptionKey | undefined {
	return sealKeys.get(id)
}

// The user's explicit "Claim without fuel" choices (L14 trigger 3); set by the journal UI.
const fuelOverrides = new Set<string>()
export function overrideFuelClaim(id: string): void {
	fuelOverrides.add(id)
}

/** Claim a fueled deposit's Fee Juice as a standalone, sponsored, durable tx. The FJ message is
 *  recipient-bound, so this is safe to call whenever the fuel isn't known-consumed; if it was
 *  already consumed the node reverts harmlessly. On success it latches `fuel.standaloneClaimed`,
 *  which clears the card's recovery affordance. Shared by the fee-spike path and the manual
 *  post-completion "CLAIM YOUR GAS" action (closes the two stranding paths the post-impl audit
 *  flagged: a dropped fjwc tx and a failed fire-and-forget standalone). */
async function sendStandaloneFjClaim(
	aztec: unknown,
	recipientAddr: AztecAddress,
	fuel: NonNullable<DepositJournalRecord["fuel"]>,
	id: string,
): Promise<void> {
	const fpc = await getSponsoredFpcInstance()
	const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const fj = await Contract.at(AztecAddress.fromString(feeJuiceAddress), FeeJuiceContractArtifact, aztec as never)
	await fj.methods
		.claim_and_end_setup(recipientAddr, BigInt(fuel.received ?? "0"), Fr.fromString(fuel.secret), new Fr(BigInt(fuel.leafIndex ?? "0")))
		.send({ from: recipientAddr, fee: sponsored, wait: { waitForStatus: TxStatus.PROPOSED } } as never)
	updateRecord(id, { fuel: { ...fuel, standaloneClaimed: true } })
	log("standalone FJ claim landed", id)
}

/** The card's "CLAIM YOUR GAS" recovery: claims a stranded fuel message after the token side
 *  already completed. Throws so the caller can surface the failure (never silent). */
export async function claimFuelStandalone(id: string): Promise<void> {
	const bridgeWallet = useBridgeWallet()
	const aztec = bridgeWallet.wallet.value
	if (!aztec) throw new Error("Connect your Aztec wallet first.")
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	if (!rec?.fuel?.received || !rec.fuel.leafIndex) throw new Error("This bridge has no fuel to claim.")
	await sendStandaloneFjClaim(aztec, AztecAddress.fromString(rec.recipient), rec.fuel, id)
}

/** Probe an fjwc attempt's receipt - record-specific ground truth for the recovery ladder. */
async function fuelReceiptStatus(txHash: string): Promise<"included" | "dropped" | "pending"> {
	try {
		const receipt = await createAztecNodeClient(NODE_URL).getTxReceipt(TxHash.fromString(txHash))
		const status = String(receipt?.status ?? "pending").toLowerCase()
		if (/checkpointed|proven|finalized|success|mined/.test(status)) return "included"
		if (status.includes("dropped")) return "dropped"
		return "pending"
	} catch {
		return "pending" // unreachable node reads as not-yet-evidence, never as consumed.
	}
}

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
			const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec as never)

			// Fueled records pick their payment via the L14 ladder (record-specific evidence only).
			const fuel = rec.fuel
			let fee: { paymentMethod: unknown } = sponsored
			let fjwcAttempt = false
			let standaloneFj = false
			if (fuel?.received && fuel.leafIndex) {
				const receiptStatus = fuel.claimTxHash ? await fuelReceiptStatus(fuel.claimTxHash) : undefined
				// Promote a prior attempt to INCLUSION-GRADE durable evidence: only an `included`
				// receipt sets `consumed`, so a later unreachable node can trust it - a PROPOSED-time
				// latch would wrongly survive a dropped tx (post-impl audit HIGH).
				if (receiptStatus === "included" && fuel.consumed !== true) {
					updateRecord(rec.id, { fuel: { ...fuel, consumed: true } })
				}
				const decision = decideFuelClaim({
					attempt: fuel.claimAttempt === true,
					txHashKnown: typeof fuel.claimTxHash === "string",
					receiptStatus,
					consumed: fuel.consumed === true || receiptStatus === "included",
					fuelReceived: BigInt(fuel.received),
					// v1 reads the calibrated floor (config) as the fee reference; a live min-fee query
					// is a refinement, not a correctness need - the floor is 2x a real observed fee.
					currentMinFee: BRIDGE_FUEL ? BRIDGE_FUEL.minFuelFj / FUEL_FEE_MARGIN : undefined,
					persistentFailureCount: 0,
					userOverride: fuelOverrides.has(rec.id),
				})
				log("fuel claim decision", { id: rec.id, action: decision.action })
				if (decision.action === "fjwc") {
					fee = {
						paymentMethod: publicFeeJuicePayment(recipientAddr, {
							claimAmount: BigInt(fuel.received),
							claimSecret: Fr.fromString(fuel.secret),
							messageLeafIndex: BigInt(fuel.leafIndex),
						}),
					}
					fjwcAttempt = true
				} else if (decision.action === "sponsored-plus-standalone-fj") {
					standaloneFj = true
				} else if (decision.action === "wait") {
					return {
						simulate: async () => {
							throw new Error("fuel claim attempt pending - waiting for its receipt before retrying")
						},
						send: async () => {
							throw new Error("fuel claim attempt pending")
						},
					}
				}
			}

			const interaction = () =>
				rec.isPrivate
					? bridge.methods.claim_private(recipientAddr, amount, secret, leaf)
					: bridge.methods.claim_public(recipientAddr, amount, secret, leaf)
			return {
				simulate: () => interaction().simulate({ from: recipientAddr, fee } as never),
				send: async () => {
					// L14 trigger-1 precondition: latch the attempt JOURNAL-FIRST, before the wallet call.
					if (fjwcAttempt && fuel) updateRecord(rec.id, { fuel: { ...fuel, claimAttempt: true } })
					const { receipt } = (await interaction().send({
						from: recipientAddr,
						fee,
						wait: { waitForStatus: TxStatus.PROPOSED },
					} as never)) as { receipt: { txHash: unknown } }
					const txHash = String(receipt.txHash)
					// PROPOSED is NOT inclusion: latch the attempt + hash only. `consumed` is set later,
					// inclusion-grade, from the receipt probe (post-impl audit HIGH). If this fjwc tx is
					// later dropped, the card's "CLAIM YOUR GAS" recovery still surfaces the stranded FJ.
					if (fjwcAttempt && fuel) {
						updateRecord(rec.id, { fuel: { ...fuel, claimAttempt: true, claimTxHash: txHash } })
					}
					if (standaloneFj && fuel) {
						// Best-effort inline standalone claim; a FAILURE leaves standaloneClaimed unset, so
						// the card surfaces "CLAIM YOUR GAS" once the record completes (no silent strand).
						void sendStandaloneFjClaim(aztec, recipientAddr, fuel, rec.id).catch((e) =>
							log("standalone FJ claim failed (recoverable via CLAIM YOUR GAS):", e instanceof Error ? e.message : String(e)),
						)
					}
					return { txHash }
				},
			}
		},
		l2BlockNumber: async () => Number(await createAztecNodeClient(NODE_URL).getBlockNumber()),
		claimReceiptStatus: async (txHash) => {
			const node = createAztecNodeClient(NODE_URL)
			try {
				const receipt = await node.getTxReceipt(TxHash.fromString(txHash))
				// TxStatus (4.2.0) is BLOCK-finalization state with NO "success" value: a confirmed tx
				// reads checkpointed -> proven -> finalized. Inclusion at ANY of those = landed; the
				// separate executionResult carries the revert signal. Waiting for "finalized" alone
				// stranded confirmed claims at "Confirming" for epochs.
				const status = String(receipt?.status ?? "pending").toLowerCase()
				const included = /checkpointed|proven|finalized|success|mined/.test(status)
				if (included) {
					const exec = String(receipt?.executionResult ?? "success").toLowerCase()
					return exec.includes("revert") ? "reverted" : "success"
				}
				if (status.includes("dropped")) return "dropped"
				if (status.includes("reverted")) return "reverted"
				return "pending"
			} catch (e) {
				// A dead RPC must read as connectivity, never as a slow claim (plan D2).
				log("receipt lookup failed:", e instanceof Error ? e.message : String(e))
				return "unreachable"
			}
		},
	})
}

/**
 * The deposit flow: approve (allowance-skipped) + deposit on L1, journal-backed from the first
 * irreversible step, then the engine's claim tail. Private deposits seal the bearer secret + its
 * metadata BEFORE the first L1 tx (trust-aware: 1 signature steady-state, 2 on a wallet's first
 * private bridge), and re-seal the finalized envelope (leafIndex) with the retained in-memory
 * key - zero extra signatures.
 */
export function useDepositFlow() {
	wireDepositDeps()
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	async function deposit(
		amount: bigint,
		isPrivate = false,
		opts: { onRecord?: (id: string) => void; fuelSlice?: bigint } = {},
	): Promise<string | null> {
		error.value = null
		const wallet = l1.ensureWalletClient()
		const from = l1.address.value
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		if (!wallet || !from) {
			error.value = "Connect your Ethereum wallet first."
			return null
		}
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return null
		}
		busy.value = true
		let id: string | null = null
		try {
			// Fuel pre-flight BEFORE any record exists: quote-required (a missing quote must never
			// sign away the slice with a junk floor), floor from config slippage.
			const fuelSlice = opts.fuelSlice && opts.fuelSlice > 0n ? opts.fuelSlice : undefined
			let fuelPre: { secret: Fr; secretHashHex: string; minOutput: bigint; route: ReturnType<typeof buildFuelRoute> } | undefined
			if (fuelSlice) {
				if (!BRIDGE_FUEL) throw new Error("Fuel is not configured for this deployment.")
				if (fuelSlice >= amount) throw new Error("The fuel slice must be smaller than the total amount.")
				const route = buildFuelRoute({
					token: L1_USDC,
					weth: BRIDGE_FUEL.weth,
					feeJuice: BRIDGE_FUEL.feeJuice,
					tokenWeth: BRIDGE_FUEL.pools.azloWeth,
					ethFj: BRIDGE_FUEL.pools.ethFj,
				})
				const quote = await quoteFuelPath(l1.publicClient as never, BRIDGE_FUEL.quoter, route, fuelSlice)
				if (quote < BRIDGE_FUEL.minFuelFj) {
					throw new Error("That fuel slice buys too little gas to cover its own claim - increase it or bridge without fuel.")
				}
				const fuelSecret = Fr.random()
				fuelPre = {
					secret: fuelSecret,
					secretHashHex: (await computeSecretHash(fuelSecret)).toString(),
					minOutput: minOutputForSlippage(quote, BRIDGE_FUEL.slippageBps),
					route,
				}
			}

			const secret = Fr.random()
			const secretHash = await computeSecretHash(secret)
			id = secretHash.toString()
			const now = Date.now()
			// record.amount is the TOKEN CLAIM amount (total minus fuel) - the claim machinery and
			// the sealed envelope consume it unchanged (plan L11).
			const tokenAmount = fuelSlice ? amount - fuelSlice : amount
			log("start", { id, amount: amount.toString(), fuelSlice: fuelSlice?.toString(), isPrivate })

			const base: DepositJournalRecord = {
				schema: fuelPre ? 2 : 1,
				id,
				direction: "deposit",
				isPrivate,
				amount: tokenAmount.toString(),
				createdAt: now,
				updatedAt: now,
				chainId: sepolia.id,
				portal: L1_PORTAL,
				bridge: BRIDGE.toString(),
				recipient,
				secretHashHex: id,
				secret: isPrivate ? undefined : secret.toString(),
				...(fuelPre && fuelSlice
					? {
							fuel: {
								amount: fuelSlice.toString(),
								secret: fuelPre.secret.toString(),
								secretHashHex: fuelPre.secretHashHex,
								minOutput: fuelPre.minOutput.toString(),
							},
						}
					: {}),
			}

			// The record exists BEFORE any signature: a storage failure aborts before the user signs
			// anything, and the stepper has a record to narrate from the first prompt on. A clean
			// rejection during the legs discards it (the cleanup matrix).
			addRecordVerified(base)
			markSessionLive(id)
			opts.onRecord?.(id)

			if (isPrivate) {
				const provider = providerFingerprint()
				const trusted = isSealTrusted(localStorage, sepolia.id, from, provider)
				log(trusted ? "seal: trusted wallet - one signature" : "seal: first private bridge for this wallet - two signatures")
				setRecordStep(
					id,
					"sealing",
					trusted
						? "one Ethereum signature - encrypts the recovery secret"
						: "two Ethereum signatures - encrypt + verify determinism",
				)
				const sign = (m: string) =>
					runOnLane("l1", () => wallet.signMessage({ account: from, message: m } as never) as Promise<string>)
				const envelope = { secret: secret.toString(), recipient, amount: tokenAmount.toString(), sealerL1: from }
				const { blob, key } = await sealDepositRecord({
					sign,
					binding: { chainId: sepolia.id, portal: L1_PORTAL, bridge: BRIDGE.toString(), secretHashHex: id },
					envelope,
					trusted,
				})
				if (!trusted) markSealTrusted(localStorage, sepolia.id, from, provider)
				sealKeys.set(id, key)
				cacheSecret(id, secret.toString(), { v: 2, ...envelope })
				updateRecord(id, { sealedEnvelope: blob, sealerL1: from })
				// Write-and-verify the ENVELOPE patch too: the record was created pre-seal, so a silent
				// storage failure here would leave a private record without its only recovery blob.
				const sealed = journal.records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
				if (!sealed?.sealedEnvelope) {
					throw new Error("Could not persist the sealed recovery secret - aborting before the deposit (storage full?).")
				}
			}

			if (fuelPre && fuelSlice && BRIDGE_FUEL) {
				const fuelCfg = BRIDGE_FUEL
				// Fueled leg: ONE Permit2 witness signature + ONE router tx. No approve - the live
				// token pre-approves Permit2 for every holder (asserted, fail-closed).
				const permit2Allowance = (await l1.publicClient.readContract({
					address: L1_USDC,
					abi: ERC20_ABI,
					functionName: "allowance",
					args: [from, fuelCfg.permit2],
				})) as bigint
				if (permit2Allowance < amount) {
					throw new Error("This token does not pre-approve Permit2 - fueled bridging is unavailable for it.")
				}

				setRecordStep(id, "signing", "sign the bridge intent in your Ethereum wallet - one signature covers swap + deposit")
				const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
				const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
				const witness: BridgeWitness = {
					tokenPortal: L1_PORTAL,
					bridgeToken: L1_USDC,
					totalAmount: amount,
					fuelAmount: fuelSlice,
					aztecRecipient: recipient as `0x${string}`,
					fuelRecipient: recipient as `0x${string}`,
					tokenSecretHash: id as `0x${string}`,
					fuelSecretHash: fuelPre.secretHashHex as `0x${string}`,
					minFuelOutput: fuelPre.minOutput,
					routeHash: hashRoute(fuelPre.route.path, fuelPre.route.zeroForOnes),
					isPrivate,
				}
				const typed = bridgeWitnessPermitTypedData(
					{ permitted: { token: L1_USDC, amount }, spender: fuelCfg.router, nonce, deadline },
					witness,
					fuelCfg.permit2,
					sepolia.id,
				)
				const signature = await runOnLane("l1", () => wallet.signTypedData({ account: from, ...typed } as never))

				log("bridgeWithFuel (confirm in your Ethereum wallet)")
				setRecordStep(id, "depositing", "confirm the fueled deposit in your Ethereum wallet")
				const fuelTxHash = await runOnLane("l1", () =>
					wallet.writeContract({
						address: fuelCfg.router,
						abi: SWAP_BRIDGE_ROUTER_ABI,
						functionName: "bridgeWithFuel",
						args: [
							{
								tokenPortal: witness.tokenPortal,
								bridgeToken: witness.bridgeToken,
								totalAmount: witness.totalAmount,
								fuelAmount: witness.fuelAmount,
								aztecRecipient: witness.aztecRecipient,
								fuelRecipient: witness.fuelRecipient,
								tokenSecretHash: witness.tokenSecretHash,
								fuelSecretHash: witness.fuelSecretHash,
								minFuelOutput: witness.minFuelOutput,
								path: fuelPre.route.path,
								zeroForOnes: fuelPre.route.zeroForOnes,
								isPrivate,
							},
							{ nonce, deadline, signature },
						],
						chain: sepolia,
						account: from,
					} as never),
				)
				updateRecord(id, { depositTxHash: fuelTxHash as string })
				setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
				const fuelReceipt = await l1.publicClient.waitForTransactionReceipt({ hash: fuelTxHash as `0x${string}` })
				const fuelEvents = parseEventLogs({ abi: SWAP_BRIDGE_ROUTER_ABI, eventName: "BridgeWithFuel", logs: fuelReceipt.logs })
				const fe = fuelEvents[0] as { args?: { tokenIndex?: bigint; fuelIndex?: bigint; fuelAmount?: bigint } } | undefined
				if (fe?.args?.tokenIndex === undefined || fe.args.fuelIndex === undefined || fe.args.fuelAmount === undefined) {
					throw new Error("bridgeWithFuel emitted no BridgeWithFuel event")
				}
				let fuelL2Block: number | undefined
				try {
					fuelL2Block = Number(await createAztecNodeClient(NODE_URL).getBlockNumber())
				} catch {
					fuelL2Block = undefined
				}
				// fuel.received comes from the EVENT - the content-hash law; the quote was display-only.
				updateRecord(id, {
					leafIndex: fe.args.tokenIndex.toString(),
					depositL2Block: fuelL2Block,
					fuel: {
						amount: fuelSlice.toString(),
						secret: fuelPre.secret.toString(),
						secretHashHex: fuelPre.secretHashHex,
						minOutput: fuelPre.minOutput.toString(),
						leafIndex: fe.args.fuelIndex.toString(),
						received: fe.args.fuelAmount.toString(),
					},
				})
				log("BridgeWithFuel", {
					tokenLeaf: fe.args.tokenIndex.toString(),
					fuelLeaf: fe.args.fuelIndex.toString(),
					received: fe.args.fuelAmount.toString(),
				})

				const key = sealKeys.get(id)
				if (isPrivate && key) {
					const finalized = await sealDepositEnvelope(key, {
						secret: secret.toString(),
						recipient,
						amount: tokenAmount.toString(),
						sealerL1: from,
						leafIndex: fe.args.tokenIndex.toString(),
					})
					updateRecord(id, { sealedEnvelope: finalized })
					sealKeys.delete(id)
				}

				setRecordStep(id, undefined, undefined)
				await runDepositClaim(id)
				log("fueled deposit flow finished", id)
				return id
			}

			// Allowance-skip: approve only when the portal's allowance is short.
			setRecordStep(id, "approving", "checking the portal allowance")
			const allowance = (await l1.publicClient.readContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [from, L1_PORTAL],
			})) as bigint
			if (allowance < amount) {
				log("approving the portal (confirm in your Ethereum wallet)")
				setRecordStep(id, "approving", "confirm the allowance in your Ethereum wallet")
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
				markApproveOutcome(id, "done")
			} else {
				log("allowance sufficient - skipping approve")
				markApproveOutcome(id, "skipped")
			}

			const depositFn = isPrivate ? "depositToAztecPrivate" : "depositToAztecPublic"
			const depositArgs = isPrivate ? [tokenAmount, id] : [recipient as `0x${string}`, tokenAmount, id as `0x${string}`]
			log(`${depositFn} (confirm in your Ethereum wallet)`)
			setRecordStep(id, "depositing", "confirm the deposit in your Ethereum wallet")
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
			// Persisted the moment the hash exists - leafIndex stays chain-recoverable from here on.
			updateRecord(id, { depositTxHash: depositTxHash as string })
			setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
			const receipt = await l1.publicClient.waitForTransactionReceipt({ hash: depositTxHash as `0x${string}` })

			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: receipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) throw new Error("deposit emitted no Inbox MessageSent event")
			const leafIndex = event.args.index.toString()
			// Snapshot the L2 height at deposit-confirm time - anchors the sync countdown. Best-effort:
			// a dead node just means the gate narrates without the block countdown.
			let depositL2Block: number | undefined
			try {
				depositL2Block = Number(await createAztecNodeClient(NODE_URL).getBlockNumber())
			} catch {
				depositL2Block = undefined
			}
			updateRecord(id, { leafIndex, depositL2Block })
			log("L1→L2 message leaf index", leafIndex, "L2 height at confirm", depositL2Block)

			// Finalized envelope: same key retained in memory ⇒ zero additional signatures.
			const key = sealKeys.get(id)
			if (isPrivate && key) {
				const finalized = await sealDepositEnvelope(key, {
					secret: secret.toString(),
					recipient,
					amount: tokenAmount.toString(),
					sealerL1: from,
					leafIndex,
				})
				updateRecord(id, { sealedEnvelope: finalized })
				sealKeys.delete(id)
			}

			setRecordStep(id, undefined, undefined) // the engine narrates from here
			await runDepositClaim(id)
			log("deposit flow finished", id)
		} catch (e) {
			const msg = humanizeWalletError(e instanceof Error ? e.message : "Deposit failed")
			log("FAILED:", msg)
			error.value = msg
			// The cleanup matrix (plan S8/S14): an EXPLICIT user rejection before any tx hash
			// discards the record; ambiguous failures keep it with an error surface.
			if (id) {
				const rec = journal.records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
				if (rec && !rec.depositTxHash && isUserRejection(e)) {
					discard(id)
					error.value = "Rejected in your wallet - nothing was sent."
				} else if (rec) {
					flagRecordError(id, `${msg}. Your funds are not lost - this bridge stays in Pending.`)
				}
			}
		} finally {
			busy.value = false
		}
		return id
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
