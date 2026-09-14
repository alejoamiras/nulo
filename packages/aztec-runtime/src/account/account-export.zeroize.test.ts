import { afterEach, describe, expect, test, vi } from "vitest"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { decryptAccountExport, encryptAccountExport } from "./account-export"

const isZeroed = (b: Uint8Array) => b.length > 0 && b.every((x) => x === 0)
const exp = { version: 1, regime: "v5", chainId: 1, l1ChainId: 1, address: "0x01", signingKey: "0x02", checksum: "00" } as never

/** Records the plaintext handed to `EncryptionKey.encrypt`, optionally failing the call. */
function captureEncrypt(fail?: Error) {
	const inputs: Uint8Array[] = []
	const orig = EncryptionKey.prototype.encrypt
	vi.spyOn(EncryptionKey.prototype, "encrypt").mockImplementation(async function (this: EncryptionKey, ...args) {
		inputs.push(args[0])
		if (fail) throw fail
		return orig.apply(this, args)
	})
	return inputs
}

/** Records what `EncryptionKey.decrypt` returned — the buffer the caller must wipe. */
function captureDecrypt() {
	const outputs: Uint8Array[] = []
	const orig = EncryptionKey.prototype.decrypt
	vi.spyOn(EncryptionKey.prototype, "decrypt").mockImplementation(async function (this: EncryptionKey, ...args) {
		const out = await orig.apply(this, args)
		outputs.push(out)
		return out
	})
	return outputs
}

afterEach(() => vi.restoreAllMocks())

describe("account export plaintext buffers are wiped after use", () => {
	test("encryptAccountExport wipes the serialized plaintext it handed to encrypt", async () => {
		const inputs = captureEncrypt()
		await encryptAccountExport(exp, "pw")
		expect(inputs).toHaveLength(1)
		expect(new TextDecoder().decode(inputs[0])).not.toContain("signingKey")
		expect(isZeroed(inputs[0])).toBe(true)
	})

	test("a failing encrypt still wipes the plaintext", async () => {
		const inputs = captureEncrypt(new Error("encrypt failed"))
		await expect(encryptAccountExport(exp, "pw")).rejects.toThrow("encrypt failed")
		expect(inputs).toHaveLength(1)
		expect(isZeroed(inputs[0])).toBe(true)
	})

	test("decryptAccountExport wipes the decrypted bytes after decoding them", async () => {
		const ct = await encryptAccountExport(exp, "pw")
		const outputs = captureDecrypt()
		const text = await decryptAccountExport(ct, "pw")
		expect(text).toContain('"signingKey"')
		expect(outputs).toHaveLength(1)
		expect(isZeroed(outputs[0])).toBe(true)
	})

	test("a failing decode still wipes the decrypted bytes", async () => {
		const ct = await encryptAccountExport(exp, "pw")
		const outputs = captureDecrypt()
		vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(() => {
			throw new Error("decode failed")
		})
		await expect(decryptAccountExport(ct, "pw")).rejects.toThrow("decode failed")
		expect(outputs).toHaveLength(1)
		expect(isZeroed(outputs[0])).toBe(true)
	})
})
