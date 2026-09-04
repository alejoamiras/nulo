import { classifyFeePayer } from "@nulo/wallet-bridge"

/**
 * The embedded fee payment a payload carries — "fjwc" (the sender claims Fee Juice in setup) or
 * "fpc" (an external contract pays) — or undefined when it carries none: no payer, or a sender who
 * only asks to pay from held Fee Juice. That last shape is a requested self-pay, not an embedded
 * payment: the wallet's own Fee Juice method pays it, and building it as a claim in setup would
 * never end setup.
 */
export function detectEmbeddedFeePayment(
	feePayer: unknown,
	from: unknown,
	calls?: ReadonlyArray<{ readonly name?: string | undefined }>,
): "fjwc" | "fpc" | undefined {
	const route = classifyFeePayer(feePayer, from, calls)
	return route === "fjwc" || route === "fpc" ? route : undefined
}

/**
 * Detects whether a sendTx opts.from value indicates a NO_FROM (DefaultEntrypoint) transaction.
 */
export function isNoFromRequest(from: unknown): boolean {
	return from === "NO_FROM"
}
