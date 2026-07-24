import { AztecAddress } from "@aztec/aztec.js/addresses"
import { InboxAbi } from "@aztec/l1-artifacts"
import { Contract } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { Gas } from "@aztec/stdlib/gas"
import {
	type BridgeWitness,
	type DepositJournalRecord,
	type EncryptionKey,
	assetKindOf,
	awaitL1Receipt,
	SWAP_BRIDGE_ROUTER_ABI,
	bridgeWitnessPermitTypedData,
	buildFuelRoute,
	deriveBridgeSecret,
	deriveTokenClaimSecret,
	feeJuiceAddress,
	hashRoute,
	isSealTrusted,
	markSealTrusted,
	minOutputForSlippage,
	predictedWorstMinFees,
	PRIVATE_FPC_ADDRESS,
	parseFeeJuiceDeposit,
	privateMintAndPayFee,
	publicFeeJuicePayment,
	quoteFuelPath,
	sealDepositEnvelope,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { parseEventLogs } from "viem"
import { NETWORK } from "@/lib/network"
import { ref, watch } from "vue"
import {
	BRIDGE,
	BRIDGE_FUEL,
	BRIDGE_PERMIT2,
	BRIDGE_ROUTER,
	BRIDGE_SWAP_TARGET,
	FUEL_MIN_FJ,
	L1_PORTAL,
	L1_USDC,
	SUPPORTS_SALT_V2,
} from "@/contracts/bridge-deployments"
import {
	FUEL_FEE_MARGIN,
	PRIVATE_ATTEMPT_STALE_MS,
	decideFuelClaim,
	decideNoFuelClaimGate,
	decidePrivateFuelClaim,
	isPrivateFuelInsufficiency,
} from "@/lib/fuel-claim-state"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import {
	addRecordVerified,
	cacheSecret,
	connectJournalDeps,
	discard,
	flagRecordError,
	markSessionLive,
	isMsgConsumed,
	resumeSessionWork,
	runDepositClaim,
	runOnLane,
	setRecordStep,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"
import { humanizeWalletError, isUserRejection } from "@/lib/wallet-errors"
import { buildFuelClaimInteraction } from "./fuelClaim"
import { useBridgeWallet } from "./useBridgeWallet"
import { ERC20_ABI } from "./useL1Usdc"
import { useL1Wallet } from "./useL1Wallet"
import { readBalance } from "./useTokenBalance"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

const NODE_URL = NETWORK.nodeUrl

/**

/** Human Fee Juice (18 decimals) for user-facing balance/shortfall messages; `null` = unread. */
const fmtFj = (x: bigint | null): string => (x === null ? "?" : `${(Number(x) / 1e18).toFixed(3)} FJ`)

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

/** Poll a just-sent claim tx to INCLUSION (bounded). PROPOSED is not consumption; only an included
 *  receipt confirms the FJ message is settled. Returns "pending" on timeout so the caller leaves
 *  the record unsettled and the recovery action stays offered. */
async function waitForFuelInclusion(txHash: string, tries = 40): Promise<"included" | "dropped" | "pending"> {
	for (let i = 0; i < tries; i++) {
		const s = await fuelReceiptStatus(txHash)
		if (s !== "pending") return s
		await new Promise((r) => setTimeout(r, 6000))
	}
	return "pending"
}

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

/** Claim a fueled deposit's Fee Juice as a standalone, sponsored tx, INCLUSION-GATED. The FJ
 *  message is recipient-bound, so this is safe whenever fuel isn't known-consumed; an
 *  already-consumed message reverts but still reads INCLUDED (its nullifier exists), which settles
 *  it just the same. `standaloneClaimed` latches ONLY after inclusion - a dropped/timed-out tx
 *  leaves it unset so the card re-offers the action (closes the PROPOSED-latch false-negative). */
async function sendStandaloneFjClaim(
	aztec: unknown,
	recipientAddr: AztecAddress,
	fuel: NonNullable<DepositJournalRecord["fuel"]>,
	id: string,
): Promise<void> {
	const fpc = await getSponsoredFpcInstance()
	const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const fj = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, aztec as never)
	let receiptTxHash: string
	try {
		// Plain `claim`, NOT `claim_and_end_setup`: the sponsored fee payment already ends setup, so
		// the end-setup variant asserts as an app-phase call (see fuelClaim.ts — same live-caught bug).
		const { receipt } = (await fj.methods
			.claim(recipientAddr, BigInt(fuel.received ?? "0"), Fr.fromString(fuel.secret), new Fr(BigInt(fuel.leafIndex ?? "0")))
			.send({ from: recipientAddr, fee: sponsored, wait: { waitForStatus: TxStatus.PROPOSED } } as never)) as {
			receipt: { txHash: unknown }
		}
		receiptTxHash = String(receipt.txHash)
	} catch (e) {
		// The FJ message is already CONSUMED (nullified) ⇒ the gas is already in the wallet. Self-correct:
		// settle rather than error, so a false-positive CLAIM YOUR GAS click resolves cleanly. Must be the
		// consumed shape, NOT not-ready: latching standaloneClaimed on a not-yet-anchored message would
		// permanently hide the recovery affordance for FJ that was never claimed (fund-stranding).
		if (isMsgConsumed(e instanceof Error ? e.message : String(e))) {
			updateRecord(id, { fuel: { ...fuel, standaloneClaimed: true } })
			log("standalone FJ claim: message already consumed - gas already in wallet", id)
			return
		}
		throw e
	}
	if ((await waitForFuelInclusion(receiptTxHash)) !== "included") {
		throw new Error("The gas claim was sent but hasn't confirmed yet - try CLAIM YOUR GAS again in a moment.")
	}
	updateRecord(id, { fuel: { ...fuel, standaloneClaimed: true } })
	log("standalone FJ claim confirmed", id)
}

/** The card's "CLAIM YOUR GAS" recovery: claims a stranded fuel message after the token side
 *  already completed. Throws so the caller can surface the failure (never silent). */
export async function claimFuelStandalone(id: string): Promise<void> {
	const bridgeWallet = useBridgeWallet()
	const aztec = bridgeWallet.wallet.value
	if (!aztec) throw new Error("Connect your Aztec wallet first.")
	const rec = useBridgeJournal().records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	if (!rec?.fuel?.received || !rec.fuel.leafIndex) throw new Error("This bridge has no fuel to claim.")
	await sendStandaloneFjClaim(aztec, AztecAddress.fromStringUnsafe(rec.recipient), rec.fuel, id)
}

/** Read the account's PUBLIC Fee Juice balance — the cold-account detector for no-fuel claims. Uses the
 *  FeeJuice contract's `balance_of_public` via the connected wallet (scoped in the bridge manifest's
 *  simulation); mirrors the wallet's own gas-balance-reader. */
async function readPublicFeeJuiceBalance(aztec: unknown, recipient: AztecAddress): Promise<bigint> {
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const fj = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, aztec as never)
	// readBalance unwraps the SDK's SimulationResult { result } + coerces to bigint (cf. useTokenBalance).
	return readBalance(aztec as never, fj, "balance_of_public", recipient)
}

