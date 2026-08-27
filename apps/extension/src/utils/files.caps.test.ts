// @vitest-environment node
import { describe, expect, it } from "vitest"
import { FileTooLargeError, compressData, decompressData } from "./files"

/**
 * Runs under the node environment so the REAL Web Streams implementations are
 * exercised (no mocks — the whole point is proving the chunk-wise cap against
 * genuine DecompressionStream behavior).
 */
describe("decompressData byte cap", () => {
	async function gzipOf(text: string): Promise<Blob> {
		return await compressData(text, "gzip")
	}

	it("inflates normally when under the cap and when uncapped", async () => {
		const original = "hello backup world".repeat(10)
		const gz = await gzipOf(original)
		const uncapped = await decompressData(await gz.arrayBuffer(), "gzip")
		expect(await uncapped.text()).toBe(original)
		const capped = await decompressData(await gz.arrayBuffer(), "gzip", 1024 * 1024)
		expect(await capped.text()).toBe(original)
	})

	it("rejects a small input that inflates past the cap with FileTooLargeError only", async () => {
		// Highly compressible: ~2 MiB of zeros gzips to a few KiB, so the
		// compressed input sails under any input-side check — only the
		// chunk-wise cap during inflation can stop it.
		const bomb = "0".repeat(2 * 1024 * 1024)
		const gz = await gzipOf(bomb)
		expect(gz.size).toBeLessThan(64 * 1024)
		await expect(decompressData(await gz.arrayBuffer(), "gzip", 256 * 1024)).rejects.toBeInstanceOf(FileTooLargeError)
		// No unhandled rejection from the cancelled producer side: vitest
		// fails the file on any, so reaching the next tick cleanly is the pin.
		await new Promise((r) => setTimeout(r, 10))
	})

	it("carries the limit on the error", async () => {
		const gz = await gzipOf("x".repeat(100_000))
		const err = await decompressData(await gz.arrayBuffer(), "gzip", 10).catch((e) => e)
		expect(err).toBeInstanceOf(FileTooLargeError)
		expect((err as FileTooLargeError).limitBytes).toBe(10)
	})
})
