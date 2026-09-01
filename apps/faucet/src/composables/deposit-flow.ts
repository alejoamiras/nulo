/**
 * Deposit-flow protocol operations, extracted from useDeposit.ts as independently testable
 * module functions. State stays OWNED by the composable layer: `sealKeys`, the fuel-override
 * set, and the wallet singletons are passed in explicitly — this module holds no mutable
 * module state of its own. Behavior is pinned by useDeposit.characterization.test.ts; every
 * transform here is a verbatim transcription.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { Gas } from "@aztec/stdlib/gas"
import {
	type DepositJournalRecord,
	SWAP_BRIDGE_ROUTER_ABI,
	assetKindOf,
	deriveBridgeSecret,
	feeJuiceAddress,
	parseFeeJuiceDeposit,
	predictedWorstMinFees,
	PRIVATE_FPC_ADDRESS,
	privateMintAndPayFee,
	publicFeeJuicePayment,
} from "@nulo/bridge-core"
import { tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { InboxAbi } from "@aztec/l1-artifacts"
import { type Log, parseEventLogs } from "viem"
import { NETWORK } from "@/lib/network"
import { BRIDGE, BRIDGE_FUEL, FUEL_MIN_FJ } from "@/contracts/bridge-deployments"
import {
	FUEL_FEE_MARGIN,
	PRIVATE_ATTEMPT_STALE_MS,
	RECEIPT_RECORD_MISMATCH_MSG,
	decideFuelClaim,
	decideFuelLadder,
	decideNoFuelClaimGate,
	decidePrivateFuelClaim,
	isPrivateFuelInsufficiency,
} from "@/lib/fuel-claim-state"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { isMsgConsumed, updateRecord } from "./useBridgeJournal"
import { buildFuelClaimInteraction } from "./fuelClaim"
import { readBalance } from "./useTokenBalance"
import { withOperation } from "./useOpsInFlight"

// Verbose tracing while the bridge flows are being hardened - ids, stages, tx hashes ONLY.
const log = (...args: unknown[]) => console.log("[bridge:deposit]", ...args)

const NODE_URL = NETWORK.nodeUrl

/** Human Fee Juice (18 decimals) for user-facing balance/shortfall messages; `null` = unread. */
const fmtFj = (x: bigint | null): string => (x === null ? "?" : `${(Number(x) / 1e18).toFixed(3)} FJ`)

/** A claim-side simulate/send pair — the journal engine's interaction contract. */
export interface ClaimInteraction {
	simulate: () => Promise<unknown>
	send: () => Promise<{ txHash: string }>
}

/** A fail-stop {simulate, send} pair that surfaces `why` (used by the private + no-fuel guards).
 *  `sendWhy` preserves the historical wait-stop shape, whose send threw a shorter message. */
export function failStopInteraction(why: string, sendWhy: string = why): ClaimInteraction {
	return {
		simulate: async () => {
			throw new Error(why)
		},
		send: async () => {
			throw new Error(sendWhy)
		},
	}
}

/** The router's BridgeWithFuel event args, or undefined when the receipt carries none. */
export function parseBridgeWithFuelEvent(logs: Log[]):
	| {
			tokenKey?: `0x${string}`
			tokenIndex?: bigint
			fuelKey?: `0x${string}`
			fuelIndex?: bigint
			fuelAmount?: bigint
	  }
	| undefined {
	const events = parseEventLogs({ abi: SWAP_BRIDGE_ROUTER_ABI, eventName: "BridgeWithFuel", logs })
	const fe = events[0] as
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
	return fe?.args
}

/** L2 height snapshot, best-effort: a dead node just means the gate narrates without the countdown. */
export async function bestEffortL2Block(): Promise<number | undefined> {
	try {
		return Number(await createAztecNodeClient(NODE_URL).getBlockNumber())
	} catch {
		return undefined
	}
}

