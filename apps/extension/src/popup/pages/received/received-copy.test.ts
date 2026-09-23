import { beforeEach, describe, expect, test, vi } from "vitest"
import { copyReceivedValue } from "./received-copy"

const writeText = vi.fn<(t: string) => Promise<void>>()
const openToast = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal("window", { navigator: { clipboard: { writeText } } })
})

describe("received-detail copy shape (historically independent site)", () => {
	test("success: '<label> copied' at 2s with the default copy icon", async () => {
		writeText.mockResolvedValue(undefined)
		await expect(copyReceivedValue("0xabc", "Sender address", openToast)).resolves.toBe(true)
		expect(openToast).toHaveBeenCalledWith({ label: "Sender address copied", icon: "copy" }, 2_000)
	})

	test("failure keeps its RECORDED distinct shape: 'Copy failed' / alert / 2s (not the fleet default)", async () => {
		writeText.mockRejectedValue(new Error("denied"))
		await expect(copyReceivedValue("0xabc", "Sender address", openToast)).resolves.toBe(false)
		expect(openToast).toHaveBeenCalledWith({ label: "Copy failed", icon: "alert" }, 2_000)
	})
})
