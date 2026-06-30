/**
 * Byte ⇄ string encoders shared across the wallet. Buffer-free by design so
 * wallet-core stays portable to any environment with `btoa`/`atob` — the same
 * invariant `random.ts` relies on — and so consumers can drop the Node Buffer
 * polyfill. Output is byte-identical to the per-site `Buffer`/loop idioms these
 * replaced: standard (padded) base64, lowercase zero-padded hex.
 */

/** Lowercase, zero-padded hex. */
export const bytesToHex = (bytes: Uint8Array): string => {
	let hex = ""
	for (const b of bytes) hex += b.toString(16).padStart(2, "0")
	return hex
}

// `btoa` needs a binary (latin1) string. Build it in chunks: spreading a large
// byte array through `String.fromCharCode(...bytes)` overflows the call stack.
const FROM_CHARCODE_CHUNK = 0x8000

/** Standard base64 (padded). Byte-identical to `Buffer.from(bytes).toString("base64")`. */
export const toBase64 = (bytes: Uint8Array): string => {
	let binary = ""
	for (let i = 0; i < bytes.length; i += FROM_CHARCODE_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + FROM_CHARCODE_CHUNK))
	}
	return btoa(binary)
}

/**
 * Decode standard base64 → bytes via `atob`. Strict on malformed input (throws),
 * matching the `atob` sites this replaced; callers decoding untrusted input must
 * keep handling the throw (the backup-type detector already wraps it in try/catch).
 */
export const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}
