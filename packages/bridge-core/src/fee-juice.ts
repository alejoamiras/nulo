/**
 * Fee-juice payment for the bridge's L2 txs: pay gas by claiming bridged Fee Juice in the
 * same tx (the headline "land Fee Juice in one transaction"), or bootstrap via the
 * sandbox/testnet sponsored FPC before any FJ has been bridged. Thin aztec.js wrappers — the
 * caller passes the connected sender + the L1→L2 claim the Fee-Juice deposit produced.
 *
 * Private-fuel note: aztec.js 4.2.0's `PrivateFeePaymentMethod` is `@deprecated` (unsupported
 * on mainnet) and the Wonderland private-FPC path needs an FPC deployed + sandbox validation,
 * so paying gas from a privately-held FJ note is deferred. `FeeJuicePaymentMethodWithClaim`
 * is the supported one-tx path and works for a claim from either a public or private deposit
 * (it consumes the L1→L2 message by leaf index, regardless of how the deposit was made).
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { L2AmountClaim } from "@aztec/aztec.js/ethereum"
import { FeeJuicePaymentMethodWithClaim, SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { FEE_JUICE_ADDRESS } from "@aztec/constants"

/** The canonical L2 Fee Juice contract address — a protocol constant (identical on every network). */
export const feeJuiceAddress: string = AztecAddress.fromNumber(FEE_JUICE_ADDRESS).toString()

/** The L1→L2 claim a Fee-Juice bridge deposit produced; the preimage the L2 claim consumes. */
export type FeeJuiceClaim = Pick<L2AmountClaim, "claimAmount" | "claimSecret" | "messageLeafIndex">

/**
 * Pay L2 gas by claiming bridged Fee Juice in the same tx (`claim_and_end_setup`). `claim` is
 * what the L1 Fee-Juice deposit returned — amount + secret + the Inbox leaf index.
 */
export const publicFeeJuicePayment = (sender: AztecAddress, claim: FeeJuiceClaim): FeeJuicePaymentMethodWithClaim =>
	new FeeJuicePaymentMethodWithClaim(sender, claim)

/**
 * Bootstrap gas via a sponsored FPC (the sandbox + testnet pre-deploy one) — pays for the
 * bridge's L2 txs before the user holds any Fee Juice of their own.
 */
export const sponsoredFeePayment = (fpc: AztecAddress): SponsoredFeePaymentMethod => new SponsoredFeePaymentMethod(fpc)

/**
 * The `claim_and_end_setup` call args for claiming bridged Fee Juice as a standalone payload
 * (mirrors the extension's fee-juice claim). Use when claiming FJ to balance rather than
 * binding the claim to a single tx's fee via {@link publicFeeJuicePayment}.
 */
export const feeJuiceClaimArgs = (
	to: string,
	amount: bigint,
	secret: string,
	messageLeafIndex: bigint,
): readonly [string, bigint, string, bigint] => [to, amount, secret, messageLeafIndex]
