/**
 * How a dApp transaction pays, read from the payload the wallet itself parses — never from a
 * dApp-supplied flag. The payer field alone cannot tell apart two shapes the account entrypoint
 * treats very differently: a sender who claims bridged Fee Juice inside this transaction's setup
 * carries the Fee Juice contract's `claim_and_end_setup` call, and the entrypoint must NOT end
 * setup for it (that call does); a sender with no fee call at all asks to pay from the Fee Juice
 * it already holds, and the entrypoint must end setup itself. Routing the second as the first
 * builds a transaction that never leaves setup.
 */

/** The Fee Juice contract's setup-ending claim: the one call that makes a sender-paid payload a claim in setup. */
export const CLAIM_AND_END_SETUP = "claim_and_end_setup"

export type FeePayerRoute =
	/** An external fee payment contract pays: its calls ride in the payload, the wallet adds nothing. */
	| "fpc"
	/** The sender pays with Fee Juice it claims in this transaction's setup. */
	| "fjwc"
	/** The sender asks to pay from the Fee Juice it already holds: the wallet's own Fee Juice method, with nothing to pick. */
	| "self-pay"

type CallLike = { readonly name?: string | undefined }
type PayloadLike = { readonly feePayer?: unknown; readonly calls?: ReadonlyArray<CallLike> | undefined }

/** The route a payload's payer and calls describe; undefined when it names no payer (the user's fee card decides). */
export function classifyFeePayer(feePayer: unknown, from: unknown, calls: ReadonlyArray<CallLike> | undefined): FeePayerRoute | undefined {
	if (feePayer === undefined || feePayer === null) return undefined
	if (String(feePayer) !== String(from)) return "fpc"
	return (calls ?? []).some((call) => call?.name === CLAIM_AND_END_SETUP) ? "fjwc" : "self-pay"
}

/** A payload that names the sender as payer and carries no fee call: pay from held Fee Juice. */
export const isSelfPay = (exec: PayloadLike | undefined, from: unknown): boolean =>
	classifyFeePayer(exec?.feePayer, from, exec?.calls) === "self-pay"
