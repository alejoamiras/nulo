import { describe, expect, test, vi } from "vitest"
import { mintPxeGeneration } from "./spec"

describe("mintPxeGeneration", () => {
	test("is 16 random bytes as lowercase zero-padded hex", () => {
		const sizes: number[] = []
		const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
			const bytes = array as unknown as Uint8Array
			sizes.push(bytes.length)
			for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + 3) & 0xff
			return array
		})
		try {
			expect(mintPxeGeneration()).toBe("031425364758697a8b9cadbecfe0f102")
			expect(sizes).toEqual([16])
		} finally {
			spy.mockRestore()
		}
	})
})
