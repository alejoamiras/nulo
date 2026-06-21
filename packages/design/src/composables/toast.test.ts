import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TOAST_DURATION, useToast } from "./toast"

describe("useToast", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		// Reset the module-scope singleton between tests.
		useToast().closeToast()
		vi.useRealTimers()
	})

	it("openToast sets the current toast value", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "Copied" })
		expect(toast.value).toEqual({ label: "Copied" })
	})

	it("auto-clears after the default duration (2000ms)", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "Done" })
		vi.advanceTimersByTime(1_999)
		expect(toast.value).not.toBeNull()
		vi.advanceTimersByTime(1)
		expect(toast.value).toBeNull()
	})

	it("honors a custom duration", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "Slow" }, 5_000)
		vi.advanceTimersByTime(2_000)
		expect(toast.value).not.toBeNull()
		vi.advanceTimersByTime(3_000)
		expect(toast.value).toBeNull()
	})

	it("a rapid second openToast resets the timer (first toast's timeout does not clear it early)", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "First" }, 2_000)
		vi.advanceTimersByTime(1_500)
		openToast({ label: "Second" }, 2_000)
		// 1500ms after the FIRST would have cleared it; assert the second is still showing.
		vi.advanceTimersByTime(1_500)
		expect(toast.value).toEqual({ label: "Second" })
		vi.advanceTimersByTime(500)
		expect(toast.value).toBeNull()
	})

	it("closeToast clears the toast immediately", () => {
		const { toast, openToast, closeToast } = useToast()
		openToast({ label: "X" })
		closeToast()
		expect(toast.value).toBeNull()
	})

	it("closeToast cancels the pending auto-close timer", () => {
		const { toast, openToast, closeToast } = useToast()
		openToast({ label: "X" })
		closeToast()
		// Re-open, then advance past the FIRST timer's window — it must not fire and clear the new one.
		openToast({ label: "Y" }, 2_000)
		vi.advanceTimersByTime(1_000)
		expect(toast.value).toEqual({ label: "Y" })
	})

	it("preserves the ToastOptions shape (label + optional icon/color)", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "Saved", icon: "check-circle", color: "green" })
		expect(toast.value).toEqual({ label: "Saved", icon: "check-circle", color: "green" })
	})

	it("is a singleton: two useToast() instances share the same toast ref", () => {
		const a = useToast()
		const b = useToast()
		expect(a.toast).toBe(b.toast)
		a.openToast({ label: "Shared" })
		expect(b.toast.value).toEqual({ label: "Shared" })
		b.closeToast()
		expect(a.toast.value).toBeNull()
	})

	it("exposes the standard durations", () => {
		expect(TOAST_DURATION).toEqual({ SHORT: 1_500, DEFAULT: 2_000, LONG: 4_000 })
	})

	it("SHORT and LONG durations drive auto-close timing", () => {
		const { toast, openToast } = useToast()
		openToast({ label: "short" }, TOAST_DURATION.SHORT)
		vi.advanceTimersByTime(TOAST_DURATION.SHORT)
		expect(toast.value).toBeNull()
		openToast({ label: "long" }, TOAST_DURATION.LONG)
		vi.advanceTimersByTime(TOAST_DURATION.LONG - 1)
		expect(toast.value).not.toBeNull()
	})
})
