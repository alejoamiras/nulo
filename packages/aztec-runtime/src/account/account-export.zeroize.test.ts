import { afterEach, describe, expect, test, vi } from "vitest"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { decryptAccountExport, encryptAccountExport } from "./account-export"

const isZeroed = (b: Uint8Array) => b.length > 0 && b.every((x) => x === 0)
const exp = { version: 1, regime: "v5", chainId: 1, l1ChainId: 1, address: "0x01", signingKey: "0x02", checksum: "00" } as never

afterEach(() => vi.restoreAllMocks())

describe("account export plaintext buffers are wiped after use", () => {
	test("encryptAccountExport wipes the serialized plaintext it encrypted", async () => {
		const encoded: Uint8Array[] = []
		const orig = TextEncoder.prototype.encode
		vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (this: TextEncoder, s?: string) {
			const out = orig.call(this, s)
			encoded.push(out)
			return out
		})
		await encryptAccountExport(exp, "pw")
		// The export payload is the first encode; later encodes are the AAD label / password.
		expect(encoded.length).toBeGreaterThanOrEqual(1)
		expect(isZeroed(encoded[0])).toBe(true)
	})

	test("decryptAccountExport wipes the decrypted bytes after decoding them", async () => {
		const ct = await encryptAccountExport(exp, "pw")
		const outputs: Uint8Array[] = []
		const orig = EncryptionKey.prototype.decrypt
		vi.spyOn(EncryptionKey.prototype, "decrypt").mockImplementation(async function (this: EncryptionKey, ...args) {
			const out = await orig.apply(this, args)
			outputs.push(out)
			return out
		})
		const text = await decryptAccountExport(ct, "pw")
		expect(text).toContain('"signingKey"')
		expect(outputs).toHaveLength(1)
		expect(isZeroed(outputs[0])).toBe(true)
	})
})