export async function fuelReceiptStatus(txHash: string): Promise<"included" | "dropped" | "pending"> {
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
export async function waitForFuelInclusion(txHash: string, tries = 40): Promise<"included" | "dropped" | "pending"> {
	for (let i = 0; i < tries; i++) {
		const s = await fuelReceiptStatus(txHash)
		if (s !== "pending") return s
		await new Promise((r) => setTimeout(r, 6000))
	}
	return "pending"
}

/** Claim a fueled deposit's Fee Juice as a standalone, sponsored tx, INCLUSION-GATED. The FJ
 *  message is recipient-bound, so this is safe whenever fuel isn't known-consumed; an
 *  already-consumed message reverts but still reads INCLUDED (its nullifier exists), which settles
 *  it just the same. `standaloneClaimed` latches ONLY after inclusion - a dropped/timed-out tx
 *  leaves it unset so the card re-offers the action (closes the PROPOSED-latch false-negative). */
export async function sendStandaloneFjClaim(
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

/** Read the account's PUBLIC Fee Juice balance — the cold-account detector for no-fuel claims. Uses the
 *  FeeJuice contract's `balance_of_public` via the connected wallet (scoped in the bridge manifest's
 *  simulation); mirrors the wallet's own gas-balance-reader. */
export async function readPublicFeeJuiceBalance(aztec: unknown, recipient: AztecAddress): Promise<bigint> {
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const fj = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, aztec as never)
	// readBalance unwraps the SDK's SimulationResult { result } + coerces to bigint (cf. useTokenBalance).
	return readBalance(aztec as never, fj, "balance_of_public", recipient)
}

/** Read the account's PRIVATE Fee Juice balance held at the Wonderland PrivateFPC — the remainder a
 *  prior private fuel claim credited (via `mint_and_pay_fee`). The 2.2 MB artifact is lazily imported
 *  from bridge-core's dedicated code-split entry (never the eager `./artifacts` barrel). `balance_of`
 *  is `abi_utility` — scoped in the combined manifest's `simulation.utilities`. */
export async function readPrivateFeeJuiceBalance(aztec: unknown, recipient: AztecAddress): Promise<bigint> {
	const { PrivateFPCContractArtifact } = await import("@nulo/bridge-core/private-fpc-artifact")
	const fpc = await Contract.at(AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS), PrivateFPCContractArtifact, aztec as never)
	return readBalance(aztec as never, fpc, "balance_of", recipient)
}

/** Read a Fee Juice balance, mapping a read FAILURE to `null` (≠ a real zero) so the no-fuel fee-source
 *  decision can FAIL CLOSED — never fabricate spendable balance, never a false "no gas" — when a
 *  transient `balance_of` RPC error hides whether the user actually holds gas. */
export async function readFeeJuiceOrNull(label: string, read: () => Promise<bigint>): Promise<bigint | null> {
	try {
		return await read()
	} catch (e) {
		log(`${label} balance read failed (fail-closed → null):`, e instanceof Error ? e.message : String(e))
		return null
	}
}

// ── deposit-leg recovery ─────────────────────────────────────────────────────

/** A viem public client with the two receipt reads the recovery needs. */
export interface RecoveryL1Client {
	getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: string; logs: unknown[] } | null>
}

/**
 * Deposit-leg recovery: the leg is chain-recoverable from the recorded depositTxHash alone
 * (every flow persists the hash BEFORE waiting), so a flow that died mid-wait — L1 timeout,
 * closed tab — completes here on Retry instead of stranding a confirmed deposit. Patches the
 * same fields the live flows write post-receipt; depositL2Block stays unset so the engine
 * skips the display countdown and goes straight to the claim-simulate gate (the recovered
 * deposit is old — its message is likely already consumable).
 */
