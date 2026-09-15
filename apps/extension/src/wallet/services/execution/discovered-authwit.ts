/**
 * The SW-internal record of one discovered private authorization. Both
 * discovery paths (the standalone discoverer and the folded probe) decode a
 * `CallAuthorizationRequest` to hash it; this keeps the decoded call beside
 * the hash so the approval card can show WHAT is being authorized, not only
 * that something is.
 */

import type { DiscoveredAuthwit } from "@nulo/wallet-bridge"

/** The fields of an upstream `CallAuthorizationRequest` the record reads —
 *  structural, so the hash seams stay injectable in unit tests. */
export interface DecodedAuthRequest {
	readonly innerHash: { toString(): string }
	readonly msgSender: { toString(): string }
	readonly functionSelector: { toString(): string }
	readonly args: readonly { toString(): string }[]
}

export function toDiscoveredAuthwit(
	consumer: { toString(): string },
	request: DecodedAuthRequest,
	messageHash: { toString(): string },
): DiscoveredAuthwit {
	return {
		consumer: consumer.toString(),
		caller: request.msgSender.toString(),
		selector: request.functionSelector.toString(),
		args: request.args.map((a) => a.toString()),
		innerHash: request.innerHash.toString(),
		messageHash: messageHash.toString(),
	}
}
