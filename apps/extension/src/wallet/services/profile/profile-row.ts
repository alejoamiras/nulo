import { computeEnvelopeMacV3, type ImportedKeysDek, type MacEnvelopeV3, type MasterSecretBytes } from "@nulo/wallet-crypto"
import { mintPxeGeneration, type Profile } from "./spec"

type SealedSlots = { guard: string; secret: string; entropy: string }

/** What a password row's envelope MAC binds: the row's storage key plus its sealed fields. */
export type EnvelopeFields = { id: string; slots: SealedSlots; dekSealed: string; walletFingerprint: string }

/** The envelope MAC v3 fields of a sealed profile record, in canonical order: the three
 *  password-sealed slots, the sealed DEK, then the plaintext fingerprint (binding it makes
 *  blinding the duplicate guard a detectable tamper). The id is not part of the envelope;
 *  `computeEnvelopeMacV3` binds it separately. */
export function macEnvelopeV3(slots: SealedSlots, dekSealed: string, walletFingerprint: string): MacEnvelopeV3 {
	return { guard: slots.guard, secret: slots.secret, entropy: slots.entropy, dek: dekSealed, walletFingerprint }
}

/** The v3 tag for a password row. `id` must be the row's OWN storage key and final (after
 *  allocation or the restore id loop): it is bound first, which kills whole-envelope swaps
 *  between same-password profiles, so a tag computed over a provisional id never verifies. */
export function envelopeMacFor(fields: EnvelopeFields, master: MasterSecretBytes, dek: ImportedKeysDek): Promise<string> {
	return computeEnvelopeMacV3(fields.id, master, dek, macEnvelopeV3(fields.slots, fields.dekSealed, fields.walletFingerprint))
}

/** A new password row with its envelope MAC. Always mints a fresh `pxeGeneration`, even for a
 *  same-id re-import, so the PXE fence tells this incarnation from a deleted one. The key order
 *  is persisted bytes. */
export async function newPasswordRow(
	fields: EnvelopeFields & { name: string },
	master: MasterSecretBytes,
	dek: ImportedKeysDek,
): Promise<Extract<Profile, { type: "password" }>> {
	const envelopeMac = await envelopeMacFor(fields, master, dek)
	return {
		id: fields.id,
		name: fields.name,
		type: "password",
		pxeGeneration: mintPxeGeneration(),
		dekSealed: fields.dekSealed,
		walletFingerprint: fields.walletFingerprint,
		guard: fields.slots.guard,
		secret: fields.slots.secret,
		entropy: fields.slots.entropy,
		envelopeMac,
	}
}

/** A new passkey row (no envelope MAC: nothing on it is password-sealed). Same fresh
 *  `pxeGeneration` and persisted key-order contract as {@link newPasswordRow}. */
export function newPasskeyRow(fields: {
	id: string
	name: string
	dekSealed: string
	walletFingerprint: string
	credentialId: string
}): Extract<Profile, { type: "passkey" }> {
	return {
		id: fields.id,
		name: fields.name,
		type: "passkey",
		pxeGeneration: mintPxeGeneration(),
		dekSealed: fields.dekSealed,
		walletFingerprint: fields.walletFingerprint,
		credentialId: fields.credentialId,
	}
}
