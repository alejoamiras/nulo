import { describe, expect, test } from "vitest"
import { asImportedKeysDek, asMasterSecretBytes, type ImportedKeysDek, type MasterSecretBytes } from "./secret-types"
import { SessionSecretBox, type SessionWrappedSecret } from "./session-secret-box"

const box = new SessionSecretBox()
const secret = (): MasterSecretBytes => asMasterSecretBytes(new Uint8Array(32).fill(7))
const dek = (): ImportedKeysDek => asImportedKeysDek(new Uint8Array(32).fill(0x11))

describe("SessionSecretBox (F-11 session bearer)", () => {
	test("wrap/unwrap round-trips the secret under the same aad", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		const out = await box.unwrap(w, "profile-p1")
		expect(out).not.toBeNull()
		expect(Array.from(out as Uint8Array)).toEqual(Array.from(secret()))
	})

	test("the bearer carries NO password-equivalent: random 32-byte token + real ciphertext", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		expect(w.v).toBe(1)
		expect(Buffer.from(w.token, "base64").length).toBe(32)
		expect(w.wrappedSecret).not.toBe(Buffer.from(secret()).toString("base64"))
	})

	test("wrong aad → null (a bearer can't be replayed against a different profile)", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		expect(await box.unwrap(w, "profile-OTHER")).toBeNull()
	})

	test("tampered wrappedSecret (bad GCM tag) → null, never throws", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		const bytes = Buffer.from(w.wrappedSecret, "base64")
		bytes[bytes.length - 1] ^= 0xff
		const tampered: SessionWrappedSecret = { ...w, wrappedSecret: bytes.toString("base64") }
		expect(await box.unwrap(tampered, "profile-p1")).toBeNull()
	})

	test("wrong token → null", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		const other = await box.wrap(secret(), "profile-p1")
		expect(await box.unwrap({ ...w, token: other.token }, "profile-p1")).toBeNull()
	})

	test("unknown version / malformed base64 → null", async () => {
		const w = await box.wrap(secret(), "profile-p1")
		expect(await box.unwrap({ ...w, v: 2 as 1 }, "profile-p1")).toBeNull()
		expect(await box.unwrap({ ...w, token: "!!!not-base64" }, "profile-p1")).toBeNull()
	})

	test("fresh randomness: two wraps of the same secret differ", async () => {
		const a = await box.wrap(secret(), "profile-p1")
		const b = await box.wrap(secret(), "profile-p1")
		expect(a.token).not.toBe(b.token)
		expect(a.wrappedSecret).not.toBe(b.wrappedSecret)
	})

	test("unwrap returns null on a wrong-length plaintext (not a 32-byte master secret)", async () => {
		// A crafted/corrupt bearer can carry its own token+salt, so it can produce a
		// valid GCM tag over a short/oversized plaintext. unwrap must reject it here
		// rather than yield a buffer that later throws in `Fr.fromBuffer` and aborts
		// service init. Bypass the brand to wrap a 1-byte "secret".
		const short = new Uint8Array(1).fill(9) as unknown as MasterSecretBytes
		expect(await box.unwrap(await box.wrap(short, "profile-p1"), "profile-p1")).toBeNull()
		const long = new Uint8Array(33).fill(9) as unknown as MasterSecretBytes
		expect(await box.unwrap(await box.wrap(long, "profile-p1"), "profile-p1")).toBeNull()
	})
})

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
		const v1 = await box.wrap(secret(), "profile-p1")
		expect(await box.unwrapPair(v1, "profile-p1")).toBeNull()
	})

	test("a v2 bearer is rejected by the v1 unwrap too (no downgrade path)", async () => {
		const v2 = await box.wrapPair(secret(), dek(), "profile-p1")
		expect(await box.unwrap(v2, "profile-p1")).toBeNull()
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
		const shortPair = new Uint8Array(32).fill(9) as unknown as MasterSecretBytes
		// Craft a v2-versioned bearer whose plaintext is 32 bytes, via the v1 wrap + version stamp.
		const v1 = await box.wrap(shortPair, "profile-p1")
		const crafted: SessionWrappedSecret = { ...v1, v: 2 }
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
