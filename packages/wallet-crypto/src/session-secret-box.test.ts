import { describe, expect, test } from "vitest"
import { asImportedKeysDek, asMasterSecretBytes, type ImportedKeysDek, type MasterSecretBytes } from "./secret-types"
import { SessionSecretBox, type SessionWrappedSecret } from "./session-secret-box"

const box = new SessionSecretBox()
const secret = (): MasterSecretBytes => asMasterSecretBytes(new Uint8Array(32).fill(7))
const dek = (): ImportedKeysDek => asImportedKeysDek(new Uint8Array(32).fill(0x11))

/** Independent re-implementation of the bearer wrap, so a bearer with an arbitrary-length payload
 *  can be crafted without a production API that would ever mint one. */
async function craftBearer(payload: Uint8Array<ArrayBuffer>, aad: string, v: 1 | 2): Promise<SessionWrappedSecret> {
	const token = crypto.getRandomValues(new Uint8Array(32))
	const salt = crypto.getRandomValues(new Uint8Array(32))
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ikm = await crypto.subtle.importKey("raw", token, "HKDF", false, ["deriveKey"])
	const key = await crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("nulo:session-wrap:v1") },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	)
	const ct = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, payload),
	)
	const packed = new Uint8Array(iv.length + ct.length)
	packed.set(iv, 0)
	packed.set(ct, iv.length)
	return {
		v,
		token: Buffer.from(token).toString("base64"),
		salt: Buffer.from(salt).toString("base64"),
		wrappedSecret: Buffer.from(packed).toString("base64"),
	}
}

describe("SessionSecretBox v2 pair bearer (master || dek)", () => {
	test("wrapPair/unwrapPair round-trips BOTH secrets atomically under the same aad", async () => {
		const w = await box.wrapPair(secret(), dek(), "profile-p1")
		expect(w.v).toBe(2)
		const out = await box.unwrapPair(w, "profile-p1")
		expect(out).not.toBeNull()
		expect(Array.from(out!.master)).toEqual(Array.from(secret()))
		expect(Array.from(out!.dek)).toEqual(Array.from(dek()))
	})

	test("a legacy v1 bearer → null (silentClose → full re-unlock; NEVER a dek-less session)", async () => {
		const v1 = await craftBearer(secret(), "profile-p1", 1)
		expect(await box.unwrapPair(v1, "profile-p1")).toBeNull()
	})

	test("wrong aad → null (no cross-profile replay)", async () => {
		const w = await box.wrapPair(secret(), dek(), "profile-p1")
		expect(await box.unwrapPair(w, "profile-OTHER")).toBeNull()
	})

	test("tampered ciphertext → null, never throws", async () => {
		const w = await box.wrapPair(secret(), dek(), "profile-p1")
		const bytes = Buffer.from(w.wrappedSecret, "base64")
		bytes[bytes.length - 1] ^= 0xff
		expect(await box.unwrapPair({ ...w, wrappedSecret: bytes.toString("base64") }, "profile-p1")).toBeNull()
	})

	test("a wrong-length plaintext → null (a 32-byte master-only payload can't masquerade as a pair)", async () => {
		const crafted = await craftBearer(new Uint8Array(32).fill(9), "profile-p1", 2)
		expect(await box.unwrapPair(crafted, "profile-p1")).toBeNull()
	})

	test("wrapPair REJECTS non-32-byte components (a short dek must not zero-pad into a 'valid' pair)", async () => {
		const short = asImportedKeysDek(new Uint8Array(1).fill(9))
		const long = asImportedKeysDek(new Uint8Array(33).fill(9))
		const short31 = asMasterSecretBytes(new Uint8Array(31).fill(9))
		await expect(box.wrapPair(secret(), short, "p1")).rejects.toThrow()
		await expect(box.wrapPair(secret(), long, "p1")).rejects.toThrow()
		await expect(box.wrapPair(short31, dek(), "p1")).rejects.toThrow()
	})
})
