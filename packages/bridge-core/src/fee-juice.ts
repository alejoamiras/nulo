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
import { GasFees } from "@aztec/stdlib/gas"
import { FEE_JUICE_ADDRESS } from "@aztec/constants"

/** The canonical L2 Fee Juice contract address — a protocol constant (identical on every network). */
export const feeJuiceAddress: string = AztecAddress.fromNumber(FEE_JUICE_ADDRESS).toString()

/**
 * Re-exported from Wonderland: `maxGasCostFor(maxFeesPerGas, gasLimits)` → the `gasLimits·maxFeesPerGas`
 * bigint the FPC's `pay_fee` asserts the internal balance against. Surfaced here so the faucet's no-fuel
 * fee-source gate sizes itself against the EXACT committed gas settings without importing `@wonderland/*`
 * directly (the Wonderland coupling stays in bridge-core).
 */
export { maxGasCostFor } from "@wonderland/aztec-fee-payment/utils"

/** Minimal node shape for fee prediction (avoids a hard dep on the full node client type). */
type MinFeeNode = {
	getPredictedMinFees?: () => Promise<GasFees[]>
	getCurrentMinFees: () => Promise<GasFees>
}

/**
 * The protocol's worst-case min fee across predicted future slots — the inclusion-safe basis for a
 * committed `maxFeesPerGas`. Mirrors `@aztec/wallets` `base_wallet.getMinFees`: take the highest
 * `feePerL2Gas` from `getPredictedMinFees()`, falling back to `getCurrentMinFees()` on older nodes.
 *
 * A claim is built (simulated + proven) seconds-to-minutes before it lands; committing only the
 * CURRENT min fee risks an inclusion-time reject if the base fee rises in that window. The predicted
 * worst-case bounds that window. For an FPC-budgeted claim this also fixes the ceiling the FPC checks
 * (`gasLimits·maxFeesPerGas`), so the bridged amount can be sized against a stable, known number.
 */
export async function predictedWorstMinFees(node: MinFeeNode): Promise<GasFees> {
	if (!node.getPredictedMinFees) return node.getCurrentMinFees()
	let predicted: GasFees[]
	try {
		predicted = await node.getPredictedMinFees()
	} catch (e) {
		// Only fall back for old nodes that don't implement the method — NOT for transient RPC errors,
		// which must propagate (a silent fallback to current-min would under-price the inclusion-safe cap).
		const msg = e instanceof Error ? e.message : String(e)
		if (/not found|not supported|unknown method|unimplemented|method.*not/i.test(msg)) return node.getCurrentMinFees()
		throw e
	}
	if (!predicted || predicted.length === 0) return node.getCurrentMinFees()
	// Component-wise worst across slots (max each fee independently) — a true upper bound even if the DA
	// and L2 fees peak in different slots, so the committed cap is never under-priced on either axis.
	const first = predicted[0]
	if (!first) return node.getCurrentMinFees()
	let worstDa = first.feePerDaGas
	let worstL2 = first.feePerL2Gas
	for (const f of predicted) {
		if (f.feePerDaGas > worstDa) worstDa = f.feePerDaGas
		if (f.feePerL2Gas > worstL2) worstL2 = f.feePerL2Gas
	}
	return new GasFees(worstDa, worstL2)
}

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