export async function recoverDepositLeg(rec: DepositJournalRecord, publicClient: RecoveryL1Client): Promise<"pending" | "recovered"> {
	const hash = rec.depositTxHash as `0x${string}`
	const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null)
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
	const fe = parseBridgeWithFuelEvent(receipt.logs as Log[])
	if (fe?.tokenIndex !== undefined && fe.fuelIndex !== undefined && fe.fuelAmount !== undefined) {
		const fuel = rec.fuel as NonNullable<DepositJournalRecord["fuel"]>
		updateRecord(rec.id, {
			leafIndex: fe.tokenIndex.toString(),
			messageHash: fe.tokenKey,
			fuel: {
				...fuel,
				leafIndex: fe.fuelIndex.toString(),
				messageHash: fe.fuelKey,
				received: fe.fuelAmount.toString(),
			},
		})
		return "recovered"
	}
	// A schema-2 record's deposit went through the router, so its receipt MUST carry
	// BridgeWithFuel. Falling back to the plain-portal event here would report "recovered"
	// while leaving the fuel fields absent forever — re-probed on every private retry, and
	// silently continued past on public ones. Only fail closed when we actually came looking
	// for fuel data: a schema-2 record that already has it is just recovering its token leaf.
	if (rec.schema === 2 && (!rec.fuel?.received || !rec.fuel?.leafIndex)) {
		throw new Error(
			`This bridge's Ethereum ${RECEIPT_RECORD_MISMATCH_MSG} - its gas details can't be recovered from the chain. Restore it from its backup file.`,
		)
	}
	const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: receipt.logs as Log[] })
	const event = sent[0] as { args?: { index?: bigint } } | undefined
	if (event?.args?.index === undefined) {
		throw new Error("The confirmed Ethereum transaction has no recognizable deposit event - contact support before retrying.")
	}
	updateRecord(rec.id, { leafIndex: event.args.index.toString() })
	return "recovered"
}

// ── claim builders (the journal engine's claim dep, decomposed) ──────────────

/** Fee-juice (Fuel) records claim via a different, no-token-leg path — the dedicated builder;
 *  the token claim never runs for them (codex Option C, lessons/phase-3.md). */
export async function buildFeeJuiceClaimDep(
	rec: DepositJournalRecord,
	secretHex: string,
	envelope: { salt?: string } | undefined,
	aztec: unknown,
): Promise<ClaimInteraction> {
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
		onTxHash: (txHash: string) => latchFuel({ claimAttempt: true, claimAttemptAt: Date.now(), claimTxHash: txHash }),
		onSetupInsufficiency: () => latchFuel({ setupInsufficiency: true }),
	}) as unknown as ClaimInteraction
}

/** The claim material the token-claim builders share. */
export interface TokenClaimCtx {
	rec: DepositJournalRecord
	bridge: {
		methods: Record<
			string,
			(...args: unknown[]) => { simulate: (o: unknown) => Promise<unknown>; send: (o: unknown) => Promise<unknown> }
		>
	}
	recipientAddr: AztecAddress
	amount: bigint
	secret: Fr
	leaf: Fr
}

/**
 * PRIVATE fuel (Option A — codex 019ec69a): a fully SEPARATE path. The fee is ALWAYS the
 * Wonderland PrivateFPC method (feePayer=FPC); recovery retries ONLY that method. It NEVER
 * touches the public sponsored/fjwc/standalone ladder — the L11 privacy invariant.
 * Returns null when the record is not on the private-fuel path at all.
 */
export async function buildPrivateFuelClaim(ctx: TokenClaimCtx): Promise<ClaimInteraction | null> {
	const { rec, bridge, recipientAddr, amount, secret, leaf } = ctx
	const fuel = rec.fuel
	const incomplete = privateIncompleteStop(rec, fuel)
	if (incomplete) return incomplete
	if (!(rec.isPrivate && fuel?.received && fuel.leafIndex && fuel.bridgeSecretSalt)) return null
	const fb = fuel
	const fuelReceived = BigInt(fuel.received)
	const fuelLeaf = new Fr(BigInt(fuel.leafIndex))
	const salt = Fr.fromString(fuel.bridgeSecretSalt)
	const unsafe = privateFuelSafetyStop(fb, fuelReceived)
	if (unsafe) return unsafe
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
		return failStopInteraction(
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
		send: () => sendPrivateFuelClaim(rec, fb, claimPriv, recipientAddr, privateFee),
	}
}

/** L11 structural fence: a private FUELED record reaches the private ladder or stops here. It
 *  must never fall through to the public/sponsored ladder — that claims the FJ in a
 *  publicly-visible tx and deanonymizes the bridge. Incomplete metadata (legacy, partially
 *  restored, tampered) is exactly the fall-through that used to happen silently. */
