/**
 * Unit tests for `PasswordSecretBox` (store-both v2: guard + master + entropy, purpose-AAD).
 *
 * Pure class, no storage, no browser API. Covers seal/unseal round-trip of BOTH secrets,
 * the wrong-password null-return contract (NOT throw), the slot-swap AAD rejection (the
 * split-brain recovery attack), `ENCRYPTION_GUARD` pass-through, and the base64 encoding lock.
 */

import { describe, expect, test } from "vitest"
import { ENCRYPTION_GUARD, type EncryptedProfileSecret, PasswordSecretBox } from "./password-secret-box"
import { asBase64Ciphertext, asMasterSecretBytes, asPasshash } from "./secret-types"

function newBox(): PasswordSecretBox {
	return new PasswordSecretBox()
}

const PLAINTEXT_HEX = "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee"
const PLAINTEXT = asMasterSecretBytes(new Uint8Array(PLAINTEXT_HEX.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16))))
const ENTROPY = new Uint8Array(32).fill(0x5a) as Uint8Array<ArrayBuffer>
const ENTROPY_HEX = "5a".repeat(32)
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

describe("PasswordSecretBox", () => {
	describe("seal + unseal", () => {
		test("seal/unseal round-trip returns the original secret AND entropy", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const recovered = await box.unseal("hunter2", encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!.secret)).toBe(PLAINTEXT_HEX)
			expect(toHex(recovered!.entropy)).toBe(ENTROPY_HEX)
		})

		test("same inputs produce distinct ciphertexts (IV entropy)", async () => {
			const box = newBox()
			const a = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const b = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			expect(a.encrypted.guard).not.toBe(b.encrypted.guard)
			expect(a.encrypted.secret).not.toBe(b.encrypted.secret)
			expect(a.encrypted.entropy).not.toBe(b.encrypted.entropy)
		})

		test("seal output fields are base64-encoded strings (frozen format)", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			expect(encrypted.guard).toMatch(/^[A-Za-z0-9+/]+=*$/)
			expect(encrypted.secret).toMatch(/^[A-Za-z0-9+/]+=*$/)
			expect(encrypted.entropy).toMatch(/^[A-Za-z0-9+/]+=*$/)
			expect(encrypted.guard.length).toBeGreaterThan(0)
			expect(encrypted.secret.length).toBeGreaterThan(0)
			expect(encrypted.entropy.length).toBeGreaterThan(0)
		})

		test("rejects entropy that is not exactly 32 bytes", async () => {
			const box = newBox()
			await expect(box.seal("hunter2", PLAINTEXT, new Uint8Array(16) as Uint8Array<ArrayBuffer>)).rejects.toThrow(
				"Invalid entropy length",
			)
		})
	})

	describe("wrong-password returns null (does NOT throw)", () => {
		test("unseal with a wrong password returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			expect(await box.unseal("not-hunter2", encrypted)).toBeNull()
		})

		test("unseal with a corrupted guard returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const corrupted: EncryptedProfileSecret = {
				...encrypted,
				guard: asBase64Ciphertext("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
			}
			expect(await box.unseal("hunter2", corrupted)).toBeNull()
		})

		test("unseal with a corrupted secret returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const corrupted: EncryptedProfileSecret = {
				...encrypted,
				secret: asBase64Ciphertext("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
			}
			expect(await box.unseal("hunter2", corrupted)).toBeNull()
		})

		test("unseal with a corrupted entropy returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const corrupted: EncryptedProfileSecret = {
				...encrypted,
				entropy: asBase64Ciphertext("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
			}
			expect(await box.unseal("hunter2", corrupted)).toBeNull()
		})
	})

	describe("slot-swap AAD rejection (split-brain recovery attack)", () => {
		test("the master ciphertext moved into the entropy slot fails, and vice versa", async () => {
			// The R1-audit attack: swap the two 32-byte-payload ciphertexts so exported words
			// re-encode the MASTER (deriving a different wallet). Purpose-AAD makes either
			// transplant fail authentication instead of decrypting into the wrong meaning.
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			expect(await box.unseal("hunter2", { ...encrypted, entropy: encrypted.secret })).toBeNull()
			expect(await box.unseal("hunter2", { ...encrypted, secret: encrypted.entropy })).toBeNull()
		})
	})

	describe("unsealWithPasshash", () => {
		test("accepts the passhash returned by seal", async () => {
			const box = newBox()
			const { passhash, encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const recovered = await box.unsealWithPasshash(passhash, encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!.secret)).toBe(PLAINTEXT_HEX)
			expect(toHex(recovered!.entropy)).toBe(ENTROPY_HEX)
		})

		test("returns null with a different passhash", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			const otherHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("different"))
			expect(await box.unsealWithPasshash(asPasshash(otherHash), encrypted)).toBeNull()
		})
	})

	describe("reseal", () => {
		test("reseals BOTH secrets under the new password; old password stops working for both", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)

			const resealed = await box.reseal("hunter2", "hunter3", encrypted)
			expect(resealed).not.toBeNull()
			expect(resealed!.encrypted.guard).not.toBe(encrypted.guard)
			expect(resealed!.encrypted.secret).not.toBe(encrypted.secret)
			// The audit-H2 pin: entropy is resealed in the SAME operation, never left behind
			// decryptable under the retired password.
			expect(resealed!.encrypted.entropy).not.toBe(encrypted.entropy)

			const recovered = await box.unseal("hunter3", resealed!.encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!.secret)).toBe(PLAINTEXT_HEX)
			expect(toHex(recovered!.entropy)).toBe(ENTROPY_HEX)

			expect(await box.unseal("hunter2", resealed!.encrypted)).toBeNull()
		})

		test("returns null when the old password is wrong", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT, ENTROPY)
			expect(await box.reseal("not-hunter2", "hunter3", encrypted)).toBeNull()
		})
	})

	describe("ENCRYPTION_GUARD canary", () => {
		test("ENCRYPTION_GUARD bytes are unchanged (tripwire for silent GUARD edits)", () => {
			expect([...ENCRYPTION_GUARD]).toEqual([6, 11, 20, 20, 22, 4, 20, 22])
		})
	})
})
