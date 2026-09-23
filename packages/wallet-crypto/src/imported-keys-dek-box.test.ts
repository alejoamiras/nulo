import { createHash, hkdfSync } from "node:crypto"
import { describe, expect, test } from "vitest"
import { generateImportedKeysDek, IMPORTED_KEYS_DEK_LEN, sealDekUnderWrapKey, unsealDekUnderWrapKey } from "./imported-keys-dek-box"
import { PasskeyCredential } from "./passkey-credential"
import { asImportedKeysDek } from "./secret-types"

// Same fixture inputs as key-vectors V3 — a stable, documented credential.
const PRF_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
const CRED_B64 = "dGVzdC1jcmVkZW50aWFsLWlk"
const OTHER_PRF_B64 = Buffer.from(new Uint8Array(32).fill(0x77)).toString("base64")

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("imported-keys DEK box", () => {
	test("generateImportedKeysDek mints 32 CSPRNG bytes", () => {
		const a = generateImportedKeysDek()
		const b = generateImportedKeysDek()
		expect(a.length).toBe(IMPORTED_KEYS_DEK_LEN)
		expect(hex(a)).not.toBe(hex(b))
	})

	test("seal → unseal round-trips under a passkey-derived wrap key", async () => {
		const credential = await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })
		const wrapKey = await credential.deriveDekWrapKey()
		const dek = generateImportedKeysDek()
		const sealed = await sealDekUnderWrapKey(wrapKey, dek)
		expect(hex(await unsealDekUnderWrapKey(wrapKey, sealed))).toBe(hex(dek))
	})

	test("re-running the ceremony with the SAME credential reproduces the wrap key (backup carries the sealed blob verbatim)", async () => {
		const dek = generateImportedKeysDek()
		const sealed = await sealDekUnderWrapKey(
			await (await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })).deriveDekWrapKey(),
			dek,
		)
		// A fresh PasskeyCredential (a fresh ceremony) with the same PRF + credentialId.
		const again = await (await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })).deriveDekWrapKey()
		expect(hex(await unsealDekUnderWrapKey(again, sealed))).toBe(hex(dek))
	})

	test("a SIBLING credential's wrap key fails closed (transplant across passkey profiles)", async () => {
		const dek = generateImportedKeysDek()
		const sealed = await sealDekUnderWrapKey(
			await (await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })).deriveDekWrapKey(),
			dek,
		)
		const sibling = await (await PasskeyCredential.create({ id: CRED_B64, prf: OTHER_PRF_B64 })).deriveDekWrapKey()
		await expect(unsealDekUnderWrapKey(sibling, sealed)).rejects.toThrow()
	})

	test("an AAD-less or foreign-purpose ciphertext fails closed (the slot demands its purpose tag)", async () => {
		const credential = await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })
		const wrapKey = await credential.deriveDekWrapKey()
		const dek = generateImportedKeysDek()
		// Same key, same envelope framing, but sealed WITHOUT the purpose AAD.
		const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
		const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, dek))
		const out = new Uint8Array(13 + ct.length)
		out[0] = 1
		out.set(iv, 1)
		out.set(ct, 13)
		await expect(unsealDekUnderWrapKey(wrapKey, Buffer.from(out).toString("base64"))).rejects.toThrow()
	})

	test("a wrong-length plaintext fails closed (crafted 16-byte payload)", async () => {
		const credential = await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })
		const wrapKey = await credential.deriveDekWrapKey()
		const short = asImportedKeysDek(new Uint8Array(16).fill(1) as Uint8Array<ArrayBuffer>)
		const sealed = await sealDekUnderWrapKey(wrapKey, short)
		await expect(unsealDekUnderWrapKey(wrapKey, sealed)).rejects.toThrow()
	})

	test("a corrupt envelope fails closed", async () => {
		const credential = await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })
		const wrapKey = await credential.deriveDekWrapKey()
		await expect(unsealDekUnderWrapKey(wrapKey, "AAA=")).rejects.toThrow()
	})

	test("cross-implementation check: node:crypto HKDF reproduces deriveDekWrapKey exactly", async () => {
		// Independently derive the wrap key with node:crypto (different HKDF implementation than
		// the wallet's WebCrypto deriveKey), import it as an AES-GCM key, and decrypt what the
		// production wrap key sealed — a consistently mis-wired production HKDF cannot pass.
		const credential = await PasskeyCredential.create({ id: CRED_B64, prf: PRF_B64 })
		const dek = generateImportedKeysDek()
		const sealed = await sealDekUnderWrapKey(await credential.deriveDekWrapKey(), dek)

		const ikm = Buffer.from(PRF_B64, "base64")
		const salt = createHash("sha256")
			.update(Buffer.concat([Buffer.from("nulo:kdf:v1", "utf8"), Buffer.from(CRED_B64, "base64")]))
			.digest()
		const keyBytes = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("nulo:dek-wrap:v1", "utf8"), 32))
		const independentKey = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
		expect(hex(await unsealDekUnderWrapKey(independentKey, sealed))).toBe(hex(dek))
	})
})