function privateIncompleteStop(rec: DepositJournalRecord, fuel: DepositJournalRecord["fuel"]): ClaimInteraction | null {
	if (decideFuelLadder({ isPrivate: rec.isPrivate, schema: rec.schema, fuel }) !== "private-incomplete") return null
	// Only advertise a retry where one can actually do something: the engine's receipt
	// rehydration needs a depositTxHash, and only the event-derived fields come back that
	// way. The client-random salt exists nowhere but a backup file.
	const retryable = !!fuel?.bridgeSecretSalt && !!rec.depositTxHash
	return failStopInteraction(
		retryable
			? "This private bridge's gas details couldn't be read from Ethereum yet - retry in a minute. The public gas recovery is deliberately unavailable for private bridges."
			: "This private bridge is missing the data needed to claim its gas privately (an older or partially restored record). Only its backup file can restore that - the public gas recovery is deliberately unavailable for private bridges.",
	)
}

/** L15 kill-switch (drifted FPC address => never claim to / trust it, never downgrade to public)
 *  plus the fail-closed budget floor (below it the mint_and_pay_fee assert fails anyway). */
function privateFuelSafetyStop(fb: NonNullable<DepositJournalRecord["fuel"]>, fuelReceived: bigint): ClaimInteraction | null {
	if (fb.fpc && fb.fpc !== PRIVATE_FPC_ADDRESS) {
		return failStopInteraction("Private fuel FPC address mismatch (version drift), refusing to claim. Reselect a mode.")
	}
	if (BRIDGE_FUEL && fuelReceived < BRIDGE_FUEL.minFuelFj) {
		return failStopInteraction("The bridged gas is below the safe claim floor; the private fuel claim can't self-pay.")
	}
	return null
}

/** The private claim's send leg: JOURNAL-FIRST latch, PROPOSED-only hash write, and the
 *  insufficiency-gated retry authorisation. */
async function sendPrivateFuelClaim(
	rec: DepositJournalRecord,
	fb: NonNullable<DepositJournalRecord["fuel"]>,
	claimPriv: () => { send: (o: unknown) => Promise<unknown> },
	recipientAddr: AztecAddress,
	privateFee: unknown,
): Promise<{ txHash: string }> {
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
}

/** The public claim's fee resolution, as a strict discriminated result — impossible
 *  combinations (a stop with a fee, standalone with fjwc) cannot be constructed. */
export type PublicClaimFee =
	| { kind: "stop"; why: string; sendWhy?: string }
	| { kind: "no-fuel" }
	| { kind: "fjwc"; fee: { paymentMethod: unknown } }
	| { kind: "sponsored" }
	| { kind: "sponsored-standalone" }

/** The NO-fuel gate: the bridge claim has no fresh FJ message to consume, so it self-pays from gas
 *  the account ALREADY holds. The faucet does NOT pre-select a method - it omits the fee and lets
 *  the WALLET's fee picker choose Public OR Private Fee Juice (or Sponsored), exactly as the
 *  public path always has. We only UNBLOCK when there is gas in either balance; private FJ at
 *  the PrivateFPC counts (selectable via pay_fee). Reads are fail-closed (null = unread). */
export async function gateNoFuelClaim(rec: DepositJournalRecord, recipientAddr: AztecAddress, aztec: unknown): Promise<PublicClaimFee> {
	const [pub, priv] = await Promise.all([
		readFeeJuiceOrNull("public FJ", () => readPublicFeeJuiceBalance(aztec, recipientAddr)),
		readFeeJuiceOrNull("private FJ", () => readPrivateFeeJuiceBalance(aztec, recipientAddr)),
	])
	const gate = decideNoFuelClaimGate({ publicFeeJuice: pub, privateFeeJuice: priv })
	log("no-fuel claim gate", { id: rec.id, gate, pub: fmtFj(pub), priv: fmtFj(priv) })
	if (gate === "unverifiable") return { kind: "stop", why: "Couldn't check your Fee Juice balance - please try again in a moment." }
	if (gate === "none")
		return {
			kind: "stop",
			why: 'No gas (Fee Juice) to claim this no-fuel bridge. Enable "arrive with gas", or fund your account first.',
		}
	return { kind: "no-fuel" } // "allow": the wallet's fee picker selects the method (Public/Private FJ or Sponsored).
}

