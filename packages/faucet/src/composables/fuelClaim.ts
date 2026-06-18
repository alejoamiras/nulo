/**
 * The Fuel claim builder — the fee-juice branch the journal's `claim` dep dispatches to by
 * `assetKind` (codex Option C, lessons/phase-3.md). NON-composable: imports only bridge-core / the
 * Aztec SDK / the pure `fuel-claim-state` lib, and takes the wallet + sponsored-FPC + floor as
 * ARGUMENTS — never a faucet singleton — so `useDeposit → fuelClaim → bridge-core` stays acyclic.
 *
 * PUBLIC: `FeeJuice.claim_and_end_setup` paid by the Sponsored FPC (the FJ lands in the public balance).
 * PRIVATE: the carrier-less embedded-FPC tx — `new BatchCall(wallet, [])` (no app call) paid by
 * `privateMintAndPayFee`, which runs `FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee` as setup and
 * credits `(amount − max_gas_cost)` to the claimer. The live sequencer's acceptance of a zero-app-call
 * tx is the deferred risk I2 — provable only on a live network (plan §5 DQ1).
 *
 * A direct Fuel record carries its FJ claim material in the `fuel` block (assetKind "fee-juice",
 * lessons/phase-3.md): `received` (the FJ), `secret` (public), `bridgeSecretSalt`/`fpc` (private),
 * `leafIndex`. There is NO token leg — this builds ONLY the fee-juice claim.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { BatchCall, Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TxStatus } from "@aztec/aztec.js/tx"
import { Gas } from "@aztec/stdlib/gas"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import { PRIVATE_FPC_ADDRESS, assertFuelClearsFloor, deriveBridgeSecret, feeJuiceAddress, privateMintAndPayFee } from "@nulo/bridge-core"
import { isPrivateFuelInsufficiency } from "@/lib/fuel-claim-state"

export interface FuelClaimInteraction {
	simulate: () => Promise<unknown>
	send: () => Promise<{ txHash: string }>
}

export interface FuelClaimDeps {
	/** The connected Aztec wallet. */
	aztec: unknown
	recipient: AztecAddress
	/** Sponsored FPC address — pays the PUBLIC claim (resolved by the caller; never imported here). */
	sponsoredFpc: AztecAddress
	/** The fail-CLOSED self-pay floor (FUEL_MIN_FJ). Undefined/zero ⇒ the private claim refuses. */
	minFloorFj: bigint | undefined
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

/** Build the {simulate, send} for a direct Fee-Juice claim. Guards fail CLOSED (return a `stop`). */
export async function buildFuelClaimInteraction(rec: DepositJournalRecord, deps: FuelClaimDeps): Promise<FuelClaimInteraction> {
	const fuel = rec.fuel
	if (!fuel?.received || !fuel.leafIndex) return stop("This Fuel bridge has no claimable Fee Juice.")
	const { aztec, recipient } = deps
	const received = BigInt(fuel.received)
	const leaf = new Fr(BigInt(fuel.leafIndex))

	if (rec.isPrivate) {
		// Fail-CLOSED floor: the bridged FJ must cover its own claim, or mint_and_pay_fee reverts post-mint.
		try {
			assertFuelClearsFloor(received, deps.minFloorFj)
		} catch (e) {
			return stop(e instanceof Error ? e.message : "The bridged gas is below the safe claim floor.")
		}
		// FPC version-drift kill-switch — never claim to a drifted FPC, never downgrade to public (L11/L15).
		if (fuel.fpc && fuel.fpc !== PRIVATE_FPC_ADDRESS) {
			return stop("Private fuel FPC address mismatch (version drift) — refusing to claim. Reselect a mode.")
		}
		// Authoritative-first: the engine-unsealed salt wins over the plaintext journal copy (which can be
		// missing/corrupted while the seal is intact). Plaintext is a fallback only (no-envelope legacy).
		const saltHex = deps.resolvedSalt ?? fuel.bridgeSecretSalt
		if (!saltHex) return stop("This private Fuel bridge is missing its recovery salt — cannot claim.")
		const salt = Fr.fromString(saltHex)
		const fpcAddr = AztecAddress.fromString(fuel.fpc ?? PRIVATE_FPC_ADDRESS)
		// teardownGas=0 keeps max_gas_cost within the bridged amount; the wallet fills maxFeesPerGas
		// (current-min, embedded-fpc cap) — mirrors the proven swap-private-fuel path (useDeposit.ts).
		const privateFee = {
			paymentMethod: privateMintAndPayFee(fpcAddr, received, deriveBridgeSecret(salt, recipient), salt, leaf),
			gasSettings: { teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }) },
		}
		const carrier = () => new BatchCall(aztec as never, [])
		return {
			simulate: () => carrier().simulate({ from: recipient, fee: privateFee } as never),
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

	// PUBLIC: claim straight to the public Fee Juice balance, paid by the Sponsored FPC.
	// Authoritative-first: the engine-gated `rec.secret` wins over the `fuel.secret` display copy so the
	// gate and the claim can never read divergent secrets (codex LOW). Plaintext is a fallback only.
	const secretHex = deps.resolvedSecret ?? fuel.secret
	if (!secretHex) return stop("This Fuel bridge is missing its claim secret.")
	const sponsored = { paymentMethod: new SponsoredFeePaymentMethod(deps.sponsoredFpc) }
	const { FeeJuiceContractArtifact } = await import("@aztec/noir-contracts.js/FeeJuice")
	const fj = await Contract.at(AztecAddress.fromString(feeJuiceAddress), FeeJuiceContractArtifact, aztec as never)
	const secret = Fr.fromString(secretHex)
	const claim = () => fj.methods.claim_and_end_setup(recipient, received, secret, leaf)
	return {
		simulate: () => claim().simulate({ from: recipient, fee: sponsored } as never),
		send: async () => {
			const { receipt } = (await claim().send({
				from: recipient,
				fee: sponsored,
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)) as { receipt: { txHash: unknown } }
			return { txHash: String(receipt.txHash) }
		},
	}
}
