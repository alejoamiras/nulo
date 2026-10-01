import { beforeEach, describe, expect, test, vi } from "vitest"
import { copyToClipboard, copyWithToast } from "./clipboard"

const writeText = vi.fn<(t: string) => Promise<void>>()
const openToast = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	writeText.mockResolvedValue(undefined)
	vi.stubGlobal("window", { navigator: { clipboard: { writeText } } })
})

const OPTS = {
	success: { label: "Copied!" },
	failure: { label: "Nope" },
}

describe("copyToClipboard", () => {
	test("writeText is invoked synchronously as the first effect; NO toast before the write settles", async () => {
		let resolveWrite!: () => void
		writeText.mockReturnValue(new Promise<void>((r) => (resolveWrite = r)))
		const result = copyToClipboard("abc", openToast, OPTS)
		expect(writeText).toHaveBeenCalledWith("abc") // synchronously, before any microtask
		await Promise.resolve()
		expect(openToast).not.toHaveBeenCalled() // a premature success toast would fail here
		resolveWrite()
		await result
		expect(openToast).toHaveBeenCalledWith({ kind: "success", label: "Copied!" })
	})

	test("success: a success snack with the success label, only after the write resolves", async () => {
		await expect(copyToClipboard("abc", openToast, OPTS)).resolves.toBe(true)
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ kind: "success", label: "Copied!" })
	})

	test("failure: an error snack with the DISTINCT failure label, returns false — never a false 'copied'", async () => {
		writeText.mockRejectedValue(new Error("denied"))
		await expect(copyToClipboard("abc", openToast, OPTS)).resolves.toBe(false)
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ kind: "error", label: "Nope" })
	})

	test("the kind follows the outcome, never the spec", async () => {
		writeText.mockRejectedValue(new Error("x"))
		await copyToClipboard("a", openToast, { success: { label: "s" }, failure: { label: "f" } })
		expect(openToast).toHaveBeenCalledWith({ kind: "error", label: "f" })
		writeText.mockResolvedValue(undefined)
		await copyToClipboard("a", openToast, { success: { label: "s" }, failure: { label: "f" } })
		expect(openToast).toHaveBeenLastCalledWith({ kind: "success", label: "s" })
	})

	test("sanitize defaults FALSE: copied bytes are exactly the input (D2 pin)", async () => {
		await copyToClipboard("0xab‮cd", openToast, OPTS)
		expect(writeText).toHaveBeenCalledWith("0xab‮cd")
	})

	test("sanitize: true strips control/bidi characters (the three historic sanitizing sites)", async () => {
		await copyToClipboard("0xab‮cd", openToast, { ...OPTS, sanitize: true })
		expect(writeText).toHaveBeenCalledWith("0xabcd")
	})

	test("guard-free: an empty string is written verbatim, not silently dropped", async () => {
		await expect(copyToClipboard("", openToast, OPTS)).resolves.toBe(true)
		expect(writeText).toHaveBeenCalledWith("")
	})
})

describe("copyWithToast", () => {
	test("shares the fleet failure label and forwards sanitize", async () => {
		await copyWithToast("0xab‮cd", openToast, "Key copied", { sanitize: true })
		expect(writeText).toHaveBeenCalledWith("0xabcd")
		expect(openToast).toHaveBeenCalledWith({ kind: "success", label: "Key copied" })
		writeText.mockRejectedValue(new Error("denied"))
		await expect(copyWithToast("x", openToast, "Key copied")).resolves.toBe(false)
		expect(openToast).toHaveBeenLastCalledWith({ kind: "error", label: "Couldn't copy" })
	})
})
