import { describe, expect, it } from "vitest"
import { buildCreateOptions } from "./passkey-ceremony"

const ID = "a3f29b14"
const toHex = (b: BufferSource): string => {
	const u =
		b instanceof ArrayBuffer
			? new Uint8Array(b)
			: new Uint8Array((b as ArrayBufferView).buffer, (b as ArrayBufferView).byteOffset, (b as ArrayBufferView).byteLength)
	return Buffer.from(u).toString("hex")
}

describe("buildCreateOptions", () => {
	it("sets user.name and user.displayName to the branded nulo-{name}-{id} label", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(opts.user.name).toBe("nulo-alice-a3f29b14")
		expect(opts.user.displayName).toBe("nulo-alice-a3f29b14")
	})

	it("uses the name-free fallback when the profile name has no slugifiable characters", async () => {
		const opts = await buildCreateOptions(ID, "山田")
		expect(opts.user.name).toBe("nulo-profile-a3f29b14")
		expect(opts.user.displayName).toBe("nulo-profile-a3f29b14")
	})

	// Regression guard: changing the label must NOT disturb any crypto-adjacent
	// field. user.id, the PRF eval input, the challenge size, rp, and the
	// credential params are what the key-derivation + relying-party binding
	// depend on — they stay byte-identical to the pre-change shape.
	it("leaves user.id as the hex-decoded handle (independent of the label)", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(toHex(opts.user.id)).toBe(ID)
	})

	it("keeps the PRF eval input = SHA-256('nulo:profile:v1')", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		const first = opts.extensions?.prf?.eval?.first
		expect(first).toBeDefined()
		const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nulo:profile:v1")))
		expect(toHex(first as BufferSource)).toBe(Buffer.from(expected).toString("hex"))
	})

	it("keeps rp, challenge size, credential params, and authenticator selection unchanged", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(opts.rp).toEqual({ name: "Nulo", id: "nulo.sh" })
		expect((opts.challenge as Uint8Array).byteLength).toBe(32)
		expect(opts.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }])
		expect(opts.authenticatorSelection).toEqual({
			residentKey: "required",
			userVerification: "required",
			requireResidentKey: true,
		})
	})
})
