/**
 * Wallet-core random utilities. No dependency on Node's Buffer — hex
 * encoding is done with native primitives so this module ships in any
 * environment that has `globalThis.crypto.getRandomValues`.
 */

import { bytesToHex } from "./encoding"

export const getRandomHex = (length: number): string => {
	// Ceil so an odd length still draws enough random bytes (a floored
	// `length / 2` would silently return fewer hex chars — and fewer bits —
	// than asked for); slice back to the exact requested length.
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)))
	return bytesToHex(bytes).slice(0, length)
}
