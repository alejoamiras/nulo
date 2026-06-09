import { EncryptionKey } from "@nulo/wallet-crypto"

/**
 * Recovery-secret encryption for the no-server private bridge. The key is derived from a deterministic
 * L1 signature over a PER-RECORD message (recoveryKeyMessage) — binding chain + portal + bridge + the
 * record's secretHash, so EACH sealed blob has its own key: a leaked signature exposes only that one
 * record, never all of them (codex 019eac7a CRITICAL). Reuses @nulo/wallet-crypto's PBKDF2 + AES-GCM
 * (never roll your own crypto).
 *
 * The sealed blob is a BEARER credential for PRIVATE transfers (the L2 claim chooses the recipient),
 * so the UI must warn before exporting it, and the caller MUST round-trip self-test the seal before
 * the irreversible L1 deposit — some wallets sign non-deterministically, which would otherwise strand
 * the claim.
 */

/** Binds a sealed record to its chain, bridge contracts, and secret hash (per-record key derivation). */
export interface RecoveryBinding {
	chainId: number
	portal: string
	bridge: string
	secretHashHex: string
}

/** The per-record, domain-separated message the user signs to derive THIS record's recovery key. */
export function recoveryKeyMessage(b: RecoveryBinding): string {
	return [
		"Nulo Bridge recovery key v1 — sign to locally encrypt ONE in-flight private claim secret.",
		"This is not a transaction and costs nothing.",
		`chain=${b.chainId} portal=${b.portal.toLowerCase()} bridge=${b.bridge.toLowerCase()} record=${b.secretHashHex.toLowerCase()}`,
	].join("\n")
}

function toBase64(bytes: Uint8Array): string {
	let s = ""
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
	return btoa(s)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
	const s = atob(b64)
	const out = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
	return out
}

/** Derive a record's recovery key from the user's signature over recoveryKeyMessage(...). Normalizes
 *  the signature encoding (trimmed lowercase) so trivial encoding differences don't change the key. */
export function recoveryKeyFromSignature(signatureHex: string): Promise<EncryptionKey> {
	return EncryptionKey.fromPassword(signatureHex.trim().toLowerCase())
}

/** Encrypt a claim/exit secret into the opaque base64 blob held in recovery records. */
export async function sealSecret(key: EncryptionKey, secretHex: string): Promise<string> {
	const enc = new TextEncoder().encode(secretHex)
	const bytes = new Uint8Array(enc.length)
	bytes.set(enc)
	return toBase64(await key.encrypt(bytes))
}

/** Decrypt a blob produced by `sealSecret` back into the secret. */
export async function openSecret(key: EncryptionKey, blob: string): Promise<string> {
	return new TextDecoder().decode(await key.decrypt(fromBase64(blob)))
}

/**
 * Seal a record's secret end-to-end: derive THIS record's key from the per-record signature, seal,
 * then SELF-TEST the round trip (re-sign + open). A wallet that signs non-deterministically fails the
 * self-test and throws HERE — before the irreversible L1 deposit — rather than stranding the claim.
 */
export async function sealRecordSecret(
	sign: (message: string) => Promise<string>,
	binding: RecoveryBinding,
	secretHex: string,
): Promise<string> {
	const message = recoveryKeyMessage(binding)
	const blob = await sealSecret(await recoveryKeyFromSignature(await sign(message)), secretHex)
	const reopened = await openSecret(await recoveryKeyFromSignature(await sign(message)), blob).catch(() => null)
	if (reopened !== secretHex) {
		throw new Error(
			"Recovery self-test failed: this wallet signs non-deterministically, so a private claim could not be recovered. Aborting before the deposit.",
		)
	}
	return blob
}

/** Re-derive THIS record's key from the per-record signature and open its sealed blob. */
export async function openRecordSecret(
	sign: (message: string) => Promise<string>,
	binding: RecoveryBinding,
	blob: string,
): Promise<string> {
	return openSecret(await recoveryKeyFromSignature(await sign(recoveryKeyMessage(binding))), blob)
}
