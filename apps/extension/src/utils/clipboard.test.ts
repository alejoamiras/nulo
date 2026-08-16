import { beforeEach, describe, expect, test, vi } from "vitest"
import { copyToClipboard } from "./clipboard"

const writeText = vi.fn<(t: string) => Promise<void>>()
const openToast = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	writeText.mockResolvedValue(undefined)
	vi.stubGlobal("window", { navigator: { clipboard: { writeText } } })
})

const OPTS = {
	success: { label: "Copied!", icon: "copy" },
	failure: { label: "Nope", icon: "warning", duration: 3_000 },
}

describe("copyToClipboard", () => {
	test("writeText is invoked synchronously as the first effect (gesture transience)", () => {
		void copyToClipboard("abc", openToast, OPTS)
		expect(writeText).toHaveBeenCalledWith("abc") // before any microtask ran
	})

	test("success: success spec's label/icon/duration only after the write resolves", async () => {
		await expect(copyToClipboard("abc", openToast, OPTS)).resolves.toBe(true)
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ label: "Copied!", icon: "copy" }, undefined)
	})

	test("success duration passes through when specified", async () => {
		await copyToClipboard("abc", openToast, { ...OPTS, success: { label: "C", icon: "copy", duration: 1_500 } })
		expect(openToast).toHaveBeenCalledWith({ label: "C", icon: "copy" }, 1_500)
	})

	test("failure: DISTINCT failure spec (label/icon/duration), returns false — never a false 'copied'", async () => {
		writeText.mockRejectedValue(new Error("denied"))
		await expect(copyToClipboard("abc", openToast, OPTS)).resolves.toBe(false)
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ label: "Nope", icon: "warning" }, 3_000)
	})

	test("failure icon defaults to warning; success icon defaults to copy", async () => {
		writeText.mockRejectedValue(new Error("x"))
		await copyToClipboard("a", openToast, { success: { label: "s" }, failure: { label: "f" } })
		expect(openToast).toHaveBeenCalledWith({ label: "f", icon: "warning" }, undefined)
		writeText.mockResolvedValue(undefined)
		await copyToClipboard("a", openToast, { success: { label: "s" }, failure: { label: "f" } })
		expect(openToast).toHaveBeenLastCalledWith({ label: "s", icon: "copy" }, undefined)
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
