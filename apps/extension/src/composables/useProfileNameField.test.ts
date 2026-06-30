import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useProfileNameField } from "./useProfileNameField"

describe("composables/useProfileNameField", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		// jsdom's rAF callback can land on the next tick; with fake timers
		// installed, `vi.advanceTimersToNextFrame()` and timer flushes give
		// us deterministic control over the shake animation.
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("initial state: empty name, no error, not shaking", () => {
		const f = useProfileNameField()
		expect(f.profileName.value).toBe("")
		expect(f.trimmedName.value).toBe("")
		expect(f.nameError.value).toBe("")
		expect(f.shakeName.value).toBe(false)
	})

	test("validate() returns false and sets the empty-error on empty input", () => {
		const f = useProfileNameField()
		expect(f.validate()).toBe(false)
		expect(f.nameError.value).toBe("Profile name is required.")
	})

	test("validate() returns false on whitespace-only input (trim before length check)", () => {
		const f = useProfileNameField()
		f.profileName.value = "   "
		expect(f.validate()).toBe(false)
		expect(f.nameError.value).toBe("Profile name is required.")
	})

	test("validate() returns true at exactly 32 characters (upper boundary inclusive)", () => {
		const f = useProfileNameField()
		f.profileName.value = "a".repeat(32)
		expect(f.validate()).toBe(true)
		expect(f.nameError.value).toBe("")
	})

	test("validate() returns false and sets max-length error at 33 characters", () => {
		const f = useProfileNameField()
		f.profileName.value = "a".repeat(33)
		expect(f.validate()).toBe(false)
		expect(f.nameError.value).toBe("Max 32 characters.")
	})

	test("validate() trims surrounding whitespace before length check (Opus LOW #9)", () => {
		const f = useProfileNameField()
		f.profileName.value = "  Acme  "
		// The typed value is preserved verbatim — only the trimmed view is
		// validated. Consumers read `trimmedName.value` to get the canonical
		// form for service calls.
		expect(f.validate()).toBe(true)
		expect(f.profileName.value).toBe("  Acme  ")
		expect(f.trimmedName.value).toBe("Acme")
		expect(f.nameError.value).toBe("")
	})

	test("handleInput() clears an existing error (used as @input listener to reset on retyping)", () => {
		const f = useProfileNameField()
		f.validate() // populates "Profile name is required."
		expect(f.nameError.value).toBe("Profile name is required.")
		f.handleInput()
		expect(f.nameError.value).toBe("")
	})

	test("triggerShake() flips shakeName false → true → false across the 400ms animation window", () => {
		const f = useProfileNameField()
		expect(f.shakeName.value).toBe(false)
		f.triggerShake()
		// rAF callback is queued; with fake timers active, ~16ms ≈ one frame.
		vi.advanceTimersByTime(20)
		expect(f.shakeName.value).toBe(true)
		// 400ms later the timeout resets the flag to false.
		vi.advanceTimersByTime(400)
		expect(f.shakeName.value).toBe(false)
	})

	test("validate() calls nameInputRef.focus() on empty-input failure (focus restore for keyboard UX)", () => {
		const f = useProfileNameField()
		const focus = vi.fn()
		f.nameInputRef.value = { focus }
		expect(f.validate()).toBe(false)
		expect(focus).toHaveBeenCalledOnce()
	})

	test("dispose() clears the pending shake timer (no orphaned timeout after unmount)", () => {
		const f = useProfileNameField()
		f.triggerShake()
		// The shake timer is set inside a rAF callback. Advance one frame so
		// the setTimeout is scheduled, then dispose before it fires.
		vi.advanceTimersByTime(20)
		expect(vi.getTimerCount()).toBe(1) // the 400ms shake-reset timer
		f.dispose()
		// Contract: dispose() clears the handle so no further mutation
		// happens after the parent unmounts.
		expect(vi.getTimerCount()).toBe(0)
	})

	test("validate({ existingNames }) rejects case-folded NFKC duplicates (F4 cross-profile uniqueness)", () => {
		const f = useProfileNameField()
		f.profileName.value = "acme"
		// Latin "Acme" already exists; case-folded compare blocks "acme".
		// Also test NFKC: "ﬂag" (U+FB02 ligature) normalizes to "flag".
		expect(f.validate({ existingNames: ["Acme", "Vault"] })).toBe(false)
		expect(f.nameError.value).toBe("This name is already in use.")

		f.handleInput() // clear error
		f.profileName.value = "ﬂag"
		expect(f.validate({ existingNames: ["flag"] })).toBe(false)
		expect(f.nameError.value).toBe("This name is already in use.")

		f.handleInput()
		f.profileName.value = "Unique"
		expect(f.validate({ existingNames: ["Acme", "Vault"] })).toBe(true)
		expect(f.nameError.value).toBe("")
	})
})
