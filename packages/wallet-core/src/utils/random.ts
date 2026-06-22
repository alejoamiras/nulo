/**
 * Wallet-core random utilities. No dependency on Node's Buffer — hex
 * encoding is done with native primitives so this module ships in any
 * environment that has `self.crypto.getRandomValues`.
 */

const toHex = (bytes: Uint8Array): string => {
	let hex = ""
	for (const b of bytes) hex += b.toString(16).padStart(2, "0")
	return hex
}

export const getRandomHex = (length: number): string => {
	const bytes = self.crypto.getRandomValues(new Uint8Array(length / 2))
	return toHex(bytes)
}
