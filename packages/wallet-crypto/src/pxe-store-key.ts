/**
 * Per-profile PXE store encryption key (NULO-PXE-STORE-KDF v1).
 *
 * The offscreen PXE persists per-(profile, chain) SQLite-OPFS databases; each opens with a 32-byte
 * ChaCha20 key (sqlite3mc, upstream `AztecSQLiteOPFSStore.open`'s `encryptionKey` — battle-tested
 * page cipher, we never roll our own). The key derives from the profile MASTER secret via
 * HKDF-SHA256 with a dedicated domain label, so:
 *
 *  - it exists only while the profile is unlocked (the master is in-memory-only);
 *  - it is NOT the master (HKDF is one-way — a store-key leak does not expose the master);
 *  - purging a profile is crypto-erase even if an OPFS unlink is interrupted (key discarded);
 *  - a password change does NOT re-key (the password wraps the master; the master is stable), so
 *    the never-migratable KDF-rotation rule is not tripped.
 *
 * The profileId is the HKDF salt input, giving each profile a distinct key from the same master
 * (defense-in-depth; profiles also have distinct masters today). The label is pinned by a key
 * vector (`key-vectors.test.ts` V11) — changing it orphans every encrypted PXE store.
 */

const PXE_STORE_INFO = new TextEncoder().encode("nulo:pxe-store:v1")

/** Exported for the key-vector pin ONLY — the label is consensus-critical for local storage. */
export const PXE_STORE_KDF_LABEL = "nulo:pxe-store:v1"

/**
 * Derive the 32-byte per-profile PXE store key. The caller owns the returned buffer's lifecycle
 * (note: upstream TRANSFERS the buffer to its worker on open — hand it a copy per open).
 */
export async function derivePxeStoreKey(master: Uint8Array<ArrayBuffer>, profileId: string): Promise<Uint8Array<ArrayBuffer>> {
	const baseKey = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"])
	const salt = new TextEncoder().encode(`nulo:pxe-store-salt:${profileId}`)
	const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: PXE_STORE_INFO }, baseKey, 256)
	return new Uint8Array(bits)
}
