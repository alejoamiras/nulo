import { describe, expect, test, vi } from "vitest"
import { RealChromeBrowserApi } from "./chrome-browser-api"

/** The suite's `chrome` stub has no `windows`; install one per test. */
function stubWindows(impl: Partial<{ getLastFocused: unknown; update: unknown }>) {
	const getLastFocused = vi.fn(impl.getLastFocused as never)
	const update = vi.fn(impl.update as never)
	vi.stubGlobal("chrome", { ...(globalThis as { chrome?: object }).chrome, windows: { getLastFocused, update } })
	return { getLastFocused, update, windows: new RealChromeBrowserApi().windows }
}

describe("ChromeWindowsAdapter", () => {
	test("getLastFocused asks for NORMAL windows only and returns the bounds", async () => {
		const { getLastFocused, windows } = stubWindows({
			getLastFocused: async () => ({ id: 7, left: -1920, top: 0, width: 1920, height: 1080, focused: true }),
		})

		await expect(windows.getLastFocused()).resolves.toEqual({ left: -1920, top: 0, width: 1920, height: 1080 })
		expect(getLastFocused).toHaveBeenCalledWith({ windowTypes: ["normal"] })
	})

	test("getLastFocused never throws: a rejecting lookup and non-numeric bounds both yield undefined", async () => {
		const throwing = stubWindows({
			getLastFocused: async () => {
				throw new Error("No window with id")
			},
		})
		await expect(throwing.windows.getLastFocused()).resolves.toBeUndefined()

		const partial = stubWindows({ getLastFocused: async () => ({ id: 7, left: 10, top: 20 }) })
		await expect(partial.windows.getLastFocused()).resolves.toBeUndefined()
	})

	test("update forwards the window id and options", async () => {
		const { update, windows } = stubWindows({ update: async () => ({}) })

		await windows.update(42, { focused: true, drawAttention: true, state: "normal" })
		expect(update).toHaveBeenCalledWith(42, { focused: true, drawAttention: true, state: "normal" })
	})
})
