import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FileTooLargeError, compressData, downloadFile, pickFile } from "./files"

/** Drives pickFile's hidden input: grabs it post-append, plants the file, fires onchange. */
async function pickWith(file: File, maxBytes?: number): Promise<File> {
	const picked = pickFile(undefined, false, true, maxBytes)
	const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
	if (!input?.onchange) throw new Error("pickFile input not mounted")
	Object.defineProperty(input, "files", { value: [file] })
	input.onchange(new Event("change"))
	return picked
}

describe("pickFile byte cap", () => {
	test("rejects an oversized file before any read (plain path)", async () => {
		const file = new File(["x".repeat(2048)], "big.json")
		await expect(pickWith(file, 1024)).rejects.toBeInstanceOf(FileTooLargeError)
	})

	test("uncapped behavior is unchanged", async () => {
		const file = new File(['{"ok":true}'], "fine.json")
		const picked = await pickWith(file)
		expect(await picked.text()).toBe('{"ok":true}')
	})

	test("an at-limit file passes", async () => {
		const body = "x".repeat(1024)
		const picked = await pickWith(new File([body], "edge.json"), 1024)
		expect(picked.size).toBe(1024)
	})

	// Stream-dependent: the chunk-cap error thrown INSIDE decompression must
	// reject the pick, never fall into the warn-and-fallback that would hand
	// the caller the still-compressed original. (Chunk-cap mechanics
	// themselves are pinned in files.caps.test.ts under the node env.)
	describe.skipIf(typeof CompressionStream === "undefined")("compressed path", () => {
		test("a gzip bomb rejects with FileTooLargeError instead of falling back", async () => {
			const gz = await compressData("0".repeat(2 * 1024 * 1024), "gzip")
			// Construct from RAW BYTES, not the Blob: nesting a Node-realm Blob
			// (CompressionStream's output) inside a jsdom File breaks that File's
			// arrayBuffer() on CI's runtime — the decompress then fell into the
			// warn-and-fallback and the test failed there, not here.
			const file = new File([await gz.arrayBuffer()], "bomb.json.gz")
			// Compressed size sails under the cap; only inflation crosses it.
			expect(file.size).toBeLessThan(64 * 1024)
			await expect(pickWith(file, 256 * 1024)).rejects.toBeInstanceOf(FileTooLargeError)
		})
	})
})

/**
 * `downloads` is a REQUIRED manifest permission, so `downloadFile` must NOT run a
 * `chrome.permissions.request` — that runtime prompt fired after the backup was generated, stole
 * focus, and closed the MV3 popup. The discriminating check forces `permissions.contains` to
 * return `false`: the OLD code (which called `ensurePermissions`) would then call `request`; the
 * new code never touches `chrome.permissions` at all.
 */
describe("downloadFile — never prompts for the downloads permission", () => {
	let requestSpy: ReturnType<typeof vi.fn>
	let downloadSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		requestSpy = vi.fn()
		downloadSpy = vi.fn((_opts: unknown, cb: (id?: number) => void) => cb(1))
		vi.stubGlobal("chrome", {
			runtime: { lastError: undefined as { message?: string } | undefined },
			permissions: {
				// Force the "NOT granted" branch — the focus-stealing prompt path in the old code.
				contains: (_perms: unknown, cb: (has: boolean) => void) => cb(false),
				request: requestSpy,
			},
			downloads: { download: downloadSpy },
		})
		vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() })
	})

	afterEach(() => vi.unstubAllGlobals())

	test("downloads without calling chrome.permissions.request even when contains() is false", async () => {
		await downloadFile({ data: '{"backup":true}', filename: "nulo-backup.json" })
		expect(requestSpy).not.toHaveBeenCalled()
		expect(downloadSpy).toHaveBeenCalledTimes(1)
		expect(downloadSpy.mock.calls[0]?.[0]).toMatchObject({ filename: "nulo-backup.json" })
	})

	test("still surfaces a real download failure via chrome.runtime.lastError", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mutating the stubbed chrome global for this case
		const c = globalThis.chrome as any
		c.downloads.download = vi.fn((_opts: unknown, cb: () => void) => {
			c.runtime.lastError = { message: "download disk full" }
			cb()
		})
		await expect(downloadFile({ data: "x", filename: "f.txt" })).rejects.toThrow("download disk full")
		expect(requestSpy).not.toHaveBeenCalled()
	})
})
