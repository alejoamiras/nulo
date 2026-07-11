import { describe, expect, test } from "vitest"
import { bytesToHex, fromBase64, toBase64 } from "./encoding"

describe("bytesToHex", () => {
	test("lowercase zero-padded; parity with the prior map+join idiom", () => {
		const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255])
		expect(bytesToHex(bytes)).toBe("00010f107f80ff")
		expect(bytesToHex(bytes)).toBe([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""))
	})
	test("empty", () => expect(bytesToHex(new Uint8Array())).toBe(""))
})

describe("toBase64 / fromBase64", () => {
	const samples = [
		new Uint8Array(),
		new Uint8Array([0]),
		new Uint8Array([1, 2]),
		new Uint8Array([255, 254, 253]),
		new Uint8Array([0x00, 0x80, 0xff, 0x10, 0x20, 0x7f]),
	]

	test("toBase64 byte-identical to Buffer base64 (incl. high bytes, empty, non-3-len)", () => {
		for (const s of samples) expect(toBase64(s)).toBe(Buffer.from(s).toString("base64"))
	})

	test("round-trips through fromBase64", () => {
		for (const s of samples) expect([...fromBase64(toBase64(s))]).toEqual([...s])
	})

	test("fromBase64 byte-identical to Buffer for valid base64", () => {
		expect([...fromBase64("SGVsbG8=")]).toEqual([...Buffer.from("SGVsbG8=", "base64")])
	})

	test("large input: no RangeError + Buffer parity", () => {
		const big = new Uint8Array(200_000).map((_, i) => i % 256)
		expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"))
	})

	test(".buffer parity uses the WHOLE backing buffer, not the logical view (password-secret-box site)", () => {
		const backing = new Uint8Array([1, 2, 3, 4, 5, 6])
		const view = backing.subarray(2, 4) // logical [3,4], but .buffer is the whole [1..6]
		// The site encodes `new Uint8Array(x.buffer)` → the whole buffer, byte-identical to `Buffer.from(x.buffer)`.
		expect(toBase64(new Uint8Array(view.buffer))).toBe(Buffer.from(view.buffer).toString("base64"))
		// And that genuinely differs from encoding the logical view, so this pins the whole-buffer semantics.
		expect(toBase64(new Uint8Array(view.buffer))).not.toBe(toBase64(view))
	})

	test("fromBase64 is strict on malformed input (atob semantics)", () => {
		expect(() => fromBase64("Zm$9v")).toThrow()
	})
})
