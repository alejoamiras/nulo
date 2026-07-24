import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { downloadFile } from "./files"

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
