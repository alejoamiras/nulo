import { describe, expect, test } from "vitest"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { assertRestoreEpoch, captureRestoreEpochs } from "./restore-fence"

describe("captureRestoreEpochs", () => {
	test("captures one epoch per distinct valid profile id", () => {
		const d = new ProfileDeletionState()
		const epochs = captureRestoreEpochs(d, ["p1", "p2", "p1"])
		expect([...epochs.keys()].sort()).toEqual(["p1", "p2"])
		expect(epochs.get("p1")).toBe(0)
	})

	test("skips non-string, empty, and RESERVED ids — their rows fail closed at assert", () => {
		const d = new ProfileDeletionState()
		d.beginDeletion("mid-delete")
		const epochs = captureRestoreEpochs(d, [undefined, "", 7, "mid-delete", "ok"])
		expect([...epochs.keys()]).toEqual(["ok"])
	})
})

describe("assertRestoreEpoch", () => {
	test("passes while the captured epoch is current", () => {
		const d = new ProfileDeletionState()
		const epochs = captureRestoreEpochs(d, ["p1"])
		expect(() => assertRestoreEpoch(d, epochs, "p1")).not.toThrow()
	})

	test("throws once a deletion has bumped the epoch", () => {
		const d = new ProfileDeletionState()
		const epochs = captureRestoreEpochs(d, ["p1"])
		d.beginDeletion("p1")
		expect(() => assertRestoreEpoch(d, epochs, "p1")).toThrow(/deleted/)
	})

	test("throws for a row whose profile was never captured (reserved at entry, or unseen)", () => {
		const d = new ProfileDeletionState()
		expect(() => assertRestoreEpoch(d, new Map(), "ghost")).toThrow(/not captured|deleted/)
	})

	test("throws for a missing/invalid row profile id (fail closed)", () => {
		const d = new ProfileDeletionState()
		const epochs = captureRestoreEpochs(d, ["p1"])
		expect(() => assertRestoreEpoch(d, epochs, undefined)).toThrow(/no profile id/)
		expect(() => assertRestoreEpoch(d, epochs, "")).toThrow(/no profile id/)
	})
})
