/**
 * The Fuel claim builder — the fee-juice branch the journal's `claim` dep dispatches to by
 * `assetKind` (codex Option C, lessons/phase-3.md). NON-composable: imports only bridge-core / the
 * Aztec SDK / the pure `fuel-claim-state` lib, and takes the wallet + sponsored-FPC + floor as
 * ARGUMENTS — never a faucet singleton — so `useDeposit → fuelClaim → bridge-core` stays acyclic.
 *
 * PUBLIC: the carrier-less self-pay tx — `new BatchCall(wallet, [])` (no app call) paid by
 * `publicFeeJuicePayment` (`FeeJuicePaymentMethodWithClaim` → `claim_and_end_setup` as setup); it claims
 * the bridged FJ and pays this tx's fee from it (NOT the Sponsored FPC — absent on mainnet, owner call).
 * PRIVATE: the carrier-less embedded-FPC tx — `new BatchCall(wallet, [])` (no app call) paid by
 * `privateMintAndPayFee`, which runs `FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee` as setup and
 * credits `(amount − max_gas_cost)` to the claimer. BOTH paths are now zero-app-call — the live
 * sequencer's acceptance of that is the deferred risk I2, provable only on a live network (plan §5 DQ1).
 *
 * A direct Fuel record carries its FJ claim material in the `fuel` block (assetKind "fee-juice",
 * lessons/phase-3.md): `received` (the FJ), `secret` (public), `bridgeSecretSalt`/`fpc` (private),
 * `leafIndex`. There is NO token leg — this builds ONLY the fee-juice claim.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { BatchCall, toSimulateOptions } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { Gas } from "@aztec/stdlib/gas"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import {
	PRIVATE_FPC_ADDRESS,
	assertFuelClearsFloor,
	deriveBridgeSecret,
	privateMintAndPayFee,
	publicFeeJuicePayment,
} from "@nulo/bridge-core"
import { isPrivateFuelInsufficiency } from "@/lib/fuel-claim-state"

export interface FuelClaimInteraction {
	simulate: () => Promise<unknown>
	send: () => Promise<{ txHash: string }>
}

export interface FuelClaimDeps {
	/** The connected Aztec wallet. */
	aztec: unknown
	recipient: AztecAddress
	/** The fail-CLOSED self-pay floor (FUEL_MIN_FJ). Undefined/zero ⇒ the claim refuses (BOTH paths). */
	minFloorFj: bigint | undefined
	/** V5: the worst-case maxFeesPerGas (predictedWorstMinFees, NO padding), computed by the caller (which
	 *  owns the node). This is a SELF-PAY claim — the bridged amount is the whole budget and the FPC asserts
	 *  amount >= gasLimits*maxFeesPerGas with no refund, so any fee padding inflates max_gas_cost past the
	 *  amount ("Amount too low to cover gas cost"). predicted-worst already covers base-fee drift. Absent ⇒
	 *  the wallet fills current-min (pre-V5 behavior). BOTH public + private now self-pay. */
	maxFeesPerGas?: { feePerDaGas: bigint; feePerL2Gas: bigint }
	/** PRIVATE: the AUTHORITATIVE salt the engine unsealed from the envelope (the sole recovery input).
	 *  Used in preference to the journal's plaintext `fuel.bridgeSecretSalt` display copy, which can be
	 *  missing or corrupted while the sealed copy is intact — trusting it would strand a recoverable
	 *  deposit (codex post-impl HIGH). The plaintext is a fallback only (legacy records with no salt seal). */
	resolvedSalt?: string
	/** PUBLIC: the AUTHORITATIVE claim secret the engine gated on (top-level `rec.secret`). Used in
	 *  preference to `fuel.secret` so the gate and the claim never read different copies (codex LOW). */
	resolvedSecret?: string
	/** Journal-latch callbacks (the wrapper supplies these; this module stays journal-agnostic). */
	onAttempt?: () => void
	onTxHash?: (txHash: string) => void
	onSetupInsufficiency?: () => void
}

/** A fail-stop {simulate, send} pair that surfaces `why` (a guard refused before any wallet call). */
const stop = (why: string): FuelClaimInteraction => ({
	simulate: async () => {
		throw new Error(why)
	},
	send: async () => {
		throw new Error(why)
	},
})

/** Gas LIMITS for the carrier-less self-pay claim: the empty BatchCall([]) gives the estimator nothing, so
 *  gasLimits MUST be explicit (else it defaults to the per-tx MAX and max_gas_cost blows past the bridged
 *  amount). The protocol asserts the claimed balance clears getFeeLimit() = Σ gasLimit[d]*maxFee[d], so these
 *  ALSO drive {@link clearsFeeLimit}. PUBLIC is CALIBRATED from the live fee-juice-canary (a landed
 *  claim_and_end_setup billed l2Gas 659_123 / daGas 224 → a ~2.3x margin); it sits far below the private
 *  2-call limit so an oversized limit can't shrink the fee-spike headroom under the FUEL_MIN_FJ floor (a 2x
 *  spike at 4M would graze the 16e18 floor — codex). PRIVATE covers FeeJuice.claim + mint_and_pay_fee. */
