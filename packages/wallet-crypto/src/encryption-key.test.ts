import { expect, test } from "vitest"
import { EncryptionKey } from "./encryption-key"

test("empty payload is fine", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const v = new Uint8Array()
	const c = await key.encrypt(v)
	const p = await key.decrypt(c)
	expect(p).toStrictEqual(v)
})

test("encrypt and decrypt payload", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const v = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
	const c = await key.encrypt(v)
	const p = await key.decrypt(c)
	expect(p).toStrictEqual(v)
})

test("same payload - different result", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const v = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
	const c1 = await key.encrypt(v)
	const c2 = await key.encrypt(v)
	const p1 = await key.decrypt(c1)
	const p2 = await key.decrypt(c2)
	expect(c1).not.toStrictEqual(c2)
	expect(p1).toStrictEqual(p2)
})

test("decryption with wrong key fails", async () => {
	const key1 = await EncryptionKey.fromPassword("qwerty")
	const v = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
	const c = await key1.encrypt(v)

	const key2 = await EncryptionKey.fromPassword("qwe")
	await expect(() => key2.decrypt(c)).rejects.toThrow()
})

test("AAD round-trips when both sides supply the same bytes", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const aad = new TextEncoder().encode("nulo:profile-master:v2")
	const payload = new TextEncoder().encode("secret bytes")
	const c = await key.encrypt(payload, aad)
	expect(await key.decrypt(c, aad)).toStrictEqual(new Uint8Array(payload))
})

test("AAD mismatch fails authentication — a ciphertext cannot move between purposes", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const payload = new TextEncoder().encode("secret bytes")
	const sealedAsMaster = await key.encrypt(payload, new TextEncoder().encode("nulo:profile-master:v2"))
	await expect(key.decrypt(sealedAsMaster, new TextEncoder().encode("nulo:profile-entropy:v1"))).rejects.toThrow()
	await expect(key.decrypt(sealedAsMaster)).rejects.toThrow()
})

test("AAD-less ciphertexts stay decryptable without AAD (back-compat)", async () => {
	const key = await EncryptionKey.fromPassword("qwerty")
	const payload = new TextEncoder().encode("legacy bytes")
	const c = await key.encrypt(payload)
	expect(await key.decrypt(c)).toStrictEqual(new Uint8Array(payload))
	await expect(key.decrypt(c, new TextEncoder().encode("nulo:profile-master:v2"))).rejects.toThrow()
})
