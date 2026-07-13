import { describe, expect, test } from "vitest"
import { ProfileDeletionState } from "./profile-deletion-state"

describe("ProfileDeletionState — epoch fencing + id reservation (D12/D13)", () => {
	test("beginDeletion reserves the id and bumps the epoch, fencing a stale-epoch write", () => {
		const s = new ProfileDeletionState()
		const captured = s.capture("p1") // 0 — a worker captured before any delete
		expect(s.isReserved("p1")).toBe(false)

		s.beginDeletion("p1")

		expect(s.isReserved("p1")).toBe(true)
		expect(s.isCurrent("p1", captured)).toBe(false)
		expect(() => s.assertCurrent("p1", captured)).toThrow(/being deleted/)
	})

	test("a write that captured the CURRENT epoch is not fenced", () => {
		const s = new ProfileDeletionState()
		s.beginDeletion("p1")
		const captured = s.capture("p1")
		expect(() => s.assertCurrent("p1", captured)).not.toThrow()
	})

	test("initReserved seeds the reserved set; release clears it", () => {
		const s = new ProfileDeletionState()
		s.initReserved(["a", "b"])
		expect(s.isReserved("a")).toBe(true)
		expect(s.isReserved("b")).toBe(true)
		s.release("a")
		expect(s.isReserved("a")).toBe(false)
	})
})
