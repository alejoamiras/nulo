import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useSecretClipboardCopy } from "./useSecretClipboardCopy"

const writeText = vi.fn<(t: string) => Promise<void>>()
const openToast = vi.fn()

const make = () => useSecretClipboardCopy({ toastLabel: "Key is copied", openToast })
const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	writeText.mockResolvedValue(undefined)
	vi.stubGlobal("window", { navigator: { clipboard: { writeText } } })
})

afterEach(() => {
	vi.useRealTimers()
})

describe("useSecretClipboardCopy", () => {
	test("copySecret writes the exact value synchronously (first effect, in-gesture)", () => {
		make().copySecret("seed words here")
		expect(writeText).toHaveBeenCalledWith("seed words here")
	})

	test("success: toast carries the configured label after the write settles", async () => {
		make().copySecret("s")
		await flush()
		expect(openToast).toHaveBeenCalledWith({ label: "Key is copied", icon: "copy" })
	})

	test("failure: honest warning toast — never a false 'copied'", async () => {
		writeText.mockRejectedValue(new Error("denied"))
		make().copySecret("s")
		await flush()
		expect(openToast).toHaveBeenCalledTimes(1)
		expect(openToast).toHaveBeenCalledWith({ label: "Couldn't copy", icon: "warning" }, 3_000)
	})

	test("flash starts regardless of outcome and resets after 2.5s", async () => {
		writeText.mockRejectedValue(new Error("denied"))
		const { isCopied, copySecret } = make()
		copySecret("s")
		expect(isCopied.value).toBe(true) // synchronous, before settle, despite failure
		await flush()
		vi.advanceTimersByTime(2_500)
		expect(isCopied.value).toBe(false)
	})

	test("scrub fires writeText('') at exactly 60s even when the copy write REJECTED", async () => {
		writeText.mockRejectedValueOnce(new Error("denied"))
		make().copySecret("s")
		await flush()
		writeText.mockClear()
		writeText.mockResolvedValue(undefined)
		vi.advanceTimersByTime(60_000)
		expect(writeText).toHaveBeenCalledWith("")
	})

	test("scrub is scheduled in the same tick: it fires even if the copy promise NEVER settles", () => {
		writeText.mockReturnValueOnce(new Promise(() => {})) // hangs forever
		make().copySecret("s")
		writeText.mockClear()
		writeText.mockResolvedValue(undefined)
		vi.advanceTimersByTime(60_000)
		expect(writeText).toHaveBeenCalledWith("")
	})

	test("re-copy clears only the previous scrub timer (single scrub, re-epoched)", async () => {
		const { copySecret } = make()
		copySecret("a")
		await flush()
		vi.advanceTimersByTime(30_000)
		copySecret("b")
		await flush()
		writeText.mockClear()
		vi.advanceTimersByTime(30_000) // 60s after FIRST copy — must NOT scrub yet
		expect(writeText).not.toHaveBeenCalledWith("")
		vi.advanceTimersByTime(30_000) // 60s after the second copy
		expect(writeText).toHaveBeenCalledWith("")
	})

	test("the scrub timer holds no secret: its only write is the empty string", async () => {
		make().copySecret("super secret")
		await flush()
		writeText.mockClear()
		vi.advanceTimersByTime(120_000)
		for (const call of writeText.mock.calls) {
			expect(call[0]).toBe("")
		}
	})

	test("a rejected scrub write is swallowed (no unhandled rejection)", async () => {
		make().copySecret("s")
		await flush()
		writeText.mockRejectedValue(new Error("scrub denied"))
		vi.advanceTimersByTime(60_000)
		await flush() // would surface an unhandled rejection if unguarded
	})

	test("two instances (key page + seed page) hold independent scrub timers", async () => {
		const a = make()
		const b = useSecretClipboardCopy({ toastLabel: "Seed phrase is copied", openToast })
		a.copySecret("ka")
		vi.advanceTimersByTime(30_000)
		b.copySecret("sb")
		await flush()
		writeText.mockClear()
		vi.advanceTimersByTime(30_000) // a's 60s elapses
		expect(writeText.mock.calls.filter((c) => c[0] === "").length).toBe(1)
		vi.advanceTimersByTime(30_000) // b's 60s elapses
		expect(writeText.mock.calls.filter((c) => c[0] === "").length).toBe(2)
	})

	test("callable outside a component context: registers no lifecycle hooks (unmount survival by design)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const { copySecret } = make() // plain function call, no component instance
			copySecret("s")
			expect(warn).not.toHaveBeenCalled() // a lifecycle hook here would warn
		} finally {
			warn.mockRestore()
		}
	})
})
