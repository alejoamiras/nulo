import { describe, expect, test } from "vitest"
import { asMasterSecretBytes, type MasterSecretBytes } from "./secret-types"
import { SessionSecretBox, type SessionWrappedSecret } from "./session-secret-box"

const box = new SessionSecretBox()
const secret = (): MasterSecretBytes => asMasterSecretBytes(new Uint8Array(32).fill(7))

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