const PUBLIC_CLAIM_GAS = { daGas: 3_000, l2Gas: 1_500_000 } as const
const PRIVATE_CLAIM_GAS = { daGas: 100_000, l2Gas: 4_000_000 } as const

/** Fail-CLOSED on the ACTUAL fee LIMIT: the protocol reverts the setup claim when the claimed balance can't
 *  cover getFeeLimit() (Σ gasLimit[d]*maxFee[d]) — the LIMIT, not the actual charge — so a bridge that clears
 *  the static FUEL_MIN_FJ floor can still fail once fees spike (codex). Returns true (skip) only when the
 *  caller passes no predicted fees (pre-V5 fallback), where the floor is the sole guard. */
function clearsFeeLimit(
	received: bigint,
	gas: { daGas: number; l2Gas: number },
	maxFees?: { feePerDaGas: bigint; feePerL2Gas: bigint },
): boolean {
	if (!maxFees) return true
	return received >= BigInt(gas.l2Gas) * maxFees.feePerL2Gas + BigInt(gas.daGas) * maxFees.feePerDaGas
}

/** Build the {simulate, send} for a direct Fee-Juice claim. Guards fail CLOSED (return a `stop`). */
export async function buildFuelClaimInteraction(rec: DepositJournalRecord, deps: FuelClaimDeps): Promise<FuelClaimInteraction> {
	const fuel = rec.fuel
	if (!fuel?.received || !fuel.leafIndex) return stop("This Fuel bridge has no claimable Fee Juice.")
	const { aztec, recipient } = deps
	const received = BigInt(fuel.received)
	const leaf = new Fr(BigInt(fuel.leafIndex))
	// Simulate the FULLY BUILT payload: request() merges the fee's claim setup into the tx, whereas
	// BatchCall([]).simulate() IGNORES options.fee for an empty batch (SDK batch_call.ts) and no-ops. That
	// no-op would make the caller's message-availability gate AND its recordMessageConsumed probe silently
	// pass, so a claim could send before the L1→L2 message anchors and a consumed message could look
	// claimable forever (codex). simulateTx runs the SAME l1_to_l2_message check send does, so it throws the
	// isMsgNotReady / isMsgConsumed shapes those consumers key off. Used by BOTH self-pay branches.
	// toSimulateOptions carries the claim's EXPLICIT gasSettings into the wallet call — without it the
	// wallet simulates with estimation defaults (max limits + padded fees), which mismatches send and can
	// spuriously fail the self-pay budget check (codex round 3). Mirrors BatchCall.simulate's own
	// non-empty-batch path: [request payload, toSimulateOptions(interaction options)].
	const simulateViaPayload = async (fee: { paymentMethod: unknown }): Promise<unknown> => {
		const payload = await new BatchCall(aztec as never, []).request({ fee: { paymentMethod: fee.paymentMethod } } as never)
		return await (aztec as { simulateTx: (p: unknown, o: unknown) => Promise<unknown> }).simulateTx(
			payload,
			toSimulateOptions({ from: recipient, fee } as never),
		)
	}

	if (rec.isPrivate) {
		// Fail-CLOSED floor: the bridged FJ must cover its own claim, or mint_and_pay_fee reverts post-mint.
		try {
			assertFuelClearsFloor(received, deps.minFloorFj)
		} catch (e) {
			return stop(e instanceof Error ? e.message : "The bridged gas is below the safe claim floor.")
		}
		if (!clearsFeeLimit(received, PRIVATE_CLAIM_GAS, deps.maxFeesPerGas)) {
			return stop("The bridged gas can't cover this claim's fee limit right now (fees spiked). Try again shortly.")
		}
		// FPC version-drift kill-switch — never claim to a drifted FPC, never downgrade to public (L11/L15).
		if (fuel.fpc && fuel.fpc !== PRIVATE_FPC_ADDRESS) {
			return stop("Private fuel FPC address mismatch (version drift), refusing to claim. Reselect a mode.")
		}
		// Authoritative-first: the engine-unsealed salt wins over the plaintext journal copy (which can be
		// missing/corrupted while the seal is intact). Plaintext is a fallback only (no-envelope legacy).
		const saltHex = deps.resolvedSalt ?? fuel.bridgeSecretSalt
		if (!saltHex) return stop("This private Fuel bridge is missing its recovery salt, cannot claim.")
		const salt = Fr.fromString(saltHex)
		const fpcAddr = AztecAddress.fromStringUnsafe(fuel.fpc ?? PRIVATE_FPC_ADDRESS)
		// teardownGas=0 keeps max_gas_cost within the bridged amount. maxFeesPerGas is the caller's
		// predicted-worst snapshot (NO padding) — a self-pay claim spends the bridged amount as its whole
		// budget, so any padding inflates max_gas_cost past it and the FPC reverts "Amount too low to cover
		// gas cost". predicted-worst still covers base-fee drift; a rare overshoot fails recoverably (retry).
		const privateFee = {
			paymentMethod: privateMintAndPayFee(fpcAddr, received, deriveBridgeSecret(salt, recipient), salt, leaf),
			gasSettings: {
				// EXPLICIT gasLimits is REQUIRED for the carrier-less claim. The empty BatchCall([]) gives the
				// wallet's gas estimator nothing to estimate, so it defaults gasLimits to the network per-tx
				// MAX (txsLimits.gas ≈ 6.5M L2 on V5). applyEmbeddedFpcGasCap then caps maxFeesPerGas but NOT
				// gasLimits, so max_gas_cost = MAX_gasLimits × fee (≈23 FJ) and no realistic bridge self-pays
				// it ("Amount too low to cover gas cost"). The wallet honors a dApp-supplied gasLimits
				// (suggestGasLimits), so size it to the 2-call setup ({@link PRIVATE_CLAIM_GAS}). The fee is
				// billed on ACTUAL gas, not the limit, so a generous limit does not overpay — but it IS the
				// balance-check bound (getFeeLimit), so {@link clearsFeeLimit} above fail-closes on it.
				gasLimits: Gas.from(PRIVATE_CLAIM_GAS),
				teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }),
				...(deps.maxFeesPerGas ? { maxFeesPerGas: deps.maxFeesPerGas } : {}),
			},
		}
		const carrier = () => new BatchCall(aztec as never, [])
		return {
			simulate: () => simulateViaPayload(privateFee),
			send: async () => {
				deps.onAttempt?.()
				try {
					const { receipt } = (await carrier().send({
						from: recipient,
						fee: privateFee,
						wait: { waitForStatus: TxStatus.PROPOSED },
					} as never)) as { receipt: { txHash: unknown } }
					const txHash = String(receipt.txHash)
					deps.onTxHash?.(txHash)
					return { txHash }
				} catch (e) {
					// A setup-insufficiency throw ⇒ the tx was INVALID (FJ unconsumed) ⇒ authorise a retry.
					// Never fall back to public/Sponsored on the private path (L11).
					if (isPrivateFuelInsufficiency(e instanceof Error ? e.message : String(e))) deps.onSetupInsufficiency?.()
					throw e
				}
			},
		}
	}

	// PUBLIC: SELF-PAY — claim the bridged Fee Juice and pay THIS tx's own fee from it in ONE tx
	// (`FeeJuicePaymentMethodWithClaim` → `claim_and_end_setup` in the setup phase). Deliberately NOT the
	// Sponsored FPC (owner call 2026-07-21): the sponsor does not exist on mainnet, and masking a real
	// self-pay failure behind it would HIDE the bug instead of surfacing it. Fuel-only has no app call, so
	// like the private path this is a CARRIER-LESS zero-app-call tx (`BatchCall([])`) — the mechanism the
	// private path already proves live; the public self-pay is proven by fee-juice-canary-testnet.ts.
	// Fail-CLOSED floor: the bridged FJ must cover its own claim or claim_and_end_setup reverts post-claim.
	try {
		assertFuelClearsFloor(received, deps.minFloorFj)
	} catch (e) {
		return stop(e instanceof Error ? e.message : "The bridged gas is below the safe claim floor.")
	}
	if (!clearsFeeLimit(received, PUBLIC_CLAIM_GAS, deps.maxFeesPerGas)) {
		return stop("The bridged gas can't cover this claim's fee limit right now (fees spiked). Try again shortly.")
	}
	// Authoritative-first: the engine-gated `rec.secret` wins over the `fuel.secret` display copy so the
	// gate and the claim can never read divergent secrets (codex LOW). Plaintext is a fallback only.
	const secretHex = deps.resolvedSecret ?? fuel.secret
	if (!secretHex) return stop("This Fuel bridge is missing its claim secret.")
	const publicFee = {
		paymentMethod: publicFeeJuicePayment(recipient, {
			claimAmount: received,
			claimSecret: Fr.fromString(secretHex),
			messageLeafIndex: BigInt(fuel.leafIndex),
		}),
		// {@link PUBLIC_CLAIM_GAS}: explicit + canary-calibrated (the empty BatchCall gives the estimator
		// nothing). teardownGas=0; maxFeesPerGas is the caller's predicted-worst snapshot (NO padding),
		// since this self-pays and the bridged amount is the whole budget.
		gasSettings: {
			gasLimits: Gas.from(PUBLIC_CLAIM_GAS),
			teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }),
			...(deps.maxFeesPerGas ? { maxFeesPerGas: deps.maxFeesPerGas } : {}),
		},
	}
	const carrier = () => new BatchCall(aztec as never, [])
	return {
		simulate: () => simulateViaPayload(publicFee),
		send: async () => {
			deps.onAttempt?.()
			const { receipt } = (await carrier().send({
				from: recipient,
				fee: publicFee,
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)) as { receipt: { txHash: unknown } }
			const txHash = String(receipt.txHash)
			deps.onTxHash?.(txHash)
			return { txHash }
		},
	}
}
