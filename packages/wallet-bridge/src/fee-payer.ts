/**
 * How a dApp transaction pays, read from the payload the wallet itself parses — never from a
 * dApp-supplied flag or label. The payer field alone cannot tell apart two shapes the account
 * entrypoint treats very differently: a sender who claims bridged Fee Juice inside this
 * transaction's setup carries the Fee Juice contract's `claim_and_end_setup` as its FIRST call,
 * and the entrypoint must NOT end setup for it (that call does — every call before it runs in
 * setup, on the account's Fee Juice, and cannot be reverted); a sender with no such call asks to
 * pay from the Fee Juice it already holds, and the entrypoint must end setup itself. Routing the
 * second as the first builds a transaction that never leaves setup — or, with a call that ends
 * setup on its own, one that runs dApp calls inside setup.
 */

/** The Fee Juice protocol contract's address (`FEE_JUICE_ADDRESS`); pinned by test. */
export const FEE_JUICE_CONTRACT = "0x0000000000000000000000000000000000000000000000000000000000000003"
/** `claim_and_end_setup((Field),u128,Field,Field)` on the Fee Juice contract; pinned by test. */
export const CLAIM_AND_END_SETUP_SELECTOR = "0xcbe67243"
export const CLAIM_AND_END_SETUP = "claim_and_end_setup"
/** `claim_and_end_setup(to, amount, secret, leaf_index)`. */
const CLAIM_ARGS = 4

export type FeePayerRoute =
	/** An external fee payment contract pays: its calls ride in the payload, the wallet adds nothing. */
	| "fpc"
	/** The sender pays with Fee Juice it claims in this transaction's setup. */
	| "fjwc"
	/** The sender asks to pay from the Fee Juice it already holds: the wallet's own Fee Juice method, with nothing to pick. */
	| "self-pay"

/** The fields of a call the wallet reads to classify a payload's fee - the wire shape and the parsed one alike. */
export type FeeCallLike = {
	readonly name?: string | undefined
	readonly to?: unknown
	readonly selector?: unknown
	readonly type?: unknown
	readonly isStatic?: boolean | undefined
	readonly hideMsgSender?: boolean | undefined
	readonly args?: ReadonlyArray<unknown> | undefined
}
type PayloadLike = { readonly feePayer?: unknown; readonly calls?: ReadonlyArray<FeeCallLike> | undefined }

/** The Fee Juice contract's own setup-ending claim, crediting the payer: its address and selector, a
 *  private, non-static, sender-visible call whose four arguments start with the payer. The
 *  entrypoint commits the target, the selector, the flags and the arguments — never the name,
 *  which a dApp writes freely; a claim that credits someone else would end setup while THIS
 *  account pays from what it already holds. */
export const isClaimAndEndSetup = (call: FeeCallLike | undefined, payer: unknown): boolean =>
	call !== undefined &&
	String(call.to) === FEE_JUICE_CONTRACT &&
	String(call.selector) === CLAIM_AND_END_SETUP_SELECTOR &&
	String(call.type) === "private" &&
	call.isStatic === false &&
	call.hideMsgSender !== true &&
	call.args?.length === CLAIM_ARGS &&
	String(call.args[0]) === String(payer)

/** The route a payload's payer and calls describe; undefined when it names no payer (the user's fee card decides). */
export function classifyFeePayer(
	feePayer: unknown,
	from: unknown,
	calls: ReadonlyArray<FeeCallLike> | undefined,
): FeePayerRoute | undefined {
	if (feePayer === undefined || feePayer === null) return undefined
	if (String(feePayer) !== String(from)) return "fpc"
	// The claim must lead: the entrypoint runs every call before it inside setup.
	return isClaimAndEndSetup(calls?.[0], feePayer) ? "fjwc" : "self-pay"
}

/** A payload that names the sender as payer and does not lead with its own setup-ending claim: pay from held Fee Juice. */
export const isSelfPay = (exec: PayloadLike | undefined, from: unknown): boolean =>
	classifyFeePayer(exec?.feePayer, from, exec?.calls) === "self-pay"
