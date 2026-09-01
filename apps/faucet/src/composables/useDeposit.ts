import { AztecAddress } from "@aztec/aztec.js/addresses"
import { fuelRecipientFor } from "@/lib/fuel-target"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash } from "@aztec/aztec.js/tx"
import {
	type BridgeWitness,
	type DepositJournalRecord,
	type EncryptionKey,
	assetKindOf,
	awaitL1Receipt,
	SWAP_BRIDGE_ROUTER_ABI,
	bridgeWitnessPermitTypedData,
	ensurePermit2Allowance,
	buildFuelRoute,
	deriveBridgeSecret,
	deriveTokenClaimSecret,
	hashRoute,
	isSealTrusted,
	markSealTrusted,
	minOutputForSlippage,
	PERMIT_DEADLINE_SECONDS,
	PRIVATE_FPC_ADDRESS,
	quoteFuelPath,
	sealDepositEnvelope,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { parseEventLogs } from "viem"
import { classifyClaimReceipt } from "@/lib/claim-receipt"
import { NETWORK } from "@/lib/network"
import { ref, watch } from "vue"
import {
	BRIDGE,
	BRIDGE_FUEL,
	BRIDGE_PERMIT2,
	BRIDGE_ROUTER,
	BRIDGE_SWAP_TARGET,
	L1_PORTAL,
	L1_USDC,
	SUPPORTS_SALT_V2,
} from "@/contracts/bridge-deployments"
import { decideStandaloneFuelRecovery } from "@/lib/fuel-claim-state"
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
import {
	buildClaimInteraction,
	fuelReceiptStatus,
	readPrivateFeeJuiceBalance,
	readPublicFeeJuiceBalance,
	recoverDepositLeg,
	sendStandaloneFjClaim,
} from "./deposit-flow"
import { useBridgeWallet } from "./useBridgeWallet"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"
import { withOperation } from "./useOpsInFlight"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

const NODE_URL = NETWORK.nodeUrl

/**

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

/** Probe a claim tx's receipt - record-specific ground truth. "included" covers success AND
 *  app-reverted: both are checkpointed block-status (the app revert lives in executionResult, not
 *  status), and an INCLUDED claim consumes the FJ message regardless of app-phase outcome. */
/** Read a claim tx's fee (the gas it used), base units — for the receipt's "gas used / available"
 *  ledger. Best-effort: a missing fee or unreachable node returns undefined, so the receipt falls back
 *  to showing gas bought without the used/available split. Read post-completion (claim flow untouched). */
export async function readClaimFee(txHash: string): Promise<bigint | undefined> {
	try {
		const receipt = await createAztecNodeClient(NODE_URL).getTxReceipt(TxHash.fromString(txHash))
		const fee = (receipt as { transactionFee?: bigint } | undefined)?.transactionFee
		return fee === undefined || fee === null ? undefined : BigInt(fee as never)
	} catch {
		return undefined
	}
}

/** Reconcile a fueled record's `consumed` flag from chain truth: if the fjwc attempt tx is
 *  INCLUDED (success OR app-reverted - both consumed the FJ message), persist `consumed`. Probing
 *  `fuel.claimTxHash` directly (not the completing claim) covers every path: the happy fjwc
 *  success, an fjwc included-but-reverted before a sponsored retry, and leaves a genuinely DROPPED
 *  fjwc unsettled so the recovery affordance surfaces. Idempotent; the card calls it on completed
 *  fueled records so the happy path suppresses the button without it ever flashing. */
export async function reconcileFuelConsumed(id: string): Promise<void> {
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	const fuel = rec?.fuel
	if (!fuel?.claimTxHash || fuel.consumed === true) return
	if ((await fuelReceiptStatus(fuel.claimTxHash)) === "included") {
		updateRecord(id, { fuel: { ...fuel, consumed: true } })
	}
}

/** The card's "CLAIM YOUR GAS" recovery: claims a stranded fuel message after the token side
 *  already completed. Throws so the caller can surface the failure (never silent). */
export async function claimFuelStandalone(id: string): Promise<void> {
	const bridgeWallet = useBridgeWallet()
	const aztec = bridgeWallet.wallet.value
	if (!aztec) throw new Error("Connect your Aztec wallet first.")
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	const fuel = rec?.fuel
	if (!rec || !fuel?.received || !fuel.leafIndex) throw new Error("This bridge has no fuel to claim.")
	// Same source as the card's affordance, so the button and this guard can never disagree. The
	// ladder below is public + sponsored, which L11 forbids for private records — and their FJ is
	// bound to the PrivateFPC, so it could not match one anyway.
	if (
		decideStandaloneFuelRecovery({
			isPrivate: rec.isPrivate,
			isFeeJuiceAsset: assetKindOf(rec) === "fee-juice",
			schema: rec.schema,
			completedAt: rec.completedAt,
			fuel,
		}) !== "offer"
	) {
		throw new Error("Private gas is claimed as part of the private bridge; standalone recovery is unavailable.")
	}
	// Post-impl audit HIGH-1/HIGH-2: the claim acts for rec.recipient — refuse under a different
	// (or unknown — fail-closed) active account, and run the wallet send inside a tracked
	// operation span.
	const active = bridgeWallet.selectedAccount.value
	if (!active || active.toLowerCase() !== rec.recipient.toLowerCase()) {
		throw new Error(
			`This gas claim belongs to ${rec.recipient.slice(0, 6)}…${rec.recipient.slice(-4)}. Switch to that account to claim.`,
		)
	}
	await withOperation(() => sendStandaloneFjClaim(aztec, AztecAddress.fromStringUnsafe(rec.recipient), fuel, id))
}

let depsWired = false

/** Wire the journal engine's deposit-side chain deps (idempotent; real clients only). Exported as
 *  ensureDepositJournalDeps so the Fuel flow guarantees wiring WITHOUT useDepositFlow's
 *  resumeSessionWork side-effect (codex Option C, lessons/phase-3.md). */
export function ensureDepositJournalDeps(): void {
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
		recoverDepositLeg: (rec) => recoverDepositLeg(rec, l1.publicClient as never),
		claim: async (rec, secretHex, envelope) => {
			const aztec = bridgeWallet.wallet.value
			if (!aztec) throw new Error("Connect your Aztec wallet first.")
			return buildClaimInteraction(rec, secretHex, envelope, aztec, fuelOverrides.has(rec.id))
		},
		l2BlockNumber: async () => Number(await createAztecNodeClient(NODE_URL).getBlockNumber()),
		messageReadiness: async (messageHash) => {
			const node = createAztecNodeClient(NODE_URL)
			const cp = await node.getL1ToL2MessageCheckpoint(Fr.fromString(messageHash))
			if (cp === undefined || cp === null) return null
			const latest = await node.getBlockData("latest")
			return { checkpoint: Number(cp), anchor: Number(latest?.checkpointNumber ?? 0) }
		},
		claimReceiptStatus: async (txHash) => {
			const node = createAztecNodeClient(NODE_URL)
			try {
				const receipt = await node.getTxReceipt(TxHash.fromString(txHash))
				return classifyClaimReceipt(receipt as { status?: unknown; executionResult?: unknown })
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
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (351 lines) — split when touched, never grow
export function useDepositFlow() {
	ensureDepositJournalDeps()
	const l1 = useL1Wallet()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (334 lines) — split when touched, never grow
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 132) — refactor when touched, never raise
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

			// No-fuel L7 (faucet-only): block a TRULY cold account before depositing so tokens aren't bridged
			// unclaimable. Cold = zero PUBLIC and zero PRIVATE Fee Juice; private FJ (held at the PrivateFPC
			// from a prior private fuel claim) pays the no-fuel claim via pay_fee, so it is NOT cold. A read
			// error gives the benefit of the doubt (the claim-time gate is the fail-closed check); a FUELED
			// bridge is never blocked (it brings its own gas).
			if (!fuelSlice) {
				try {
					const addr = AztecAddress.fromStringUnsafe(recipient)
					if ((await readPublicFeeJuiceBalance(aztec, addr)) === 0n) {
						const priv = await readPrivateFeeJuiceBalance(aztec, addr).catch(() => null)
						if (priv === 0n) {
							error.value =
								'No gas (Fee Juice) to claim a no-fuel bridge. Turn on "arrive with gas", or fund your Aztec account first.'
							return null
						}
					}
				} catch (e) {
					log(
						"no-fuel cold-check (pre-deposit) read failed; proceeding (the claim re-checks):",
						e instanceof Error ? e.message : String(e),
					)
				}
			}
			let fuelPre:
				| { secret: Fr; secretHashHex: string; minOutput: bigint; route: ReturnType<typeof buildFuelRoute>; salt?: Fr }
				| undefined
			if (fuelSlice) {
				if (!BRIDGE_FUEL) throw new Error("Fuel is not configured for this deployment.")
				if (fuelSlice >= amount) throw new Error("The fuel slice must be smaller than the total amount.")
				const route = buildFuelRoute({
					token: L1_USDC,
					weth: BRIDGE_FUEL.weth,
					feeJuice: BRIDGE_FUEL.feeJuice,
					tokenWeth: BRIDGE_FUEL.pools.tokenWeth,
					ethFj: BRIDGE_FUEL.pools.ethFj,
				})
				const quote = await quoteFuelPath(l1.publicClient as never, BRIDGE_FUEL.quoter, route, fuelSlice)
				if (quote < BRIDGE_FUEL.minFuelFj) {
					throw new Error("That fuel slice buys too little gas to cover its own claim - increase it or bridge without fuel.")
				}
				// PRIVATE fuel: the secret MUST be deriveBridgeSecret(salt, claimer) so the claimer can
				// reconstruct it from msg_sender inside PrivateFPC.mint_and_pay_fee — a random secret would
				// strand the FJ forever (L3/L4). The per-deposit BRIDGE-SECRET salt is random + persisted;
				// it is DISTINCT from the FPC-ADDRESS salt (Fr.zero()). Public fuel stays recipient-bound random.
				const claimer = AztecAddress.fromStringUnsafe(recipient)
				const bridgeSecretSalt = isPrivate ? Fr.random() : undefined
				const fuelSecret = bridgeSecretSalt ? deriveBridgeSecret(bridgeSecretSalt, claimer) : Fr.random()
				fuelPre = {
					secret: fuelSecret,
					secretHashHex: (await computeSecretHash(fuelSecret)).toString(),
					minOutput: minOutputForSlippage(quote, BRIDGE_FUEL.slippageBps),
					route,
					salt: bridgeSecretSalt,
				}
			}

			// L9 runtime interlock: recipient-committed private deposits require a salt-v2 manifest. Refuse
			// otherwise — a derived-secret deposit against an old bearer-bridge manifest would strand funds.
			if (isPrivate && !SUPPORTS_SALT_V2) {
				throw new Error(
					"This deployment predates recipient-committed private claims (manifest lacks privateClaimMode: salt-v2). Private bridging is unavailable here — use a public bridge or wait for the cutover.",
				)
			}
			// Defense-in-depth (codex ultra Low): a nonzero-but-invalid recipient (not a Grumpkin point)
			// would be committed and then mint an undecryptable, unrecoverable note. The wallet-connected
			// address is always valid, but fail closed here too before the irreversible L1 tx.
			if (!(await AztecAddress.fromStringUnsafe(recipient).isValid())) {
				throw new Error("Selected account is not a valid Aztec address — refusing to bridge.")
			}
			// `secret` is the value stored + claimed-with: for PRIVATE it's the recipient-committed claim_salt
			// (claim_private re-derives the consumption secret from it + the recipient); for PUBLIC it's the raw
			// secret (claim_public binds the recipient in its content hash). The L1-committed secretHash is over
			// the DERIVED secret for private, so a claim naming a different recipient can't consume the message.
			const secret = Fr.random()
			const committedSecret = isPrivate ? deriveTokenClaimSecret(secret, AztecAddress.fromStringUnsafe(recipient)) : secret
			const secretHash = await computeSecretHash(committedSecret)
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
				chainId: NETWORK.l1ChainId,
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
								// PRIVATE fuel: persist the bridge-secret salt + the FPC the FJ lands at, so the
								// claim can rebuild the Wonderland method. Plaintext-safe by design: the fuel secret is
								// CLAIMER-COMMITTED (deriveBridgeSecret(salt, claimer); PrivateFPC.mint_and_pay_fee
								// re-derives it from msg_sender), so a localStorage read is a privacy-linkage, not a
								// theft/consume path. Recovery rides the whole-record backup seal (backup.ts); the
								// sealedEnvelope deliberately carries only the recipient-committed TOKEN salt.
								...(isPrivate ? { bridgeSecretSalt: fuelPre.salt?.toString(), fpc: PRIVATE_FPC_ADDRESS } : {}),
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
				const trusted = isSealTrusted(localStorage, NETWORK.l1ChainId, from, provider)
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
					binding: { chainId: NETWORK.l1ChainId, portal: L1_PORTAL, bridge: BRIDGE.toString(), secretHashHex: id },
					envelope,
					trusted,
				})
				if (!trusted) markSealTrusted(localStorage, NETWORK.l1ChainId, from, provider)
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

			// Real USDC (and the DP7 permissionless-mint test token) start at ZERO Permit2 allowance, so a
			// deposit must do a one-time approve(Permit2, max) before the witness transfer. The testnet
			// MintableERC20 auto-grants Permit2 → this short-circuits (no tx) for it; the DP7 token + real
			// USDC are what exercise the approve (codex F2/F4). Mirrors useFuel's approve leg.
			const ensurePermit2Approval = async (permit2: `0x${string}`, needed: bigint, recordId: string): Promise<void> => {
				// The shared approval state machine (bridge-core) — the same sequencing the candidate
				// smokes rehearse. The approval hash is JOURNALED the moment it exists, so a rejection
				// after the approval mines still shows the standing max allowance instead of
				// "nothing was sent".
				await ensurePermit2Allowance({
					allowance: async () =>
						(await l1.publicClient.readContract({
							address: L1_USDC,
							abi: ERC20_ABI,
							functionName: "allowance",
							args: [from, permit2],
						})) as bigint,
					approveMax: async () =>
						(await runOnLane("l1", () =>
							wallet.writeContract({
								address: L1_USDC,
								abi: ERC20_ABI,
								functionName: "approve",
								args: [permit2, (1n << 256n) - 1n],
								chain: NETWORK.viemChain,
								account: from,
							}),
						)) as `0x${string}`,
					waitReceipt: async (hash) =>
						await awaitL1Receipt(l1.publicClient, hash, {
							onStillWaiting: (attempt) =>
								setRecordStep(recordId, "approving", `still waiting for the approval (round ${attempt})`),
						}),
					needed,
					onStatus: (status, txHash) => {
						if (status === "approving")
							setRecordStep(recordId, "approving", "first time only: approve Permit2 in your Ethereum wallet")
						if (status === "waiting" && txHash) updateRecord(recordId, { approveTxHash: txHash })
						if (status === "approved") markApproveOutcome(recordId, "done")
					},
				})
			}

			if (fuelPre && fuelSlice && BRIDGE_FUEL) {
				const fuelCfg = BRIDGE_FUEL
				// Fueled leg: one-time Permit2 approve (if needed) → ONE Permit2 witness signature + ONE router tx.
				await ensurePermit2Approval(fuelCfg.permit2, amount, id)

				setRecordStep(id, "signing", "sign the bridge intent in your Ethereum wallet - one signature covers swap + deposit")
				const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
				const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS
				const witness: BridgeWitness = {
					tokenPortal: L1_PORTAL,
					bridgeToken: L1_USDC,
					totalAmount: amount,
					fuelAmount: fuelSlice,
					// PRIVATE: recipient is committed via tokenSecretHash, NOT published — the router ignores it on
					// the private path but EMITS it indexed, so a real value here leaks R. Zero it for private.
					aztecRecipient: (isPrivate ? `0x${"0".repeat(64)}` : recipient) as `0x${string}`,
					// PRIVATE fuel lands at the PrivateFPC (claimer-bound by the secret); PUBLIC fuel at the user.
					// A bug here either leaks (user addr on L1) or strands (FJ to a non-FPC) — the headline invariant.
					fuelRecipient: fuelRecipientFor(isPrivate, recipient),
					tokenSecretHash: id as `0x${string}`,
					fuelSecretHash: fuelPre.secretHashHex as `0x${string}`,
					minFuelOutput: fuelPre.minOutput,
					routeHash: hashRoute(fuelPre.route.path, fuelPre.route.zeroForOnes),
					isPrivate,
					// F-004: bind the router's swap target into the witness; a setSwapTarget voids this signature.
					swapTarget: fuelCfg.swapTarget,
				}
				const typed = bridgeWitnessPermitTypedData(
					{ permitted: { token: L1_USDC, amount }, spender: fuelCfg.router, nonce, deadline },
					witness,
					fuelCfg.permit2,
					NETWORK.l1ChainId,
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
						chain: NETWORK.viemChain,
						account: from,
					} as never),
				)
				updateRecord(id, { depositTxHash: fuelTxHash as string })
				setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
				const fuelRecId = id
				const fuelReceipt = await awaitL1Receipt(l1.publicClient, fuelTxHash as `0x${string}`, {
					onStillWaiting: (attempt) =>
						setRecordStep(fuelRecId, "depositing", `still waiting for the Ethereum confirmation (round ${attempt})`),
				})
				const fuelEvents = parseEventLogs({ abi: SWAP_BRIDGE_ROUTER_ABI, eventName: "BridgeWithFuel", logs: fuelReceipt.logs })
				const fe = fuelEvents[0] as
					| {
							args?: {
								tokenKey?: `0x${string}`
								tokenIndex?: bigint
								fuelKey?: `0x${string}`
								fuelIndex?: bigint
								fuelAmount?: bigint
							}
					  }
					| undefined
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
					messageHash: fe.args.tokenKey,
					depositL2Block: fuelL2Block,
					fuel: {
						amount: fuelSlice.toString(),
						secret: fuelPre.secret.toString(),
						secretHashHex: fuelPre.secretHashHex,
						minOutput: fuelPre.minOutput.toString(),
						leafIndex: fe.args.fuelIndex.toString(),
						messageHash: fe.args.fuelKey,
						received: fe.args.fuelAmount.toString(),
						...(isPrivate ? { bridgeSecretSalt: fuelPre.salt?.toString(), fpc: PRIVATE_FPC_ADDRESS } : {}),
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

			// Single deposit path: bridge-only through the router's Permit2 `bridge()` (fuel fields zeroed).
			// A one-time Permit2 approve (if needed) precedes it; the witness pins tokenPortal/token/amount/
			// recipient/secretHash/isPrivate + the router's swapTarget.
			if (!BRIDGE_ROUTER || !BRIDGE_PERMIT2 || !BRIDGE_SWAP_TARGET) {
				throw new Error("Bridge router/permit2 not configured (required for the deposit path).")
			}
			await ensurePermit2Approval(BRIDGE_PERMIT2, tokenAmount, id)

			setRecordStep(id, "signing", "sign the bridge intent in your Ethereum wallet - one signature")
			const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
			const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS
			const bridgeWitness: BridgeWitness = {
				tokenPortal: L1_PORTAL,
				bridgeToken: L1_USDC,
				totalAmount: tokenAmount,
				fuelAmount: 0n,
				// PRIVATE recipient is committed via secretHash, never published — zero it so the router's
				// indexed Bridge event can't leak R (privacy). PUBLIC binds R in the portal content hash.
				aztecRecipient: (isPrivate ? `0x${"0".repeat(64)}` : recipient) as `0x${string}`,
				fuelRecipient: `0x${"0".repeat(64)}`,
				tokenSecretHash: id as `0x${string}`,
				fuelSecretHash: `0x${"0".repeat(64)}`,
				minFuelOutput: 0n,
				routeHash: `0x${"0".repeat(64)}`,
				isPrivate,
				swapTarget: BRIDGE_SWAP_TARGET,
			}
			const bridgeTyped = bridgeWitnessPermitTypedData(
				{ permitted: { token: L1_USDC, amount: tokenAmount }, spender: BRIDGE_ROUTER, nonce, deadline },
				bridgeWitness,
				BRIDGE_PERMIT2,
				NETWORK.l1ChainId,
			)
			const bridgeSig = await runOnLane("l1", () => wallet.signTypedData({ account: from, ...bridgeTyped } as never))

			log("bridge (confirm in your Ethereum wallet)")
			setRecordStep(id, "depositing", "confirm the deposit in your Ethereum wallet")
			const depositTxHash = await runOnLane("l1", () =>
				wallet.writeContract({
					address: BRIDGE_ROUTER,
					abi: SWAP_BRIDGE_ROUTER_ABI,
					functionName: "bridge",
					args: [
						{
							tokenPortal: L1_PORTAL,
							bridgeToken: L1_USDC,
							amount: tokenAmount,
							aztecRecipient: bridgeWitness.aztecRecipient,
							secretHash: id as `0x${string}`,
							isPrivate,
						},
						{ nonce, deadline, signature: bridgeSig },
					],
					chain: NETWORK.viemChain,
					account: from,
				} as never),
			)
			// Persisted the moment the hash exists - leafIndex stays chain-recoverable from here on.
			updateRecord(id, { depositTxHash: depositTxHash as string })
			setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
			const recId = id
			const receipt = await awaitL1Receipt(l1.publicClient, depositTxHash as `0x${string}`, {
				onStillWaiting: (attempt) =>
					setRecordStep(recId, "depositing", `still waiting for the Ethereum confirmation (round ${attempt})`),
			})

			// Leaf index + message key from the router's Bridge event (not the Inbox — the router re-emits them).
			const bridged = parseEventLogs({ abi: SWAP_BRIDGE_ROUTER_ABI, eventName: "Bridge", logs: receipt.logs })
			const bev = bridged[0] as { args?: { index?: bigint; key?: `0x${string}` } } | undefined
			if (bev?.args?.index === undefined) throw new Error("bridge() emitted no Bridge event")
			const leafIndex = bev.args.index.toString()
			if (bev.args.key) updateRecord(id, { messageHash: bev.args.key })
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
					// A rejection AFTER the one-time Permit2 approval mined must not read as a no-op — the max
					// allowance stands (harmless: only YOUR signature can spend it; revocable anytime).
					const approvedFirst = !!rec.approveTxHash
					discard(id)
					error.value = approvedFirst
						? "Rejected in your wallet - nothing was bridged. The one-time Permit2 approval from this attempt remains active (only your signature can use it; revocable anytime)."
						: "Rejected in your wallet - nothing was sent."
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

	// withOperation: a deposit is an account-sensitive prompt/send span — while it runs, account
	// switching is blocked (useOpsInFlight, plan D-8/D-19).
	return { busy, error, deposit: (...args: Parameters<typeof deposit>) => withOperation(() => deposit(...args)), journal }
}
