/**
 * The HKDF base key over `master ‖ dek` shared by every derivation that must be UNFORGEABLE by
 * a holder of the master alone (a same-phrase sibling profile derives the same master): the
 * envelope MAC, the PXE store key and the dApp-session MAC key. Each derivation keeps its own
 * salt/info and `deriveKey`/`deriveBits` call — only the IKM contract lives here.
 */
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

/**
 * Import `master ‖ dek` as a non-extractable HKDF base key. Brands erase at runtime, so the
 * fixed 32+32 split is enforced here — otherwise two distinct `(master, dek)` splits of the
 * same 64 bytes would derive the same key. The concatenated copy is wiped once the engine
 * holds it; the inputs stay caller-owned.
 */
export async function importDualSecretHkdfKey(master: MasterSecretBytes, dek: ImportedKeysDek, usages: KeyUsage[]): Promise<CryptoKey> {
	if (master.length !== 32 || dek.length !== 32) {
		throw new Error("dual-secret HKDF requires a 32-byte master and a 32-byte dek")
	}
	const ikmBytes = new Uint8Array(master.length + dek.length) as Uint8Array<ArrayBuffer>
	ikmBytes.set(master, 0)
	ikmBytes.set(dek, master.length)
	try {
		return await globalThis.crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, usages)
	} finally {
		zeroize(ikmBytes)
	}
}
