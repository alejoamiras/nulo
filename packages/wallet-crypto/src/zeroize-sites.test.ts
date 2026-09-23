import { afterEach, describe, expect, test, vi } from "vitest"
import { EncryptionKey } from "./encryption-key"
import { asImportedKeysDek, asMasterSecretBytes } from "./secret-types"
import { SessionSecretBox } from "./session-secret-box"

const isZeroed = (b: Uint8Array) => b.length > 0 && b.every((x) => x === 0)

afterEach(() => vi.restoreAllMocks())

describe("transient secret buffers are wiped after the crypto call settles", () => {
	test("getPasshash wipes the encoded password bytes", async () => {
		const encoded: Uint8Array[] = []
		const orig = TextEncoder.prototype.encode
		vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (this: TextEncoder, s?: string) {
			const out = orig.call(this, s)
			encoded.push(out)
			return out
		})
		await EncryptionKey.getPasshash("correct horse battery staple")
		expect(encoded).toHaveLength(1)
		expect(isZeroed(encoded[0])).toBe(true)
	})

	test("a failing digest still wipes the encoded password bytes", async () => {
		const encoded: Uint8Array[] = []
		const orig = TextEncoder.prototype.encode
		vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (this: TextEncoder, s?: string) {
			const out = orig.call(this, s)
			encoded.push(out)
			return out
		})
		vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(new Error("digest failed"))
		await expect(EncryptionKey.getPasshash("correct horse battery staple")).rejects.toThrow("digest failed")
		expect(encoded).toHaveLength(1)
		expect(isZeroed(encoded[0])).toBe(true)
	})

	test("getHashHex wipes the encoded input bytes and still hashes correctly", async () => {
		const expected = await EncryptionKey.getHashHex("abc")
		const encoded: Uint8Array[] = []
		const orig = TextEncoder.prototype.encode
		vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (this: TextEncoder, s?: string) {
			const out = orig.call(this, s)
			encoded.push(out)
			return out
		})
		expect(await EncryptionKey.getHashHex("abc")).toBe(expected)
		expect(encoded).toHaveLength(1)
		expect(isZeroed(encoded[0])).toBe(true)
	})

	test("wrapPair wipes the Buffer copy of the bearer token it base64-encodes", async () => {
		const copies: Buffer[] = []
		const orig = Buffer.from.bind(Buffer)
		vi.spyOn(Buffer, "from").mockImplementation(((...args: unknown[]) => {
			const out = (orig as (...a: unknown[]) => Buffer)(...args)
			if (args[0] instanceof Uint8Array) copies.push(out)
			return out
		}) as typeof Buffer.from)
		const box = new SessionSecretBox()
		const master = asMasterSecretBytes(new Uint8Array(32).fill(1))
		const dek = asImportedKeysDek(new Uint8Array(32).fill(2))
		const wrapped = await box.wrapPair(master, dek, "profile-1")
		expect(wrapped.v).toBe(2)
		// Order of `Buffer.from(view)` calls in wrapPair: token, salt, packed — the token copy is first.
		expect(copies.length).toBeGreaterThanOrEqual(1)
		expect(isZeroed(copies[0])).toBe(true)
	})

	test("unwrapPair wipes the decoded token Buffer and still recovers the pair", async () => {
		const box = new SessionSecretBox()
		const master = asMasterSecretBytes(new Uint8Array(32).fill(3))
		const dek = asImportedKeysDek(new Uint8Array(32).fill(4))
		const wrapped = await box.wrapPair(master, dek, "profile-2")
		const decoded: Buffer[] = []
		const orig = Buffer.from.bind(Buffer)
		vi.spyOn(Buffer, "from").mockImplementation(((...args: unknown[]) => {
			const out = (orig as (...a: unknown[]) => Buffer)(...args)
			if (typeof args[0] === "string") decoded.push(out)
			return out
		}) as typeof Buffer.from)
		const pair = await box.unwrapPair(wrapped, "profile-2")
		expect(pair?.master.every((x) => x === 3)).toBe(true)
		// Order of `Buffer.from(string, "base64")` calls in unwrapPair: token, salt, wrappedSecret.
		expect(decoded.length).toBeGreaterThanOrEqual(1)
		expect(isZeroed(decoded[0])).toBe(true)
	})
})
