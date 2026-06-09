import { describe, expect, it } from "vitest"
import { openSecret, recoveryKeyFromSignature, recoveryKeyMessage, sealSecret } from "./recovery-crypto"

const SIG_A = `0x${"a".repeat(130)}`
const SIG_B = `0x${"b".repeat(130)}`
const SECRET = "0x1234deadbeefcafe"

describe("recovery-crypto", () => {
	it("round-trips a secret (ciphertext, not plaintext)", async () => {
		const key = await recoveryKeyFromSignature(SIG_A)
		const blob = await sealSecret(key, SECRET)
		expect(blob).not.toContain(SECRET)
		expect(await openSecret(key, blob)).toBe(SECRET)
	})

	it("same signature derives a key that decrypts another instance's blob (re-derivable)", async () => {
		const k1 = await recoveryKeyFromSignature(SIG_A)
		const k2 = await recoveryKeyFromSignature(SIG_A)
		const blob = await sealSecret(k1, SECRET)
		expect(await openSecret(k2, blob)).toBe(SECRET)
	})

	it("a different signature cannot decrypt the blob", async () => {
		const k1 = await recoveryKeyFromSignature(SIG_A)
		const k2 = await recoveryKeyFromSignature(SIG_B)
		const blob = await sealSecret(k1, SECRET)
		await expect(openSecret(k2, blob)).rejects.toThrow()
	})

	it("encrypting twice yields different blobs (random IV) but both decrypt", async () => {
		const key = await recoveryKeyFromSignature(SIG_A)
		const b1 = await sealSecret(key, SECRET)
		const b2 = await sealSecret(key, SECRET)
		expect(b1).not.toBe(b2)
		expect(await openSecret(key, b1)).toBe(SECRET)
		expect(await openSecret(key, b2)).toBe(SECRET)
	})

	it("recoveryKeyMessage is per-record — a different secretHash yields a different message", () => {
		const base = { chainId: 11155111, portal: "0xPortal", bridge: "0xBridge" }
		const mA = recoveryKeyMessage({ ...base, secretHashHex: "0xAAAA" })
		const mB = recoveryKeyMessage({ ...base, secretHashHex: "0xBBBB" })
		expect(mA).not.toBe(mB)
		expect(mA).toContain("chain=11155111")
		expect(mA).toContain("record=0xaaaa") // lowercased
	})

	it("recoveryKeyFromSignature normalizes case — upper/lower-hex sig derive the same key", async () => {
		const kLower = await recoveryKeyFromSignature(`0x${"a".repeat(130)}`)
		const kUpper = await recoveryKeyFromSignature(`0x${"A".repeat(130)}`)
		const blob = await sealSecret(kLower, SECRET)
		expect(await openSecret(kUpper, blob)).toBe(SECRET)
	})
})