/** Read the account's PRIVATE Fee Juice balance held at the Wonderland PrivateFPC — the remainder a
 *  prior private fuel claim credited (via `mint_and_pay_fee`). The 2.2 MB artifact is lazily imported
 *  from bridge-core's dedicated code-split entry (never the eager `./artifacts` barrel). `balance_of`
 *  is `abi_utility` — scoped in the combined manifest's `simulation.utilities`. */
async function readPrivateFeeJuiceBalance(aztec: unknown, recipient: AztecAddress): Promise<bigint> {
	const { PrivateFPCContractArtifact } = await import("@nulo/bridge-core/private-fpc-artifact")
	const fpc = await Contract.at(AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS), PrivateFPCContractArtifact, aztec as never)
	return readBalance(aztec as never, fpc, "balance_of", recipient)
}

/** Read a Fee Juice balance, mapping a read FAILURE to `null` (≠ a real zero) so the no-fuel fee-source
 *  decision can FAIL CLOSED — never fabricate spendable balance, never a false "no gas" — when a
 *  transient `balance_of` RPC error hides whether the user actually holds gas. */
async function readFeeJuiceOrNull(label: string, read: () => Promise<bigint>): Promise<bigint | null> {
	try {
		return await read()
	} catch (e) {
		log(`${label} balance read failed (fail-closed → null):`, e instanceof Error ? e.message : String(e))
		return null
	}
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
		// Deposit-leg recovery: the leg is chain-recoverable from the recorded depositTxHash alone
		// (every flow persists the hash BEFORE waiting), so a flow that died mid-wait — L1 timeout,
		// closed tab — completes here on Retry instead of stranding a confirmed deposit. Patches the
		// same fields the live flows write post-receipt; depositL2Block stays unset so the engine
		// skips the display countdown and goes straight to the claim-simulate gate (the recovered
		// deposit is old — its message is likely already consumable).
		recoverDepositLeg: async (rec) => {
			const hash = rec.depositTxHash as `0x${string}`
			const receipt = await l1.publicClient.getTransactionReceipt({ hash }).catch(() => null)
			if (!receipt) return "pending"
			if (receipt.status !== "success") {
				throw new Error("The Ethereum deposit transaction reverted - there is nothing to claim. You can discard this record.")
			}
			if (assetKindOf(rec) === "fee-juice") {
				const ev = parseFeeJuiceDeposit(receipt.logs as never)
				const fuel = rec.fuel as NonNullable<DepositJournalRecord["fuel"]>
				updateRecord(rec.id, {
					leafIndex: ev.leafIndex.toString(),
					fuel: { ...fuel, received: ev.amount.toString(), leafIndex: ev.leafIndex.toString() },
				})
				return "recovered"
			}
			// Fueled token deposit (router) carries a BridgeWithFuel event; the plain portal deposit
			// carries the Inbox MessageSent. Try the richer one first.
			const fuelEvents = parseEventLogs({ abi: SWAP_BRIDGE_ROUTER_ABI, eventName: "BridgeWithFuel", logs: receipt.logs })
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
			if (fe?.args?.tokenIndex !== undefined && fe.args.fuelIndex !== undefined && fe.args.fuelAmount !== undefined) {
				const fuel = rec.fuel as NonNullable<DepositJournalRecord["fuel"]>
				updateRecord(rec.id, {
					leafIndex: fe.args.tokenIndex.toString(),
					messageHash: fe.args.tokenKey,
					fuel: {
						...fuel,
						leafIndex: fe.args.fuelIndex.toString(),
						messageHash: fe.args.fuelKey,
						received: fe.args.fuelAmount.toString(),
					},
				})
				return "recovered"
			}
			const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: receipt.logs })
			const event = sent[0] as { args?: { index?: bigint } } | undefined
			if (event?.args?.index === undefined) {
				throw new Error("The confirmed Ethereum transaction has no recognizable deposit event - contact support before retrying.")
			}
			updateRecord(rec.id, { leafIndex: event.args.index.toString() })
			return "recovered"
		},
		claim: async (rec, secretHex, envelope) => {
			const aztec = bridgeWallet.wallet.value
			if (!aztec) throw new Error("Connect your Aztec wallet first.")
			// Fee-juice (Fuel) records claim via a different, no-token-leg path — dispatch to the dedicated
			// builder; the token claim below never runs for them (codex Option C, lessons/phase-3.md).
			if (assetKindOf(rec) === "fee-juice") {
				const latchFuel = (patch: Record<string, unknown>) => {
					const f = rec.fuel
					if (f) updateRecord(rec.id, { fuel: { ...f, ...patch } })
				}
				// V5: pin the claim's maxFeesPerGas to predicted-worst — NO extra padding. BOTH paths now
				// SELF-PAY (public via FeeJuicePaymentMethodWithClaim, private via the embedded FPC): the bridged
				// amount is the whole budget and the setup asserts amount >= gasLimits*maxFeesPerGas with no
				// refund, so any fee headroom inflates max_gas_cost past the bridged amount and reverts "Amount
				// too low to cover gas cost". (The wallet's x1.5 minFeePadding is for refundable txs, not this.)
				// predicted-worst is already a forward-looking ceiling so it still covers base-fee drift through
				// the proving window; a rare spike beyond it fails recoverably (the engine reprices on retry).
				const claimMaxFees = await predictedWorstMinFees(createAztecNodeClient(NODE_URL))
				return buildFuelClaimInteraction(rec, {
					aztec,
					recipient: AztecAddress.fromStringUnsafe(rec.recipient),
					minFloorFj: FUEL_MIN_FJ,
					maxFeesPerGas: { feePerDaGas: claimMaxFees.feePerDaGas, feePerL2Gas: claimMaxFees.feePerL2Gas },
					// Authoritative claim material from the engine: the unsealed `envelope.salt` (private) and
					// the gated top-level secret (public) — never the plaintext journal copy (codex HIGH/LOW).
					resolvedSalt: rec.isPrivate ? envelope?.salt : undefined,
					resolvedSecret: rec.isPrivate ? undefined : secretHex,
					onAttempt: () => latchFuel({ claimAttempt: true, claimAttemptAt: Date.now(), setupInsufficiency: false }),
					onTxHash: (txHash) => latchFuel({ claimAttempt: true, claimAttemptAt: Date.now(), claimTxHash: txHash }),
					onSetupInsufficiency: () => latchFuel({ setupInsufficiency: true }),
				})
			}
			const recipientAddr = AztecAddress.fromStringUnsafe(rec.recipient)
			const amount = BigInt(rec.amount)
			const secret = Fr.fromString(secretHex)
			const leaf = new Fr(BigInt(rec.leafIndex ?? "0"))
			const fpc = await getSponsoredFpcInstance()
			const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
			const bridge = await Contract.at(BRIDGE, tokenBridgeArtifact, aztec as never)
			// A fail-stop {simulate, send} pair that surfaces `why` (used by the private + no-fuel guards).
			const stop = (why: string) => ({
				simulate: async () => {
					throw new Error(why)
				},
				send: async () => {
					throw new Error(why)
				},
			})

			// Fueled records pick their payment via the L14 ladder (record-specific evidence only).
			const fuel = rec.fuel

			// PRIVATE fuel (Option A — codex 019ec69a): a fully SEPARATE path. The fee is ALWAYS the
			// Wonderland PrivateFPC method (feePayer=FPC); recovery retries ONLY that method. It NEVER
			// touches the public sponsored/fjwc/standalone ladder below — the L11 privacy invariant.
			if (rec.isPrivate && fuel?.received && fuel.leafIndex && fuel.bridgeSecretSalt) {
				const fb = fuel
				const fuelReceived = BigInt(fuel.received)
				const fuelLeaf = new Fr(BigInt(fuel.leafIndex))
				const salt = Fr.fromString(fuel.bridgeSecretSalt)
				// L15 kill-switch: the FJ landed at the pinned FPC. A drifted persisted address ⇒ FAIL-STOP
				// (never claim to / trust a version-drifted FPC, never silently downgrade to public).
				if (fb.fpc && fb.fpc !== PRIVATE_FPC_ADDRESS) {
					return stop("Private fuel FPC address mismatch (version drift), refusing to claim. Reselect a mode.")
				}
				// Fail-closed budget: the bridged FJ must clear the calibrated floor (≈2× a real claim fee);
				// below it the mint_and_pay_fee `amount >= max_gas_cost` assert fails anyway.
				if (BRIDGE_FUEL && fuelReceived < BRIDGE_FUEL.minFuelFj) {
					return stop("The bridged gas is below the safe claim floor; the private fuel claim can't self-pay.")
				}
				const fpcAddr = AztecAddress.fromStringUnsafe(fb.fpc ?? PRIVATE_FPC_ADDRESS)
				const receiptStatus = fb.claimTxHash ? await fuelReceiptStatus(fb.claimTxHash) : undefined
				if (receiptStatus === "included" && fb.consumed !== true) {
					updateRecord(rec.id, { fuel: { ...fb, consumed: true } })
				}
				const decision = decidePrivateFuelClaim({
					attempt: fb.claimAttempt === true,
					txHashKnown: typeof fb.claimTxHash === "string",
					receiptStatus,
					consumed: fb.consumed === true || receiptStatus === "included",
					setupInsufficiency: fb.setupInsufficiency === true,
					// Missing timestamp = every pre-fix record ⇒ aged out (their limbo is exactly the bug).
					attemptAgedOut: fb.claimAttemptAt === undefined || Date.now() - fb.claimAttemptAt > PRIVATE_ATTEMPT_STALE_MS,
				})
				log("private fuel claim decision", { id: rec.id, action: decision.action })
				if (decision.action !== "private-fpc") {
					// consumed (FJ burned at the FPC; token-reclaim via the FPC pay_fee is a follow-up) or wait —
					// never re-mint (a second claim double-spends the FJ message), never public.
					return stop(
						decision.action === "consumed"
							? "private fuel already consumed - not re-minting (recover via the FPC balance)"
							: "private fuel claim pending - waiting for its receipt before retrying",
					)
				}
				// teardownGas=0 keeps max_gas_cost within the bridged amount. We pin maxFeesPerGas to the
				// PREDICTED worst-case min fee (not current-min): the FPC asserts amount >= gasLimits*maxFeesPerGas,
				// and the claim lands seconds-to-minutes after it's built, so a current-min cap risks an
				// inclusion-time reject if base fee rises in that window. Predicted-worst bounds the window AND
				// fixes the FPC ceiling so the bridged amount can cover it. Explicit ⇒ the wallet commits it
				// verbatim (no embedded-fpc-cap refetch drift). feePayer=FPC ⇒ FeeJuice.claim + mint_and_pay_fee
				// + claim_private run as one EXTERNAL tx.
				// × 1.5 headroom (matches base_wallet's minFeePadding) so the committed cap survives base-fee drift
				// during the claim's proving window — a static predicted-worst snapshot can fall below the live fee
				// by inclusion time and get rejected. Each journal-driven claim retry rebuilds this (re-prices).
				const claimMaxFees = (await predictedWorstMinFees(createAztecNodeClient(NODE_URL))).mul(1.5)
				const privateFee = {
					paymentMethod: privateMintAndPayFee(fpcAddr, fuelReceived, deriveBridgeSecret(salt, recipientAddr), salt, fuelLeaf),
					gasSettings: {
						teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }),
						maxFeesPerGas: { feePerDaGas: claimMaxFees.feePerDaGas, feePerL2Gas: claimMaxFees.feePerL2Gas },
					},
				}
				const claimPriv = () => bridge.methods.claim_private(recipientAddr, amount, secret, leaf)
				return {
					simulate: () => claimPriv().simulate({ from: recipientAddr, fee: privateFee } as never),
					send: async () => {
						// Latch the attempt JOURNAL-FIRST (before the wallet call), clearing any stale insufficiency.
						updateRecord(rec.id, { fuel: { ...fb, claimAttempt: true, claimAttemptAt: Date.now(), setupInsufficiency: false } })
						try {
							const { receipt } = (await claimPriv().send({
								from: recipientAddr,
								fee: privateFee,
								wait: { waitForStatus: TxStatus.PROPOSED },
							} as never)) as { receipt: { txHash: unknown } }
							const txHash = String(receipt.txHash)
							// PROPOSED is NOT inclusion; `consumed` is set inclusion-grade later from the receipt probe.
							updateRecord(rec.id, {
								fuel: {
									...fb,
									claimAttempt: true,
									claimAttemptAt: Date.now(),
									claimTxHash: txHash,
									setupInsufficiency: false,
								},
							})
							return { txHash }
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e)
							// A setup-insufficiency throw ⇒ the tx was INVALID (FJ unconsumed) ⇒ authorise a retry.
							// Any OTHER throw leaves setupInsufficiency unset ⇒ the next decision WAITS (fail-closed).
							// NEVER fall back to public/Sponsored on the private path (L11).
							if (isPrivateFuelInsufficiency(msg)) {
								updateRecord(rec.id, {
									fuel: { ...fb, claimAttempt: true, claimAttemptAt: Date.now(), setupInsufficiency: true },
								})
							}
							throw e
						}
					},
				}
			}

			let fee: { paymentMethod: unknown; gasSettings?: unknown } | undefined = sponsored
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
			} else {
				// NO-fuel: the bridge claim has no fresh FJ message to consume, so it self-pays from gas the
				// account ALREADY holds. The faucet does NOT pre-select a method - it omits the fee and lets
				// the WALLET's fee picker choose Public OR Private Fee Juice (or Sponsored), exactly as the
				// public path always has. We only UNBLOCK when there is gas in either balance; private FJ at
				// the PrivateFPC now counts (selectable via pay_fee). Reads are fail-closed (null = unread).
				const [pub, priv] = await Promise.all([
					readFeeJuiceOrNull("public FJ", () => readPublicFeeJuiceBalance(aztec, recipientAddr)),
					readFeeJuiceOrNull("private FJ", () => readPrivateFeeJuiceBalance(aztec, recipientAddr)),
				])
				const gate = decideNoFuelClaimGate({ publicFeeJuice: pub, privateFeeJuice: priv })
				log("no-fuel claim gate", { id: rec.id, gate, pub: fmtFj(pub), priv: fmtFj(priv) })
				if (gate === "unverifiable") return stop("Couldn't check your Fee Juice balance - please try again in a moment.")
				if (gate === "none")
					return stop('No gas (Fee Juice) to claim this no-fuel bridge. Enable "arrive with gas", or fund your account first.')
				fee = undefined // "allow": the wallet's fee picker selects the method (Public/Private FJ or Sponsored).
			}

			const interaction = () =>
				rec.isPrivate
					? bridge.methods.claim_private(recipientAddr, amount, secret, leaf)
					: bridge.methods.claim_public(recipientAddr, amount, secret, leaf)
			return {
				simulate: () => interaction().simulate({ from: recipientAddr, ...(fee ? { fee } : {}) } as never),
				send: async () => {
					// L14 trigger-1 precondition: latch the attempt JOURNAL-FIRST, before the wallet call.
					if (fjwcAttempt && fuel) updateRecord(rec.id, { fuel: { ...fuel, claimAttempt: true, claimAttemptAt: Date.now() } })
					const { receipt } = (await interaction().send({
						from: recipientAddr,
						...(fee ? { fee } : {}),
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
	ensureDepositJournalDeps()
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
					tokenWeth: BRIDGE_FUEL.pools.azloWeth,
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
					// PRIVATE: recipient is committed via tokenSecretHash, NOT published — the router ignores it on
					// the private path but EMITS it indexed, so a real value here leaks R. Zero it for private.
					aztecRecipient: (isPrivate ? `0x${"0".repeat(64)}` : recipient) as `0x${string}`,
					// PRIVATE fuel lands at the PrivateFPC (claimer-bound by the secret); PUBLIC fuel at the user.
					// A bug here either leaks (user addr on L1) or strands (FJ to a non-FPC) — the headline invariant.
					fuelRecipient: (isPrivate ? PRIVATE_FPC_ADDRESS : recipient) as `0x${string}`,
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
			// No approve tx — the live token pre-approves canonical Permit2 (asserted, fail-closed). The
			// witness pins tokenPortal/token/amount/recipient/secretHash/isPrivate + the router's swapTarget.
			if (!BRIDGE_ROUTER || !BRIDGE_PERMIT2 || !BRIDGE_SWAP_TARGET) {
				throw new Error("Bridge router/permit2 not configured (required for the deposit path).")
			}
			const permit2Allowance = (await l1.publicClient.readContract({
				address: L1_USDC,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [from, BRIDGE_PERMIT2],
			})) as bigint
			if (permit2Allowance < tokenAmount) {
				throw new Error("This token does not pre-approve Permit2 - bridging is unavailable for it.")
			}

			setRecordStep(id, "signing", "sign the bridge intent in your Ethereum wallet - one signature")
			const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
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
