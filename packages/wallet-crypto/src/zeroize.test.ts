import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, it } from "vitest"
import { zeroize } from "./zeroize"

describe("zeroize", () => {
	it("writes zeros to a Uint8Array and returns the same instance", () => {
		const buf = new Uint8Array([1, 2, 3, 4])
		const result = zeroize(buf)
		expect(Array.from(buf)).toEqual([0, 0, 0, 0])
		expect(result).toBe(buf)
	})

	it("is a no-op on undefined", () => {
		expect(zeroize(undefined)).toBeUndefined()
	})

	it("is a no-op on null", () => {
		// `null` happens at sites that destructure optional properties or
		// receive `unseal(...)` returns. Helper handles both `undefined` and
		// `null` so callers don't need a separate guard.
		expect(zeroize(null)).toBeNull()
	})

	it("zeros an ArrayBuffer via a Uint8Array view", () => {
		const ab = new Uint8Array([0x10, 0x20, 0x30]).buffer
		zeroize(ab)
		expect(Array.from(new Uint8Array(ab))).toEqual([0, 0, 0])
	})

	it("zeros a Node Buffer (Uint8Array subclass)", () => {
		const buf = Buffer.from([0xff, 0xfe, 0xfd])
		zeroize(buf)
		expect(Array.from(buf)).toEqual([0, 0, 0])
	})

	it("only zeros the view, not the backing buffer outside it", () => {
		const all = new Uint8Array([1, 2, 3, 4, 5])
		const view = all.subarray(1, 4)
		zeroize(view)
		expect(Array.from(all)).toEqual([1, 0, 0, 0, 5])
	})

	// Self-test for the load-bearing assumption that `Fr.fromBuffer(...)`
	// and `Fr.fromBufferReduce(...)` make their own internal copies of the
	// input bytes. If `Fr` retained a reference, zeroing the input would
	// corrupt the field element. Both call patterns are used in
	// session-manager / passkey-credential — pin both.
	describe("Fr copy-semantics (load-bearing for SessionManager + PasskeyCredential)", () => {
		it("Fr.fromBuffer(Buffer.from(bytes)) copies; zeroing input doesn't corrupt Fr", () => {
			// Use a small value (< field modulus). 0x42-fill would exceed
			// the BN254 modulus and Fr.fromBuffer would reject it; that's
			// the wrong call pattern in our codebase anyway — sites that
			// might overflow use fromBufferReduce (covered by the next
			// test).
			const original = new Uint8Array(32)
			original[31] = 0x05
			const input = Buffer.from(original)
			const fr = Fr.fromBuffer(input)
			zeroize(input)
			const recovered = fr.toBuffer()
			expect(Buffer.compare(recovered, original)).toBe(0)
		})

		it("Fr.fromBufferReduce(Buffer.from(bytes)) copies; zeroing input doesn't corrupt Fr", () => {
			// Use a value whose reduction mod p equals the input (small enough
			// to avoid the modulo wrap), so we can compare bytes directly.
			const original = new Uint8Array(32)
			original[31] = 0x07 // tiny field element
			const input = Buffer.from(original)
			const fr = Fr.fromBufferReduce(input)
			zeroize(input)
			const recovered = fr.toBuffer()
			expect(Buffer.compare(recovered, original)).toBe(0)
		})
	})
})