/** Fueled records pick their payment via the L14 ladder (record-specific evidence only). */
export async function resolvePublicClaimFee(
	rec: DepositJournalRecord,
	recipientAddr: AztecAddress,
	aztec: unknown,
	userOverride: boolean,
): Promise<PublicClaimFee> {
	const fuel = rec.fuel
	if (!(fuel?.received && fuel.leafIndex)) return gateNoFuelClaim(rec, recipientAddr, aztec)
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
		userOverride,
	})
	log("fuel claim decision", { id: rec.id, action: decision.action })
	if (decision.action === "fjwc") {
		return {
			kind: "fjwc",
			fee: {
				paymentMethod: publicFeeJuicePayment(recipientAddr, {
					claimAmount: BigInt(fuel.received),
					claimSecret: Fr.fromString(fuel.secret),
					messageLeafIndex: BigInt(fuel.leafIndex),
				}),
			},
		}
	}
	if (decision.action === "sponsored-plus-standalone-fj") return { kind: "sponsored-standalone" }
	if (decision.action === "wait") {
		// The historical wait stop threw a SHORTER message from send than from simulate — preserved.
		return {
			kind: "stop",
			why: "fuel claim attempt pending - waiting for its receipt before retrying",
			sendWhy: "fuel claim attempt pending",
		}
	}
	// "sponsored" (user override, or a consumed prior attempt): the plain sponsored default, no flags.
	return { kind: "sponsored" }
}

/** The final token-claim interaction: sponsored default, fjwc fee, or the wallet picker
 *  (no-fuel). Latch ordering and the standalone fire-and-forget are verbatim. */
export function buildTokenClaimInteraction(
	ctx: TokenClaimCtx,
	resolved: PublicClaimFee,
	sponsoredFee: { paymentMethod: unknown },
	aztec: unknown,
): ClaimInteraction {
	const { rec, bridge, recipientAddr, amount, secret, leaf } = ctx
	const fuel = rec.fuel
	const fee: { paymentMethod: unknown } | undefined =
		resolved.kind === "fjwc" ? resolved.fee : resolved.kind === "no-fuel" ? undefined : sponsoredFee
	const fjwcAttempt = resolved.kind === "fjwc"
	const standaloneFj = resolved.kind === "sponsored-standalone"
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
				void withOperation(() => sendStandaloneFjClaim(aztec, recipientAddr, fuel, rec.id)).catch((e) =>
					log("standalone FJ claim failed (recoverable via CLAIM YOUR GAS):", e instanceof Error ? e.message : String(e)),
				)
			}
			return { txHash }
		},
	}
}

/** The journal engine's whole claim dep: fee-juice dispatch, then the private-fuel ladder,
 *  then the public fee resolution feeding the token claim. */
export async function buildClaimInteraction(
	rec: DepositJournalRecord,
	secretHex: string,
	envelope: { salt?: string } | undefined,
	aztec: unknown,
	userOverride: boolean,
): Promise<ClaimInteraction> {
	if (assetKindOf(rec) === "fee-juice") return buildFeeJuiceClaimDep(rec, secretHex, envelope, aztec)
	const recipientAddr = AztecAddress.fromStringUnsafe(rec.recipient)
	const amount = BigInt(rec.amount)
	const secret = Fr.fromString(secretHex)
	const leaf = new Fr(BigInt(rec.leafIndex ?? "0"))
	const fpc = await getSponsoredFpcInstance()
	const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const bridge = (await Contract.at(BRIDGE as never, tokenBridgeArtifact, aztec as never)) as TokenClaimCtx["bridge"]
	const ctx: TokenClaimCtx = { rec, bridge, recipientAddr, amount, secret, leaf }

	const privateClaim = await buildPrivateFuelClaim(ctx)
	if (privateClaim) return privateClaim

	const resolved = await resolvePublicClaimFee(rec, recipientAddr, aztec, userOverride)
	if (resolved.kind === "stop") return failStopInteraction(resolved.why, resolved.sendWhy)
	return buildTokenClaimInteraction(ctx, resolved, sponsored, aztec)
}
