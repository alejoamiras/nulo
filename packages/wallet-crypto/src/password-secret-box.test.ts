/**
 * Unit tests for `PasswordSecretBox`.
 *
 * Pure class, no storage, no browser API. Covers seal/unseal round-trip,
 * the wrong-password null-return contract (NOT throw), `ENCRYPTION_GUARD`
 * pass-through, and the base64 encoding lock.
 */

import { describe, expect, test } from "vitest"
import { ENCRYPTION_GUARD, type EncryptedProfileSecret, PasswordSecretBox } from "./password-secret-box"

function newBox(): PasswordSecretBox {
	return new PasswordSecretBox()
}

const PLAINTEXT_HEX = "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee"
const PLAINTEXT = new Uint8Array(PLAINTEXT_HEX.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

describe("PasswordSecretBox", () => {
	describe("seal + unseal", () => {
		test("seal/unseal round-trip returns the original secret", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const recovered = await box.unseal("hunter2", encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!)).toBe(PLAINTEXT_HEX)
		})

		test("same inputs produce distinct ciphertexts (IV entropy)", async () => {
			const box = newBox()
			const a = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const b = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			expect(a.encrypted.guard).not.toBe(b.encrypted.guard)
			expect(a.encrypted.secret).not.toBe(b.encrypted.secret)
		})

		test("seal output fields are base64-encoded strings (frozen format)", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			// base64 chars: A-Z a-z 0-9 + / =
			expect(encrypted.guard).toMatch(/^[A-Za-z0-9+/]+=*$/)
			expect(encrypted.secret).toMatch(/^[A-Za-z0-9+/]+=*$/)
			// Length sanity: guard is 8 bytes + 12 iv + 16 tag + 1 version = 37 bytes
			// → ~52 base64 chars (with padding). Don't pin exact length (internal
			// format may evolve), but it's not empty.
			expect(encrypted.guard.length).toBeGreaterThan(0)
			expect(encrypted.secret.length).toBeGreaterThan(0)
		})
	})

	describe("wrong-password returns null (does NOT throw)", () => {
		test("unseal with a wrong password returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const recovered = await box.unseal("not-hunter2", encrypted)
			expect(recovered).toBeNull()
		})

		test("unseal with a corrupted guard returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const corrupted: EncryptedProfileSecret = {
				guard: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
				secret: encrypted.secret,
			}
			const recovered = await box.unseal("hunter2", corrupted)
			expect(recovered).toBeNull()
		})

		test("unseal with a corrupted secret returns null", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const corrupted: EncryptedProfileSecret = {
				guard: encrypted.guard,
				secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			}
			const recovered = await box.unseal("hunter2", corrupted)
			expect(recovered).toBeNull()
		})
	})

	describe("unsealWithPasshash", () => {
		test("accepts the passhash returned by seal", async () => {
			const box = newBox()
			const { passhash, encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const recovered = await box.unsealWithPasshash(passhash, encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!)).toBe(PLAINTEXT_HEX)
		})

		test("returns null with a different passhash", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const otherHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("different"))
			const recovered = await box.unsealWithPasshash(otherHash, encrypted)
			expect(recovered).toBeNull()
		})
	})

	describe("reseal", () => {
		test("returns fresh encrypted + passhash that unseal under new password", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)

			const resealed = await box.reseal("hunter2", "hunter3", encrypted)
			expect(resealed).not.toBeNull()
			// Fresh ciphertext
			expect(resealed!.encrypted.guard).not.toBe(encrypted.guard)
			expect(resealed!.encrypted.secret).not.toBe(encrypted.secret)

			// New password works
			const recovered = await box.unseal("hunter3", resealed!.encrypted)
			expect(recovered).not.toBeNull()
			expect(toHex(recovered!)).toBe(PLAINTEXT_HEX)

			// Old password no longer works
			const oldRecovered = await box.unseal("hunter2", resealed!.encrypted)
			expect(oldRecovered).toBeNull()
		})

		test("returns null when the old password is wrong", async () => {
			const box = newBox()
			const { encrypted } = await box.seal("hunter2", PLAINTEXT as Uint8Array<ArrayBuffer>)
			const resealed = await box.reseal("not-hunter2", "hunter3", encrypted)
			expect(resealed).toBeNull()
		})
	})

	describe("ENCRYPTION_GUARD canary", () => {
		test("ENCRYPTION_GUARD bytes are unchanged (tripwire for silent GUARD edits)", () => {
			// Hard-code the current bytes so a drive-by change to spec.ts
			// fails this test before it silently invalidates every existing
			// profile. If you intentionally change the GUARD, write a
			// migration first, then update this assertion.
			expect([...ENCRYPTION_GUARD]).toEqual([6, 11, 20, 20, 22, 4, 20, 22])
		})
	})
})
