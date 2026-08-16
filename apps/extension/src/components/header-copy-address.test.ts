import { afterEach, describe, expect, test, vi } from "vitest"
import { copyAddressToClipboard } from "./header-copy-address"

const ADDRESS = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"

function stubClipboard(writeText: (text: string) => Promise<void>) {
	Object.defineProperty(window.navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	})
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("copyAddressToClipboard", () => {
	test("writes the FULL address verbatim and toasts success only AFTER the write resolves", async () => {
		const order: string[] = []
		const writeText = vi.fn(async (text: string) => {
			order.push(`write:${text}`)
		})
		stubClipboard(writeText)
		const openToast = vi.fn(() => {
			order.push("toast")
		})

		const ok = await copyAddressToClipboard(ADDRESS, openToast)

		expect(ok).toBe(true)
		expect(writeText).toHaveBeenCalledWith(ADDRESS)
		expect(openToast).toHaveBeenCalledWith({ label: "Address is copied", icon: "copy" }, undefined)
		expect(order).toEqual([`write:${ADDRESS}`, "toast"])
	})

	test("strips control/bidi characters but never truncates", async () => {
		const writeText = vi.fn(async () => {})
		stubClipboard(writeText)
		const openToast = vi.fn()

		// U+202E (bidi override) + U+200B (zero-width space) are format chars, stripped; hex survives.
		await copyAddressToClipboard(`\u202E${ADDRESS}\u200B`, openToast)

		expect(writeText).toHaveBeenCalledWith(ADDRESS)
	})

	test("a rejected clipboard write toasts a warning, never the success message", async () => {
		stubClipboard(vi.fn(async () => Promise.reject(new Error("denied"))))
		const openToast = vi.fn()

		const ok = await copyAddressToClipboard(ADDRESS, openToast)

		expect(ok).toBe(false)
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ label: "Couldn't copy address", icon: "warning" }, 3_000)
	})

	test("no address (locked / not yet loaded) is a silent no-op", async () => {
		const writeText = vi.fn(async () => {})
		stubClipboard(writeText)
		const openToast = vi.fn()

		expect(await copyAddressToClipboard(undefined, openToast)).toBe(false)
		expect(writeText).not.toHaveBeenCalled()
		expect(openToast).not.toHaveBeenCalled()
	})
})
