/**
 * Per-profile PXE store encryption key (NULO-PXE-STORE-KDF v2).
 *
 * The offscreen PXE persists per-(profile, chain) SQLite-OPFS databases; each opens with a 32-byte
 * ChaCha20 key (sqlite3mc, upstream `AztecSQLiteOPFSStore.open`'s `encryptionKey` — battle-tested
 * page cipher, we never roll our own). The key derives from the profile MASTER secret AND its
 * imported-keys DEK via HKDF-SHA256 with a dedicated domain label, so:
 *
 *  - it is derived only from an unlocked session with a verified DEK (both inputs are
 *    in-memory-only; a degraded session — no DEK — cannot derive it). The offscreen keeps a
 *    provisioned key warm across lock and profile switch, which is why admission is gated on
 *    the service-worker side rather than by the derivation alone;
 *  - it is NOT the master (HKDF is one-way — a store-key leak does not expose the master);
 *  - a same-phrase sibling profile, which shares the master, cannot derive it: the DEK is the
 *    one secret the sibling never holds;
 *  - purging a profile is crypto-erase even if an OPFS unlink is interrupted (key discarded);
 *  - a password change does NOT re-key (the password wraps both inputs; both are stable), so
 *    the never-migratable KDF-rotation rule is not tripped.
 *
 * The profileId is the HKDF salt input (defense-in-depth on top of the DEK). The label is
 * pinned by a key vector (`key-vectors.test.ts` V11) — changing it orphans every encrypted PXE
 * store.
 */
import { importDualSecretHkdfKey } from "./dual-secret-hkdf"
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"

const PXE_STORE_INFO = new TextEncoder().encode("nulo:pxe-store:v2")

/** Exported for the key-vector pin ONLY — the label is consensus-critical for local storage. */
export const PXE_STORE_KDF_LABEL = "nulo:pxe-store:v2"

/**
 * Derive the 32-byte per-profile PXE store key. The caller owns the returned buffer's lifecycle
 * (note: upstream TRANSFERS the buffer to its worker on open — hand it a copy per open).
 */
export async function derivePxeStoreKey(
	master: MasterSecretBytes,
	dek: ImportedKeysDek,
	profileId: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const baseKey = await importDualSecretHkdfKey(master, dek, ["deriveBits"])
	const salt = new TextEncoder().encode(`nulo:pxe-store-salt:${profileId}`)
	const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: PXE_STORE_INFO }, baseKey, 256)
	return new Uint8Array(bits)
}
