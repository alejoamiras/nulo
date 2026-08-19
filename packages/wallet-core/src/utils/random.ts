/**
 * Wallet-core random utilities. No dependency on Node's Buffer — hex
 * encoding is done with native primitives so this module ships in any
 * environment that has `globalThis.crypto.getRandomValues`.
 */

import { bytesToHex } from "./encoding"

export const getRandomHex = (length: number): string => {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length / 2))
	return bytesToHex(bytes)
}
