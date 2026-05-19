/**
 * Best-effort: overwrite the bytes of `buf` with zeros.
 *
 * Returns `buf` so the helper composes in a chained pattern:
 *
 *   try { … } finally { zeroize(passhash) }
 *
 * Accepts `Uint8Array` (and its subclasses, e.g. Node `Buffer`),
 * `ArrayBuffer`, or `undefined` (no-op). When passed a `Uint8Array`
 * subarray view, only the view's bytes are zeroed — the backing
 * buffer outside the view is left untouched.
 *
 * ## Caveats (DO NOT confuse with cryptographic memory hygiene)
 *
 * - JS engine GC is opaque; this helper does NOT control when the
 *   memory pages holding the original bytes are reclaimed or zeroed
 *   by the OS. Other live references to the same bytes (copies,
 *   `Buffer.from(...)` clones, base64 strings) are unaffected.
 * - `CryptoKey`, `Fr` internals, and immutable string parameters
 *   CANNOT be zeroed by this helper — document those at the call
 *   site.
 * - This is a defense-in-depth measure: it tightens the window
 *   between "secret used" and "secret reclaimed by GC", not a
 *   guarantee the bytes are unrecoverable from process memory.
 *
 * Implementation note: `Buffer` (Node-style) extends `Uint8Array`
 * structurally, so `instanceof ArrayBuffer` is FALSE for Buffer —
 * Buffer hits the Uint8Array branch via `.fill(0)`. The
 * `instanceof ArrayBuffer` check is for the rare site that hands
 * the helper a raw `ArrayBuffer` (e.g. `crypto.subtle.deriveBits`
 * results before they're wrapped in a typed-array view).
 */
export function zeroize<T extends Uint8Array | ArrayBuffer | undefined | null>(buf: T): T {
	if (buf === undefined || buf === null) return buf
	if (ArrayBuffer.isView(buf)) {
		// Uint8Array, Buffer (Uint8Array subclass), or any TypedArray view.
		// Use the standard view check rather than `instanceof Uint8Array`
		// so cross-realm cases (e.g. jsdom) work too.
		;(buf as Uint8Array).fill(0)
	} else {
		// Raw ArrayBuffer (e.g. result of `crypto.subtle.digest(...)`).
		// Wrap in a Uint8Array view to fill. `instanceof ArrayBuffer` is
		// unreliable across realms; the `isView` branch above handles all
		// typed arrays, so anything reaching here is treated as an
		// ArrayBuffer-like.
		new Uint8Array(buf as ArrayBufferLike).fill(0)
	}
	return buf
}
